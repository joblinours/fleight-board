import websocket from '@fastify/websocket';
import { CollaborationHub } from '@fleight/collaboration';
import type { HealthResponse } from '@fleight/protocol';
import { PROTOCOL_VERSION } from '@fleight/protocol';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Database } from './database';
import { registerWebSocket } from './websocket';

export type AppOptions = {
  database: Pick<Database, 'ping'>;
  logger?: FastifyServerOptions['logger'];
  hub?: CollaborationHub;
};

/** Taille maximale d'un message WebSocket (1 Mio). */
const MAX_MESSAGE_BYTES = 1024 * 1024;

export async function buildApp({ database, logger = false, hub }: AppOptions) {
  const app = Fastify({ logger });
  const collaboration = hub ?? new CollaborationHub({ log: app.log });

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

  await app.register(registerWebSocket, { hub: collaboration });

  return app;
}
