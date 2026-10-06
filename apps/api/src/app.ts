import websocket from '@fastify/websocket';
import { CollaborationHub, type HubLogger } from '@fleight/collaboration';
import type { HealthResponse } from '@fleight/protocol';
import { PROTOCOL_VERSION } from '@fleight/protocol';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import type { AssetService } from './assets/asset-service';
import { registerAssets } from './assets/routes';
import type { AuthService, Identity } from './auth/auth-service';
import { registerAuth, SESSION_COOKIE } from './auth/routes';
import type { BoardService } from './boards/board-service';
import { GUEST_COOKIE, requireUserOrGuest } from './boards/guest-auth';
import { registerBoards } from './boards/routes';
import type { Database } from './database';
import type { AuditLogReader } from './db/audit-log';
import { registerWeb, stripApiPrefix } from './web';
import { type ConnectionIdentity, registerWebSocket } from './websocket';

export type AppOptions = {
  database: Pick<Database, 'ping'>;
  logger?: FastifyServerOptions['logger'];
  /** Logger déjà construit (production : pino, JSON) ; prioritaire sur `logger`. */
  loggerInstance?: FastifyBaseLogger;
  /** Frontend construit à servir (production) ; l'API reste aussi joignable sous `/api`. */
  webDir?: string;
  /** Construit le hub de collaboration (stockage en mémoire par défaut). */
  createHub?: (log: HubLogger) => CollaborationHub;
  /** Comptes et sessions (routes `/auth`, `/admin`). */
  auth?: AuthService;
  /** Demandes de création de compte depuis l'interface. */
  allowRegistration?: boolean;
  /** Lecture de l'audit (propriétaire du board, Admins). */
  audit?: AuditLogReader;
  /** Whiteboards (routes `/boards`) ; requiert `auth`. */
  boards?: BoardService;
  /** Images importées (routes `/boards/:id/assets`, `/assets/:id`) ; requiert `auth`. */
  assets?: AssetService;
  /** Taille maximale d'un fichier importé, en octets (10 Mio par défaut). */
  maxUploadBytes?: number;
  /**
   * Identifie une connexion WebSocket. Par défaut : session (cookie) via `auth` ;
   * sans `auth` ni `identify`, toute connexion est refusée.
   */
  identify?: (request: FastifyRequest) => Promise<Identity | undefined>;
  /** Derrière un reverse proxy : protocole et IP lus dans X-Forwarded-*. */
  trustProxy?: boolean;
};

/** Taille maximale d'un message WebSocket (1 Mio). */
const MAX_MESSAGE_BYTES = 1024 * 1024;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp({
  database,
  logger = false,
  loggerInstance,
  webDir,
  createHub,
  auth,
  allowRegistration,
  audit,
  boards,
  assets,
  maxUploadBytes = 10 * 1024 * 1024,
  identify,
  trustProxy = false,
}: AppOptions) {
  const app = Fastify({
    ...(loggerInstance ? { loggerInstance } : { logger }),
    trustProxy,
    rewriteUrl: (request) => stripApiPrefix(request.url ?? '/'),
  });
  const collaboration = createHub ? createHub(app.log) : new CollaborationHub({ log: app.log });

  // Protection CSRF (en plus de SameSite=Lax) : une requête qui modifie quelque chose,
  // ou qui ouvre un WebSocket, doit venir d'une page servie par le même hôte.
  app.addHook('onRequest', async (request, reply) => {
    const upgrade = request.headers.upgrade?.toLowerCase() === 'websocket';
    if (SAFE_METHODS.has(request.method) && !upgrade) return;
    if (!sameOrigin(request)) {
      return reply.code(403).send({ error: 'FORBIDDEN_ORIGIN', message: 'Origine refusée' });
    }
  });

  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

  // Liveness : le processus répond.
  // Sondes appelées en boucle (healthcheck Docker) : pas de log par requête.
  app.get('/health', { logLevel: 'warn' }, async (): Promise<HealthResponse> => {
    return { status: 'ok', protocolVersion: PROTOCOL_VERSION };
  });

  // Readiness : les dépendances sont joignables.
  app.get('/ready', { logLevel: 'warn' }, async (_request, reply): Promise<HealthResponse> => {
    const ready = await database.ping();
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ok' : 'unavailable', protocolVersion: PROTOCOL_VERSION };
  });

  if (auth) {
    const { requireUser } = await registerAuth(app, {
      auth,
      audit,
      ...(allowRegistration !== undefined ? { allowRegistration } : {}),
    });

    const userOrGuest = boards ? requireUserOrGuest(auth, boards) : undefined;
    if (boards && userOrGuest) {
      await registerBoards(app, {
        boards,
        audit,
        requireUser: requireUser(),
        requireUserOrGuest: userOrGuest,
      });
      // Board supprimé : ses participants sont déconnectés.
      boards.onDeleted = (boardId) => collaboration.evict(boardId);
      // Permissions des sessions : rôle vérifié à l'entrée, réévalué quand les droits changent.
      collaboration.authorize = (boardId, user) => {
        if (!user) return undefined;
        return user.guest ? boards.guestRole(user.id, boardId) : boards.roleOf(user.id, boardId);
      };
      // Session privée : une demande en attente garde la connexion en salle d'attente.
      collaboration.awaitsAccess = async (boardId, user) =>
        !!user &&
        boards.awaitsAccess(boardId, user.guest ? { guestId: user.id } : { userId: user.id });
      boards.onAccessChanged = (boardId) => collaboration.refreshAccess(boardId);
      boards.onAccessRequests = (boardId, pending) =>
        collaboration.notifyAccessRequests(boardId, pending);
      // Accès « tant que la personne qui l'a accordé est connectée ».
      boards.isConnected = (boardId, userId) => collaboration.isConnected(boardId, userId);
      collaboration.onLeave = (boardId) => void collaboration.refreshAccess(boardId);
    }
    if (assets) {
      if (boards) assets.roleOf = (userId, boardId) => boards.roleOf(userId, boardId);
      await registerAssets(app, {
        assets,
        requireUser: requireUser(),
        ...(userOrGuest ? { requireUserOrGuest: userOrGuest } : {}),
        maxBytes: maxUploadBytes,
      });
    }
  }

  const identifyConnection =
    identify ??
    (auth
      ? async (request: FastifyRequest): Promise<ConnectionIdentity | undefined> => {
          const identity = (await auth.authenticate(request.cookies[SESSION_COOKIE]))?.identity;
          if (identity && !identity.mustChangePassword) return identity;
          // Sans compte : invité (cookie), limité à son board par `authorize`.
          const guest = await boards?.authenticateGuest(request.cookies[GUEST_COOKIE]);
          return guest
            ? { userId: guest.id, displayName: guest.displayName, guest: true }
            : undefined;
        }
      : async () => undefined);
  const connections = await registerWebSocket(app, {
    hub: collaboration,
    identify: identifyConnection,
  });
  // Compte désactivé, supprimé ou mot de passe réinitialisé : ses connexions sont fermées.
  if (auth) auth.onRevoked = (userId) => connections.closeUser(userId);

  if (webDir) await registerWeb(app, webDir);

  return app;
}

/** L'en-tête Origin, s'il est présent, désigne le même hôte que la requête. */
function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
