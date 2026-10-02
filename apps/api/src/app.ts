import websocket from '@fastify/websocket';
import { CollaborationHub, type HubLogger } from '@fleight/collaboration';
import type { AuditLogResponse, HealthResponse } from '@fleight/protocol';
import { BoardIdSchema, PROTOCOL_VERSION } from '@fleight/protocol';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { AuthService, Identity } from './auth/auth-service';
import { registerAuth, SESSION_COOKIE } from './auth/routes';
import type { Database } from './database';
import type { AuditLogReader } from './db/audit-log';
import { registerWebSocket } from './websocket';

export type AppOptions = {
  database: Pick<Database, 'ping'>;
  logger?: FastifyServerOptions['logger'];
  /** Construit le hub de collaboration (stockage en mémoire par défaut). */
  createHub?: (log: HubLogger) => CollaborationHub;
  /** Comptes et sessions (routes `/auth`, `/admin`). */
  auth?: AuthService;
  /** Demandes de création de compte depuis l'interface. */
  allowRegistration?: boolean;
  /** Lecture de l'audit (réservée aux Admins). */
  audit?: AuditLogReader;
  /**
   * Identifie une connexion WebSocket. Par défaut : session (cookie) via `auth` ;
   * sans `auth` ni `identify`, toute connexion est refusée.
   */
  identify?: (request: FastifyRequest) => Promise<Identity | undefined>;
  /** Derrière un reverse proxy : protocole et IP lus dans X-Forwarded-*. */
  trustProxy?: boolean;
};

/** Taille maximale d'un message WebSocket (1 Mio). */
const MAX_MESSAGE_BYTES = 1024 * 1024;

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp({
  database,
  logger = false,
  createHub,
  auth,
  allowRegistration,
  audit,
  identify,
  trustProxy = false,
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });
  const collaboration = createHub ? createHub(app.log) : new CollaborationHub({ log: app.log });

  // Protection CSRF (en plus de SameSite=Lax) : une requête qui modifie quelque chose,
  // ou qui ouvre un WebSocket, doit venir d'une page servie par le même hôte.
  app.addHook('onRequest', async (request, reply) => {
    const upgrade = request.headers.upgrade?.toLowerCase() === 'websocket';
    if (SAFE_METHODS.has(request.method) && !upgrade) return;
    if (!sameOrigin(request)) {
      return reply.code(403).send({ error: 'FORBIDDEN_ORIGIN', message: 'Origine refusée' });
    }
  });

  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

  // Liveness : le processus répond.
  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', protocolVersion: PROTOCOL_VERSION };
  });

  // Readiness : les dépendances sont joignables.
  app.get('/ready', async (_request, reply): Promise<HealthResponse> => {
    const ready = await database.ping();
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'unavailable', protocolVersion: PROTOCOL_VERSION };
  });

  if (auth) {
    const { requireUser } = await registerAuth(app, {
      auth,
      audit,
      ...(allowRegistration !== undefined ? { allowRegistration } : {}),
    });

    // Audit d'un board, du plus récent au plus ancien (Admins ; propriétaires à partir de M1.2).
    if (audit) {
      app.get<{ Params: { boardId: string } }>(
        '/boards/:boardId/audit',
        { preHandler: requireUser({ admin: true }) },
        async (request, reply): Promise<AuditLogResponse | { error: string; message: string }> => {
          const boardId = BoardIdSchema.safeParse(request.params.boardId);
          const query = AuditQuerySchema.safeParse(request.query);
          if (!boardId.success || !query.success) {
            reply.code(400);
            return { error: 'INVALID_REQUEST', message: 'Requête invalide' };
          }
          return { entries: await audit.list(boardId.data, query.data.limit) };
        },
      );
    }
  }

  const identifyConnection =
    identify ??
    (auth
      ? async (request: FastifyRequest) => {
          const identity = (await auth.authenticate(request.cookies[SESSION_COOKIE]))?.identity;
          return identity && !identity.mustChangePassword ? identity : undefined;
        }
      : async () => undefined);
  const connections = await registerWebSocket(app, {
    hub: collaboration,
    identify: identifyConnection,
  });
  // Compte désactivé, supprimé ou mot de passe réinitialisé : ses connexions sont fermées.
  if (auth) auth.onRevoked = (userId) => connections.closeUser(userId);

  return app;
}

/** L'en-tête Origin, s'il est présent, désigne le même hôte que la requête. */
function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
