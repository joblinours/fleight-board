import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {
  AdminAuditQuerySchema,
  type ApiError,
  ChangePasswordRequestSchema,
  CreateUserRequestSchema,
  LoginRequestSchema,
  type MeResponse,
  RegisterRequestSchema,
  UpdateUserRequestSchema,
} from '@fleight/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { AssetError } from '../assets/asset-service';
import { BoardError } from '../boards/board-service';
import type { AuditLogReader } from '../db/audit-log';
import { AuthError, type AuthService, type Identity, type RequestMeta } from './auth-service';

export const SESSION_COOKIE = 'fleight_session';

export type AuthRoutesOptions = {
  auth: AuthService;
  audit?: AuditLogReader | undefined;
  allowRegistration?: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity;
  }
}

/**
 * Comptes, sessions et administration des utilisateurs. Appelé directement sur
 * l'application (pas d'encapsulation) : cookies, gestion d'erreurs et `requireUser`
 * servent aussi aux autres routes.
 */
export async function registerAuth(app: FastifyInstance, options: AuthRoutesOptions) {
  const { auth, audit, allowRegistration = true } = options;
  await app.register(cookie);
  // Limitation par IP, appliquée aux seules routes qui la déclarent.
  await app.register(rateLimit, { global: false });

  const setSession = (
    request: FastifyRequest,
    reply: FastifyReply,
    token: string,
    expiresAt: Date,
  ) => {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // En HTTP (réseau local de développement), un cookie Secure ne serait jamais renvoyé.
      secure: request.protocol === 'https',
      expires: expiresAt,
    });
  };
  const clearSession = (reply: FastifyReply) => reply.clearCookie(SESSION_COOKIE, { path: '/' });

  /** Identifie la requête ; renouvelle le cookie quand la session a été renouvelée. */
  const identify = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await auth.authenticate(request.cookies[SESSION_COOKIE], { rotate: true });
    if (!result) return undefined;
    if (result.rotated) setSession(request, reply, result.rotated.token, result.rotated.expiresAt);
    request.identity = result.identity;
    return result.identity;
  };

  /** Utilisateur connecté requis (et mot de passe à jour, sauf `allowPasswordChange`). */
  const requireUser =
    ({ admin = false, allowPasswordChange = false } = {}) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const identity = await identify(request, reply);
      if (!identity) {
        clearSession(reply);
        return reply.code(401).send(error('UNAUTHENTICATED', 'Connexion requise'));
      }
      if (identity.mustChangePassword && !allowPasswordChange) {
        return reply
          .code(403)
          .send(error('PASSWORD_CHANGE_REQUIRED', 'Changez votre mot de passe temporaire'));
      }
      if (admin && identity.role !== 'admin') {
        return reply.code(403).send(error('FORBIDDEN', 'Réservé aux Admins'));
      }
    };

  const meta = (request: FastifyRequest): RequestMeta => ({
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  });

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseBody(LoginRequestSchema, request.body, reply);
      if (!body) return;
      const result = await auth.login(body.identifier, body.password, meta(request));
      if (!result.ok) {
        const failures = {
          invalid: [401, 'INVALID_CREDENTIALS', 'Identifiant ou mot de passe incorrect'],
          locked: [429, 'ACCOUNT_LOCKED', 'Trop de tentatives : compte bloqué temporairement'],
          disabled: [403, 'ACCOUNT_DISABLED', 'Compte désactivé'],
          pending: [403, 'ACCOUNT_PENDING', 'Demande de compte en attente de validation'],
        } as const;
        const [status, code, message] = failures[result.reason];
        return reply.code(status).send(error(code, message));
      }
      setSession(request, reply, result.token, result.expiresAt);
      return { user: await auth.getUser(result.identity.userId) } satisfies MeResponse;
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const identity = await identify(request, reply);
    await auth.logout(request.cookies[SESSION_COOKIE], identity);
    clearSession(reply);
    return reply.code(204).send();
  });

  app.get(
    '/auth/me',
    { preHandler: requireUser({ allowPasswordChange: true }) },
    async (request): Promise<MeResponse> => ({
      user: await auth.getUser((request.identity as Identity).userId),
    }),
  );

  app.post(
    '/auth/password',
    { preHandler: requireUser({ allowPasswordChange: true }) },
    async (request, reply) => {
      const body = parseBody(ChangePasswordRequestSchema, request.body, reply);
      if (!body) return;
      await auth.changePassword(
        request.identity as Identity,
        body.currentPassword,
        body.newPassword,
      );
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!allowRegistration) {
        return reply
          .code(403)
          .send(error('REGISTRATION_CLOSED', 'Les demandes de compte sont fermées'));
      }
      const body = parseBody(RegisterRequestSchema, request.body, reply);
      if (!body) return;
      const user = await auth.register(body, meta(request));
      return reply.code(201).send({ user });
    },
  );

  // Administration des comptes.
  const admin = { preHandler: requireUser({ admin: true }) };
  const adminIdentity = (request: FastifyRequest) => request.identity as Identity;
  const idParam = (request: FastifyRequest) => (request.params as { id: string }).id;

  app.get('/admin/users', admin, async () => ({ users: await auth.listUsers() }));

  app.post('/admin/users', admin, async (request, reply) => {
    const body = parseBody(CreateUserRequestSchema, request.body, reply);
    if (!body) return;
    return reply.code(201).send(await auth.createUser(adminIdentity(request), body));
  });

  app.patch('/admin/users/:id', admin, async (request, reply) => {
    const body = parseBody(UpdateUserRequestSchema, request.body, reply);
    if (!body) return;
    return { user: await auth.updateUser(adminIdentity(request), idParam(request), body) };
  });

  app.delete('/admin/users/:id', admin, async (request, reply) => {
    await auth.deleteUser(adminIdentity(request), idParam(request));
    return reply.code(204).send();
  });

  app.post('/admin/users/:id/reset-password', admin, async (request) =>
    auth.resetPassword(adminIdentity(request), idParam(request)),
  );

  if (audit) {
    // Audit global : comptes et tous les boards, filtrable.
    app.get('/admin/audit', admin, async (request, reply) => {
      const query = parseBody(AdminAuditQuerySchema, request.query, reply);
      if (!query) return;
      return audit.query(query);
    });
  }

  // Erreurs métier → réponses HTTP.
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AssetError) {
      const status = { UNSUPPORTED_IMAGE: 415, IMAGE_TOO_LARGE: 413, ASSET_NOT_FOUND: 404 }[
        err.code
      ];
      return reply.code(status).send(error(err.code, err.message));
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send(error('FILE_TOO_LARGE', 'Fichier trop volumineux'));
    }
    if (err instanceof BoardError) {
      const status = {
        BOARD_NOT_FOUND: 404,
        ID_TAKEN: 409,
        FORBIDDEN: 403,
        USER_NOT_FOUND: 404,
        MEMBER_NOT_FOUND: 404,
        ALREADY_MEMBER: 409,
        REQUEST_NOT_FOUND: 404,
        GUESTS_NOT_ALLOWED: 403,
        INVALID_ROLE: 400,
      }[err.code];
      return reply.code(status).send(error(err.code, err.message));
    }
    if (err instanceof AuthError) {
      const status = { NOT_FOUND: 404, INVALID_PASSWORD: 400 }[err.code as string] ?? 409;
      return reply.code(status).send(error(err.code, err.message, err.field));
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send(error('RATE_LIMITED', 'Trop de requêtes, réessayez plus tard'));
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      const message = err instanceof Error ? err.message : 'Requête invalide';
      return reply.code(status).send(error('INVALID_REQUEST', message));
    }
    request.log.error({ err }, 'erreur inattendue');
    return reply.code(500).send(error('INTERNAL_ERROR', 'Erreur interne'));
  });

  return { requireUser };
}

function error(code: string, message: string, field?: string): ApiError {
  return { error: code, message, ...(field ? { field } : {}) };
}

/** Valide un corps de requête ; répond 400 (avec le champ en cause) s'il est invalide. */
export function parseBody<T>(
  schema: ZodType<T>,
  data: unknown,
  reply: FastifyReply,
): T | undefined {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path[0];
  void reply
    .code(400)
    .send(
      error(
        'INVALID_REQUEST',
        issue?.message ?? 'Requête invalide',
        typeof field === 'string' ? field : undefined,
      ),
    );
  return undefined;
}
