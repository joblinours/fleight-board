import type { FastifyRequest } from 'fastify';
import type { Identity } from './auth/auth-service';

/** Identité de test pour les connexions WebSocket (sans base de comptes). */
export function testIdentity(name = 'Testeur'): Identity {
  return {
    userId: `user-${name.toLowerCase()}`,
    username: name.toLowerCase(),
    displayName: name,
    role: 'user',
    sessionId: 'session-test',
    mustChangePassword: false,
  };
}

/** `identify` qui accepte toute connexion (tests du protocole). */
export const identifyAnyone = async () => testIdentity();

/** `identify` qui prend le nom dans l'en-tête `x-test-user` (plusieurs participants). */
export const identifyByHeader = async (request: FastifyRequest) =>
  testIdentity(String(request.headers['x-test-user'] ?? 'Testeur'));
