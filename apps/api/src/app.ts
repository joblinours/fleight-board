import websocket from '@fastify/websocket';
import type { HealthResponse } from '@fleight/protocol';
import { PROTOCOL_VERSION } from '@fleight/protocol';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Database } from './database';
import { registerWebSocket } from './websocket';

export type AppOptions = {
  database: Pick<Database, 'ping'>;
  logger?: FastifyServerOptions['logger'];
};

export async function buildApp({ database, logger = false }: AppOptions) {
  const app = Fastify({ logger });

  await app.register(websocket);

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

  await app.register(registerWebSocket);

  return app;
}
