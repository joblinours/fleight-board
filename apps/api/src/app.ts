import websocket from '@fastify/websocket';
import { CollaborationHub, type HubLogger } from '@fleight/collaboration';
import type { AuditLogResponse, HealthResponse } from '@fleight/protocol';
import { BoardIdSchema, PROTOCOL_VERSION } from '@fleight/protocol';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { Database } from './database';
import type { AuditLogReader } from './db/audit-log';
import { registerWebSocket } from './websocket';

export type AppOptions = {
  database: Pick<Database, 'ping'>;
  logger?: FastifyServerOptions['logger'];
  /** Construit le hub de collaboration (stockage en mémoire par défaut). */
  createHub?: (log: HubLogger) => CollaborationHub;
  /** Lecture de l'audit (route absente sans base). */
  audit?: AuditLogReader;
};

/** Taille maximale d'un message WebSocket (1 Mio). */
const MAX_MESSAGE_BYTES = 1024 * 1024;

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export async function buildApp({ database, logger = false, createHub, audit }: AppOptions) {
  const app = Fastify({ logger });
  const collaboration = createHub ? createHub(app.log) : new CollaborationHub({ log: app.log });

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

  // Audit d'un board, du plus récent au plus ancien.
  // Phase 0 : ouvert pour les tests ; réservé au propriétaire et à l'admin à partir de M1.2.
  if (audit) {
    app.get<{ Params: { boardId: string } }>(
      '/boards/:boardId/audit',
      async (request, reply): Promise<AuditLogResponse | { error: string }> => {
        const boardId = BoardIdSchema.safeParse(request.params.boardId);
        const query = AuditQuerySchema.safeParse(request.query);
        if (!boardId.success || !query.success) {
          reply.code(400);
          return { error: 'Requête invalide' };
        }
        return { entries: await audit.list(boardId.data, query.data.limit) };
      },
    );
  }

  await app.register(registerWebSocket, { hub: collaboration });

  return app;
}
