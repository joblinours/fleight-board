import { buildApp } from './app';
import { loadConfig } from './config';
import { connectDatabase } from './database';

const config = loadConfig();
const database = connectDatabase(config.DATABASE_URL);
const app = await buildApp({ database, logger: { level: config.LOG_LEVEL } });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'arrêt en cours');
  await app.close();
  await database.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
