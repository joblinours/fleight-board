import type { CollaborationHub } from '@fleight/collaboration';
import {
  ClientHelloSchema,
  PROTOCOL_VERSION,
  type ServerError,
  type ServerHello,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { Identity } from './auth/auth-service';

/** Close codes applicatifs (plage 4000–4999 réservée aux applications). */
export const CloseCode = {
  InvalidMessage: 4400,
  /** Session révoquée (compte désactivé, supprimé, mot de passe réinitialisé). */
  Revoked: 4401,
  /** Board inexistant. */
  BoardNotFound: 4404,
  /** Accès refusé ou retiré (rôle insuffisant, membre retiré). */
  Forbidden: 4403,
  /** Board supprimé pendant la session. */
  BoardDeleted: 4410,
  UnsupportedProtocolVersion: 4426,
  ServerError: 4500,
} as const;

declare module 'fastify' {
  interface FastifyRequest {
    connectionIdentity?: Identity;
  }
}

export async function registerWebSocket(
  app: FastifyInstance,
  {
    hub,
    identify,
  }: {
    hub: CollaborationHub;
    /** Utilisateur de la connexion ; `undefined` : refusée avant l'ouverture (401). */
    identify: (request: FastifyRequest) => Promise<Identity | undefined>;
  },
) {
  /** Connexions ouvertes par utilisateur, pour les fermer quand ses sessions sont révoquées. */
  const byUser = new Map<string, Set<WebSocket>>();

  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const identity = await identify(request);
        if (!identity) {
          return reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Connexion requise' });
        }
        request.connectionIdentity = identity;
      },
    },
    (socket, request) => {
      const identity = request.connectionIdentity as Identity;
      const connectionId = createId();
      const log = request.log.child({ connectionId, userId: identity.userId });
      let greeted = false;
      const fail = (error: ServerError, closeCode: number) => {
        socket.send(JSON.stringify(error));
        socket.close(closeCode, error.code);
      };
      const session = hub.open(
        connectionId,
        (message) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
        },
        (reason) => {
          if (reason === 'board-not-found') {
            fail(
              { type: 'ERROR', code: 'BOARD_NOT_FOUND', message: 'Board introuvable' },
              CloseCode.BoardNotFound,
            );
          } else if (reason === 'forbidden') {
            fail(
              { type: 'ERROR', code: 'FORBIDDEN', message: 'Accès refusé à ce board' },
              CloseCode.Forbidden,
            );
          } else if (reason === 'board-deleted') {
            socket.close(CloseCode.BoardDeleted, 'BOARD_DELETED');
          } else {
            // Échec d'enregistrement : le client se reconnectera et rechargera l'état.
            socket.close(CloseCode.ServerError, 'STORAGE_ERROR');
          }
        },
        { id: identity.userId, name: identity.displayName },
      );
      const sockets = byUser.get(identity.userId) ?? new Set<WebSocket>();
      sockets.add(socket);
      byUser.set(identity.userId, sockets);
      socket.on('close', () => {
        session.close();
        sockets.delete(socket);
        if (!sockets.size && byUser.get(identity.userId) === sockets)
          byUser.delete(identity.userId);
      });

      socket.on('message', (raw) => {
        let data: unknown;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          fail(
            { type: 'ERROR', code: 'INVALID_MESSAGE', message: 'JSON invalide' },
            CloseCode.InvalidMessage,
          );
          return;
        }

        if (!greeted) {
          const hello = ClientHelloSchema.safeParse(data);
          if (!hello.success) {
            fail(
              { type: 'ERROR', code: 'INVALID_MESSAGE', message: 'HELLO attendu' },
              CloseCode.InvalidMessage,
            );
            return;
          }
          if (hello.data.protocolVersion !== PROTOCOL_VERSION) {
            fail(
              {
                type: 'ERROR',
                code: 'UNSUPPORTED_PROTOCOL_VERSION',
                message: `Version ${hello.data.protocolVersion} non supportée (serveur : ${PROTOCOL_VERSION})`,
              },
              CloseCode.UnsupportedProtocolVersion,
            );
            return;
          }

          greeted = true;
          const reply: ServerHello = {
            type: 'HELLO',
            protocolVersion: PROTOCOL_VERSION,
            connectionId,
          };
          socket.send(JSON.stringify(reply));
          log.debug('connexion WebSocket établie');
          return;
        }

        session.receive(data);
      });
    },
  );

  return {
    /** Ferme les connexions d'un utilisateur dont les sessions ont été révoquées. */
    closeUser(userId: string): void {
      for (const socket of byUser.get(userId) ?? []) socket.close(CloseCode.Revoked, 'REVOKED');
    },
  };
}
