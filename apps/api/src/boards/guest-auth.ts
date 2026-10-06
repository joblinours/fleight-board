import type { Guest } from '@fleight/protocol';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/auth-service';
import { SESSION_COOKIE } from '../auth/routes';
import type { BoardService } from './board-service';

/** Cookie d'un invité (sans compte) : jeton aléatoire, seul son hash est stocké. */
export const GUEST_COOKIE = 'fleight_guest';

declare module 'fastify' {
  interface FastifyRequest {
    guest?: Guest;
  }
}

/** Pose le cookie d'un invité (mêmes protections que la session d'un compte). */
export function setGuestCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(GUEST_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    expires: expiresAt,
  });
}

/**
 * Compte connecté ou, à défaut, invité : `request.identity` ou `request.guest`.
 * Sans l'un ni l'autre : 401.
 */
export function requireUserOrGuest(auth: AuthService, boards: BoardService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.authenticate(request.cookies[SESSION_COOKIE]);
    if (session && !session.identity.mustChangePassword) {
      request.identity = session.identity;
      return;
    }
    const guest = await boards.authenticateGuest(request.cookies[GUEST_COOKIE]);
    if (guest) {
      request.guest = guest;
      return;
    }
    return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Connexion requise' });
  };
}
