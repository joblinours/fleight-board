import { createHash, randomBytes } from 'node:crypto';
import type {
  AccountAuditAction,
  CreateUserRequest,
  PublicUser,
  RegisterRequest,
  UpdateUserRequest,
  UserRole,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { and, asc, eq, gt, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../database';
import { auditLogs, sessions, users } from '../db/schema';
import { hashPassword, temporaryPassword, verifyDummy, verifyPassword } from './passwords';

type UserRow = typeof users.$inferSelect;

/** Utilisateur authentifié pour une requête ou une connexion WebSocket. */
export type Identity = {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  sessionId: string;
  mustChangePassword: boolean;
};

/** Contexte d'une requête, pour les sessions et l'audit. */
export type RequestMeta = { ip?: string | undefined; userAgent?: string | undefined };

export type AuthOptions = {
  /** Durée de vie maximale d'une session (30 jours par défaut). */
  sessionTtlMs?: number;
  /** Expiration après inactivité (7 jours par défaut). */
  idleTimeoutMs?: number;
  /** Renouvellement du jeton de session (toutes les 24 h par défaut). */
  rotationMs?: number;
  /** Échecs consécutifs avant blocage du compte (5 par défaut). */
  maxFailedLogins?: number;
  /** Durée du blocage (15 min par défaut). */
  lockoutMs?: number;
  now?: () => Date;
};

export type LoginResult =
  | { ok: true; identity: Identity; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'locked' | 'disabled' | 'pending' };

export type AuthenticateResult = {
  identity: Identity;
  /** Nouveau jeton quand la session vient d'être renouvelée. */
  rotated?: { token: string; expiresAt: Date };
};

/** Erreur métier, traduite en réponse HTTP par les routes. */
export class AuthError extends Error {
  constructor(
    readonly code:
      | 'USERNAME_TAKEN'
      | 'EMAIL_TAKEN'
      | 'NOT_FOUND'
      | 'INVALID_PASSWORD'
      | 'LAST_ADMIN'
      | 'SELF_MODIFICATION',
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const DAY = 24 * 60 * 60 * 1000;
/** Délai pendant lequel l'ancien jeton reste valide après un renouvellement (requêtes en vol). */
const ROTATION_GRACE_MS = 30_000;
/** `lastSeenAt` n'est réécrit qu'une fois par minute au plus. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Comptes, sessions et protection brute force. Les jetons de session ne sont
 * jamais stockés : seul leur hash SHA-256 l'est.
 */
export class AuthService {
  readonly #db: Db;
  readonly #sessionTtlMs: number;
  readonly #idleTimeoutMs: number;
  readonly #rotationMs: number;
  readonly #maxFailedLogins: number;
  readonly #lockoutMs: number;
  readonly #now: () => Date;
  /** Appelé quand les sessions d'un utilisateur sont révoquées (connexions à fermer). */
  onRevoked: ((userId: string) => void) | undefined;

  constructor(db: Db, options: AuthOptions = {}) {
    this.#db = db;
    this.#sessionTtlMs = options.sessionTtlMs ?? 30 * DAY;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 7 * DAY;
    this.#rotationMs = options.rotationMs ?? DAY;
    this.#maxFailedLogins = options.maxFailedLogins ?? 5;
    this.#lockoutMs = options.lockoutMs ?? 15 * 60 * 1000;
    this.#now = options.now ?? (() => new Date());
  }

  get sessionTtlMs(): number {
    return this.#sessionTtlMs;
  }

  /** Crée le premier Admin s'il n'existe aucun Admin actif. Retourne `true` s'il a été créé. */
  async ensureInitialAdmin(admin: {
    username: string;
    password: string;
    email?: string | undefined;
  }): Promise<boolean> {
    const [existing] = await this.#db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
      .limit(1);
    if (existing) return false;
    const user = await this.#insertUser({
      username: admin.username,
      email: admin.email,
      displayName: admin.username,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(admin.password),
    });
    await this.#audit('user.create', { actor: 'system', actorType: 'system' }, user.id, {
      username: user.username,
      role: 'admin',
      initialAdmin: true,
    });
    return true;
  }

  async login(identifier: string, password: string, meta: RequestMeta = {}): Promise<LoginResult> {
    const now = this.#now();
    const [user] = await this.#db
      .select()
      .from(users)
      .where(or(eq(users.username, identifier), eq(users.email, identifier)))
      .limit(1);

    if (!user) {
      await verifyDummy(password);
      await this.#audit('auth.login_failed', anonymous(meta), null, {
        identifier,
        reason: 'unknown',
      });
      return { ok: false, reason: 'invalid' };
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyDummy(password);
      await this.#audit('auth.login_failed', anonymous(meta), user.id, { reason: 'locked' });
      return { ok: false, reason: 'locked' };
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      // Incrément atomique : des tentatives simultanées comptent toutes.
      const [counted] = await this.#db
        .update(users)
        .set({ failedLogins: sql`${users.failedLogins} + 1` })
        .where(eq(users.id, user.id))
        .returning({ failedLogins: users.failedLogins });
      const locked = (counted?.failedLogins ?? 0) >= this.#maxFailedLogins;
      if (locked) {
        await this.#db
          .update(users)
          .set({ failedLogins: 0, lockedUntil: new Date(now.getTime() + this.#lockoutMs) })
          .where(eq(users.id, user.id));
      }
      await this.#audit('auth.login_failed', anonymous(meta), user.id, {
        reason: 'password',
        ...(locked ? { locked: true } : {}),
      });
      return { ok: false, reason: locked ? 'locked' : 'invalid' };
    }
    // Mot de passe correct : on peut révéler l'état du compte.
    if (user.status !== 'active') {
      await this.#audit('auth.login_failed', anonymous(meta), user.id, { reason: user.status });
      return { ok: false, reason: user.status };
    }

    await this.#db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(users.id, user.id));
    const token = newToken();
    const sessionId = createId();
    const expiresAt = new Date(now.getTime() + this.#sessionTtlMs);
    await this.#db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: now,
      rotatedAt: now,
      lastSeenAt: now,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip ?? null,
    });
    await this.#audit('auth.login', { ...actorOf(user), sessionId }, user.id, {}, meta.ip);
    return { ok: true, identity: identityOf(user, sessionId), token, expiresAt };
  }

  /**
   * Identifie le porteur d'un jeton. Avec `rotate`, renouvelle le jeton quand il
   * a dépassé l'intervalle de rotation (l'appelant renvoie alors le nouveau cookie).
   */
  async authenticate(
    token: string | undefined,
    { rotate = false }: { rotate?: boolean } = {},
  ): Promise<AuthenticateResult | undefined> {
    if (!token) return undefined;
    const now = this.#now();
    const hash = hashToken(token);
    const [row] = await this.#db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        or(
          eq(sessions.tokenHash, hash),
          and(eq(sessions.previousTokenHash, hash), gt(sessions.previousValidUntil, now)),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const { session, user } = row;

    const idleExpired = now.getTime() - session.lastSeenAt.getTime() > this.#idleTimeoutMs;
    if (session.expiresAt <= now || idleExpired || user.status !== 'active') {
      await this.#db.delete(sessions).where(eq(sessions.id, session.id));
      return undefined;
    }

    const identity = identityOf(user, session.id);
    const current = session.tokenHash === hash;
    if (rotate && current && now.getTime() - session.rotatedAt.getTime() >= this.#rotationMs) {
      const token = newToken();
      await this.#db
        .update(sessions)
        .set({
          tokenHash: hashToken(token),
          previousTokenHash: hash,
          previousValidUntil: new Date(now.getTime() + ROTATION_GRACE_MS),
          rotatedAt: now,
          lastSeenAt: now,
        })
        .where(eq(sessions.id, session.id));
      return { identity, rotated: { token, expiresAt: session.expiresAt } };
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.#db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
    }
    return { identity };
  }

  /** Supprime les sessions expirées (appelé périodiquement). */
  async purgeExpiredSessions(): Promise<void> {
    const now = this.#now();
    await this.#db
      .delete(sessions)
      .where(
        or(
          lt(sessions.expiresAt, now),
          lt(sessions.lastSeenAt, new Date(now.getTime() - this.#idleTimeoutMs)),
        ),
      );
  }

  async logout(token: string | undefined, identity?: Identity): Promise<void> {
    if (!token) return;
    await this.#db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    if (identity) await this.#audit('auth.logout', actorOfIdentity(identity), identity.userId, {});
  }

  /** Change son propre mot de passe ; les autres sessions de l'utilisateur sont fermées. */
  async changePassword(identity: Identity, current: string, next: string): Promise<void> {
    const user = await this.#find(identity.userId);
    if (!(await verifyPassword(user.passwordHash, current))) {
      throw new AuthError('INVALID_PASSWORD', 'Mot de passe actuel incorrect', 'currentPassword');
    }
    await this.#db
      .update(users)
      .set({
        passwordHash: await hashPassword(next),
        mustChangePassword: false,
        updatedAt: this.#now(),
      })
      .where(eq(users.id, user.id));
    await this.#db
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, identity.sessionId)));
    await this.#audit('auth.password_change', actorOfIdentity(identity), user.id, {});
  }

  /** Demande de compte depuis l'interface : en attente de validation par un Admin. */
  async register(request: RegisterRequest, meta: RequestMeta = {}): Promise<PublicUser> {
    const user = await this.#insertUser({
      username: request.username,
      email: request.email,
      displayName: request.displayName,
      role: 'user',
      status: 'pending',
      passwordHash: await hashPassword(request.password),
    });
    await this.#audit('user.request', anonymous(meta), user.id, { username: user.username });
    return publicUser(user);
  }

  async getUser(userId: string): Promise<PublicUser> {
    return publicUser(await this.#find(userId));
  }

  async listUsers(): Promise<PublicUser[]> {
    const rows = await this.#db.select().from(users).orderBy(asc(users.username));
    return rows.map(publicUser);
  }

  /** Création par un Admin ; sans mot de passe fourni, un mot de passe temporaire est généré. */
  async createUser(
    admin: Identity,
    request: CreateUserRequest,
  ): Promise<{ user: PublicUser; temporaryPassword?: string }> {
    const generated = request.password ? undefined : temporaryPassword();
    const user = await this.#insertUser({
      username: request.username,
      email: request.email,
      displayName: request.displayName,
      role: request.role ?? 'user',
      status: 'active',
      passwordHash: await hashPassword(request.password ?? (generated as string)),
      mustChangePassword: generated !== undefined,
    });
    await this.#audit('user.create', actorOfIdentity(admin), user.id, {
      username: user.username,
      role: user.role,
    });
    return { user: publicUser(user), ...(generated ? { temporaryPassword: generated } : {}) };
  }

  async updateUser(
    admin: Identity,
    userId: string,
    changes: UpdateUserRequest,
  ): Promise<PublicUser> {
    const user = await this.#find(userId);
    const demoted = changes.role === 'user' && user.role === 'admin';
    const disabled = changes.status === 'disabled' && user.status !== 'disabled';
    if (userId === admin.userId && (demoted || disabled)) {
      throw new AuthError(
        'SELF_MODIFICATION',
        'Impossible de retirer ses propres droits ou de se désactiver',
      );
    }
    if ((demoted || disabled) && user.role === 'admin' && (await this.#isLastAdmin(userId))) {
      throw new AuthError('LAST_ADMIN', 'Il doit rester au moins un Admin actif');
    }
    const values: Partial<UserRow> = { updatedAt: this.#now() };
    if (changes.displayName !== undefined) values.displayName = changes.displayName;
    if (changes.email !== undefined) values.email = changes.email;
    if (changes.role !== undefined) values.role = changes.role;
    if (changes.status !== undefined) values.status = changes.status;
    let updated: UserRow | undefined;
    try {
      [updated] = await this.#db.update(users).set(values).where(eq(users.id, userId)).returning();
    } catch (error) {
      throw uniqueViolation(error) ?? error;
    }
    if (disabled) await this.#revoke(userId);
    await this.#audit('user.update', actorOfIdentity(admin), userId, {
      changes,
      ...(user.status === 'pending' && changes.status === 'active' ? { approved: true } : {}),
    });
    return publicUser(updated as UserRow);
  }

  async deleteUser(admin: Identity, userId: string): Promise<void> {
    const user = await this.#find(userId);
    if (userId === admin.userId) {
      throw new AuthError('SELF_MODIFICATION', 'Impossible de supprimer son propre compte');
    }
    if (user.role === 'admin' && user.status === 'active' && (await this.#isLastAdmin(userId))) {
      throw new AuthError('LAST_ADMIN', 'Il doit rester au moins un Admin actif');
    }
    await this.#db.delete(users).where(eq(users.id, userId));
    this.onRevoked?.(userId);
    await this.#audit('user.delete', actorOfIdentity(admin), userId, { username: user.username });
  }

  /** Réinitialisation par un Admin : mot de passe temporaire, sessions fermées, déblocage. */
  async resetPassword(
    admin: Identity,
    userId: string,
  ): Promise<{ user: PublicUser; temporaryPassword: string }> {
    await this.#find(userId);
    const password = temporaryPassword();
    const [updated] = await this.#db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        failedLogins: 0,
        lockedUntil: null,
        updatedAt: this.#now(),
      })
      .where(eq(users.id, userId))
      .returning();
    await this.#revoke(userId);
    await this.#audit('user.password_reset', actorOfIdentity(admin), userId, {});
    return { user: publicUser(updated as UserRow), temporaryPassword: password };
  }

  /** Événement de compte dans l'audit (accessible aux routes, pour les cas non couverts ici). */
  async #audit(
    action: AccountAuditAction,
    actor: {
      actor: string;
      actorType: 'user' | 'system' | 'client';
      sessionId?: string;
      name?: string;
    },
    target: string | null,
    metadata: Record<string, unknown>,
    ip?: string,
  ): Promise<void> {
    await this.#db.insert(auditLogs).values({
      actor: actor.actor,
      actorType: actor.actorType,
      action,
      boardId: null,
      objectId: target,
      sessionId: actor.sessionId ?? null,
      metadata: {
        ...(actor.name ? { actorName: actor.name } : {}),
        ...(ip ? { ip } : {}),
        ...metadata,
      },
    });
  }

  async #revoke(userId: string): Promise<void> {
    await this.#db.delete(sessions).where(eq(sessions.userId, userId));
    this.onRevoked?.(userId);
  }

  async #isLastAdmin(userId: string): Promise<boolean> {
    const [row] = await this.#db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, userId)));
    return (row?.count ?? 0) === 0;
  }

  async #find(userId: string): Promise<UserRow> {
    const [user] = await this.#db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AuthError('NOT_FOUND', 'Utilisateur introuvable');
    return user;
  }

  async #insertUser(values: {
    username: string;
    email: string | undefined;
    displayName: string;
    role: UserRole;
    status: UserRow['status'];
    passwordHash: string;
    mustChangePassword?: boolean;
  }): Promise<UserRow> {
    const now = this.#now();
    try {
      const [user] = await this.#db
        .insert(users)
        .values({
          id: createId(),
          username: values.username.toLowerCase(),
          email: values.email?.toLowerCase() ?? null,
          displayName: values.displayName,
          passwordHash: values.passwordHash,
          role: values.role,
          status: values.status,
          mustChangePassword: values.mustChangePassword ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return user as UserRow;
    } catch (error) {
      throw uniqueViolation(error) ?? error;
    }
  }
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function identityOf(user: UserRow, sessionId: string): Identity {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    sessionId,
    mustChangePassword: user.mustChangePassword,
  };
}

export function publicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

function actorOf(user: UserRow) {
  return { actor: user.id, actorType: 'user' as const, name: user.displayName };
}

function actorOfIdentity(identity: Identity) {
  return {
    actor: identity.userId,
    actorType: 'user' as const,
    sessionId: identity.sessionId,
    name: identity.displayName,
  };
}

/** Requête non authentifiée : l'adresse IP tient lieu d'acteur. */
function anonymous(meta: RequestMeta) {
  return { actor: meta.ip ?? 'inconnu', actorType: 'client' as const };
}

/** Conflit d'unicité PostgreSQL → erreur métier sur le bon champ. */
function uniqueViolation(error: unknown): AuthError | undefined {
  const cause = (error as { cause?: { code?: string; constraint_name?: string } })?.cause ?? error;
  const { code, constraint_name: constraint } = cause as {
    code?: string;
    constraint_name?: string;
  };
  if (code !== '23505') return undefined;
  if (constraint === 'users_email_idx') {
    return new AuthError('EMAIL_TAKEN', 'Adresse e-mail déjà utilisée', 'email');
  }
  return new AuthError('USERNAME_TAKEN', "Nom d'utilisateur déjà pris", 'username');
}
