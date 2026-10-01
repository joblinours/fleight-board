import { CollaborationHub } from '@fleight/collaboration';
import { buildApp } from './app';
import { loadConfig } from './config';
import { connectDatabase } from './database';
import { PostgresBoardStore } from './db/board-store';

const config = loadConfig();
const database = connectDatabase(config.DATABASE_URL);
await database.migrate();

let hub: CollaborationHub | undefined;
const app = await buildApp({
  database,
  logger: { level: config.LOG_LEVEL },
  createHub: (log) => {
    hub = new CollaborationHub({ store: new PostgresBoardStore(database.db), log });
    return hub;
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'arrêt en cours');
  await app.close();
  // Les lots déjà confirmés sont enregistrés ; on attend ceux en cours.
  await hub?.flush();
  await database.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
