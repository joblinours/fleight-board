import { join } from 'node:path';
import { CollaborationHub } from '@fleight/collaboration';
import { pino } from 'pino';
import { buildApp } from './app';
import { AssetService } from './assets/asset-service';
import { FilesystemBlobStorage } from './assets/blob-storage';
import { AuthService } from './auth/auth-service';
import { BoardService } from './boards/board-service';
import { loadConfig } from './config';
import { connectDatabase } from './database';
import { PostgresAuditLog } from './db/audit-log';
import { PostgresBoardStore } from './db/board-store';

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (error) {
  pino().fatal(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Logs structurés (une ligne JSON par événement), lisibles par Docker, Loki, etc.
const log = pino({
  level: config.LOG_LEVEL,
  base: { service: 'fleight-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

const database = connectDatabase(config.DATABASE_URL);
try {
  // Migrations appliquées à chaque démarrage (sans effet si la base est à jour).
  await database.migrate();
  log.info('base de données à jour');
} catch (error) {
  // Sans base, l'API ne peut rien enregistrer : on s'arrête avec un message clair.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  log.fatal(
    {
      database: describeDatabase(config.DATABASE_URL),
      error: cause instanceof Error ? cause.message : String(cause),
    },
    "Impossible d'initialiser PostgreSQL : vérifiez que la base tourne (pnpm db:up, ou le service postgres du docker-compose) et que DATABASE_URL pointe sur elle, avec ses identifiants",
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
  if (created) log.info({ username: config.ADMIN_USERNAME }, 'premier Admin créé');
}

let hub: CollaborationHub | undefined;
const app = await buildApp({
  database,
  loggerInstance: log,
  ...(config.WEB_DIR ? { webDir: config.WEB_DIR } : {}),
  auth,
  boards: new BoardService(database.db),
  assets: new AssetService(database.db, new FilesystemBlobStorage(join(config.DATA_DIR, 'blobs'))),
  maxUploadBytes: config.MAX_UPLOAD_MB * 1024 * 1024,
  allowRegistration: config.ALLOW_REGISTRATION,
  trustProxy: config.TRUST_PROXY,
  audit: new PostgresAuditLog(database.db),
  createHub: (log) => {
    hub = new CollaborationHub({
      store: new PostgresBoardStore(database.db),
      log,
      // Les boards sont créés par l'API (POST /boards).
      requireExistingBoards: true,
    });
    return hub;
  },
});

// Libération des verrous abandonnés (client parti sans prévenir).
const lockSweep = setInterval(() => void hub?.sweepLocks(), 1000);
lockSweep.unref();
// Accès temporaires expirés : les sessions concernées sont fermées.
const accessSweep = setInterval(() => void hub?.refreshAllAccess().catch(() => {}), 30_000);
accessSweep.unref();
// Sessions expirées.
const sessionSweep = setInterval(
  () => void auth.purgeExpiredSessions().catch(() => {}),
  60 * 60 * 1000,
);
sessionSweep.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'arrêt en cours');
  clearInterval(lockSweep);
  clearInterval(accessSweep);
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
