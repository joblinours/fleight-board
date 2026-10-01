import { CollaborationHub } from '@fleight/collaboration';
import { buildApp } from './app';
import { loadConfig } from './config';
import { connectDatabase } from './database';
import { PostgresBoardStore } from './db/board-store';

const config = loadConfig();
const database = connectDatabase(config.DATABASE_URL);
try {
  await database.migrate();
} catch (error) {
  // Sans base, l'API ne peut rien enregistrer : on s'arrête avec un message clair.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  console.error(
    [
      `Impossible d'initialiser PostgreSQL (${describeDatabase(config.DATABASE_URL)}) :`,
      `  ${cause instanceof Error ? cause.message : String(cause)}`,
      'Vérifiez que la base du projet tourne (pnpm db:up) et que DATABASE_URL',
      '(apps/api/.env) pointe sur son port, avec ses identifiants.',
    ].join('\n'),
  );
  await database.close();
  process.exit(1);
}

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

/** Hôte, port et base de l'URL, sans le mot de passe. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.username}@${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return 'DATABASE_URL invalide';
  }
}
