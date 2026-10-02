import { CollaborationHub } from '@fleight/collaboration';
import { buildApp } from './app';
import { AuthService } from './auth/auth-service';
import { loadConfig } from './config';
import { connectDatabase } from './database';
import { PostgresAuditLog } from './db/audit-log';
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

const DAY = 24 * 60 * 60 * 1000;
const auth = new AuthService(database.db, {
  sessionTtlMs: config.SESSION_TTL_DAYS * DAY,
  idleTimeoutMs: config.SESSION_IDLE_DAYS * DAY,
});
if (config.ADMIN_USERNAME && config.ADMIN_PASSWORD) {
  const created = await auth.ensureInitialAdmin({
    username: config.ADMIN_USERNAME,
    password: config.ADMIN_PASSWORD,
    email: config.ADMIN_EMAIL,
  });
  if (created) console.info(`Premier Admin créé : ${config.ADMIN_USERNAME}`);
}

let hub: CollaborationHub | undefined;
const app = await buildApp({
  database,
  logger: { level: config.LOG_LEVEL },
  auth,
  allowRegistration: config.ALLOW_REGISTRATION,
  trustProxy: config.TRUST_PROXY,
  audit: new PostgresAuditLog(database.db),
  createHub: (log) => {
    hub = new CollaborationHub({ store: new PostgresBoardStore(database.db), log });
    return hub;
  },
});

// Libération des verrous abandonnés (client parti sans prévenir).
const lockSweep = setInterval(() => void hub?.sweepLocks(), 1000);
lockSweep.unref();
// Sessions expirées.
const sessionSweep = setInterval(
  () => void auth.purgeExpiredSessions().catch(() => {}),
  60 * 60 * 1000,
);
sessionSweep.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'arrêt en cours');
  clearInterval(lockSweep);
  clearInterval(sessionSweep);
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
