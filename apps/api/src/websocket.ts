import type { CollaborationHub } from '@fleight/collaboration';
import {
  ClientHelloSchema,
  PROTOCOL_VERSION,
  type ServerError,
  type ServerHello,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import type { FastifyInstance } from 'fastify';

/** Close codes applicatifs (plage 4000–4999 réservée aux applications). */
export const CloseCode = {
  InvalidMessage: 4400,
  UnsupportedProtocolVersion: 4426,
  ServerError: 4500,
} as const;

export async function registerWebSocket(app: FastifyInstance, { hub }: { hub: CollaborationHub }) {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const connectionId = createId();
    const log = request.log.child({ connectionId });
    let greeted = false;
    const session = hub.open(
      connectionId,
      (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
      // Échec d'enregistrement : le client se reconnectera et rechargera l'état.
      () => socket.close(CloseCode.ServerError, 'STORAGE_ERROR'),
    );
    socket.on('close', () => session.close());

    const fail = (error: ServerError, closeCode: number) => {
      socket.send(JSON.stringify(error));
      socket.close(closeCode, error.code);
    };

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
  });
}
