import { createId } from '@fleight/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { BoardService } from '../boards/board-service';
import { connectDatabase, type Database } from '../database';
import { PostgresAuditLog } from '../db/audit-log';
import { users } from '../db/schema';
import { AuthService } from './auth-service';
import { hashPassword } from './passwords';
import { SESSION_COOKIE } from './routes';

/** Tests sur un vrai PostgreSQL, ignorés sans TEST_DATABASE_URL (voir board-store.test.ts). */
const url = process.env.TEST_DATABASE_URL;

const PASSWORD = 'correct-horse-battery';
const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)('authentification', () => {
  let database: Database;
  /** Horloge contrôlée par les tests (expiration, renouvellement, blocage). */
  let now = new Date();
  let auth: AuthService;

  beforeAll(() => {
    database = connectDatabase(url as string);
  });

  afterAll(async () => {
    await database?.close();
  });

  /** Nouvelle application (le limiteur de débit est propre à chaque instance). */
  async function start(options: { allowRegistration?: boolean } = {}) {
    now = new Date();
    auth = new AuthService(database.db, { now: () => now });
    const app = await buildApp({
      database: { ping: async () => true },
      auth,
      audit: new PostgresAuditLog(database.db),
      boards: new BoardService(database.db),
      ...options,
    });
    await app.ready();
    return app;
  }
  type App = Awaited<ReturnType<typeof start>>;

  /** Compte créé directement en base. */
  async function account(role: 'admin' | 'user' = 'user', password = PASSWORD) {
    const username = `${role}-${createId().slice(-10).toLowerCase()}`;
    const id = createId();
    await database.db.insert(users).values({
      id,
      username,
      displayName: `Nom ${username}`,
      passwordHash: await hashPassword(password),
      role,
    });
    return { id, username };
  }

  async function login(app: App, identifier: string, password = PASSWORD) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier, password },
    });
    const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    return { response, cookie, cookies: cookie ? { [SESSION_COOKIE]: cookie.value } : {} };
  }

  it('connecte avec le nom ou l’e-mail, pose un cookie HttpOnly / SameSite=Lax', async () => {
    const app = await start();
    const { id, username } = await account();
    await database.db
      .update(users)
      .set({ email: `${username}@exemple.be` })
      .where(eq(users.id, id));

    const { response, cookie, cookies } = await login(app, username.toUpperCase());
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ id, username, role: 'user' });
    expect(response.json().user.passwordHash).toBeUndefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    // HTTP simple : pas de Secure (sinon le cookie ne reviendrait jamais).
    expect(cookie?.secure).toBeFalsy();

    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies });
    expect(me.json().user.id).toBe(id);
    expect((await login(app, `${username}@exemple.be`)).response.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/auth/logout', cookies });
    expect((await app.inject({ method: 'GET', url: '/auth/me', cookies })).statusCode).toBe(401);
    await app.close();
  });

  it('refuse un mauvais mot de passe ou un compte inconnu, sans les distinguer', async () => {
    const app = await start();
    const { username } = await account();
    const wrong = await login(app, username, 'mauvais-mot-de-passe');
    const unknown = await login(app, 'personne-inconnue');
    expect(wrong.response.statusCode).toBe(401);
    expect(unknown.response.statusCode).toBe(401);
    expect(wrong.response.json()).toEqual(unknown.response.json());
    expect(wrong.cookie).toBeUndefined();
    await app.close();
  });

  it('bloque un compte après 5 échecs, puis le débloque après 15 minutes', async () => {
    const app = await start();
    const { username } = await account();
    for (let i = 0; i < 4; i++) {
      expect((await login(app, username, 'mauvais-mot-de-passe')).response.statusCode).toBe(401);
    }
    expect((await login(app, username, 'mauvais-mot-de-passe')).response.statusCode).toBe(429);
    // Même le bon mot de passe est refusé pendant le blocage.
    const blocked = await login(app, username);
    expect(blocked.response.statusCode).toBe(429);
    expect(blocked.response.json().error).toBe('ACCOUNT_LOCKED');

    now = new Date(now.getTime() + 16 * 60 * 1000);
    expect((await login(app, username)).response.statusCode).toBe(200);
    await app.close();
  });

  it('limite les tentatives de connexion par adresse IP', async () => {
    const app = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await login(app, `inconnu-${i}`, 'x')).response.statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    await app.close();
  });

  it('renouvelle le jeton de session chaque jour ; l’ancien expire après un court délai', async () => {
    const app = await start();
    const { username } = await account();
    const { cookies } = await login(app, username);

    now = new Date(now.getTime() + 25 * HOUR);
    const renewed = await app.inject({ method: 'GET', url: '/auth/me', cookies });
    expect(renewed.statusCode).toBe(200);
    const fresh = renewed.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(fresh?.value).toBeDefined();
    expect(fresh?.value).not.toBe(cookies[SESSION_COOKIE]);

    // L'ancien jeton reste accepté quelques secondes (requêtes en vol)…
    expect((await app.inject({ method: 'GET', url: '/auth/me', cookies })).statusCode).toBe(200);
    // … puis plus du tout ; le nouveau, si.
    now = new Date(now.getTime() + 60_000);
    expect((await app.inject({ method: 'GET', url: '/auth/me', cookies })).statusCode).toBe(401);
    const freshCookies = { [SESSION_COOKIE]: fresh?.value as string };
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', cookies: freshCookies })).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('expire une session inactive 7 jours, et toute session après 30 jours', async () => {
    const app = await start();
    const { username } = await account();
    const idle = await login(app, username);
    now = new Date(now.getTime() + 8 * 24 * HOUR);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', cookies: idle.cookies })).statusCode,
    ).toBe(401);

    const active = await login(app, username);
    let cookies = active.cookies;
    for (let day = 1; day <= 31; day++) {
      now = new Date(now.getTime() + 24 * HOUR);
      const response = await app.inject({ method: 'GET', url: '/auth/me', cookies });
      const renewed = response.cookies.find(({ name }) => name === SESSION_COOKIE);
      if (renewed?.value) cookies = { [SESSION_COOKIE]: renewed.value };
      if (day < 30) expect(response.statusCode, `jour ${day}`).toBe(200);
      else expect(response.statusCode, `jour ${day}`).toBe(401);
    }
    await app.close();
  });

  it('demande de compte : en attente jusqu’à la validation par un Admin', async () => {
    const app = await start();
    const admin = await account('admin');
    const adminSession = await login(app, admin.username);
    const username = `demande-${createId().slice(-8).toLowerCase()}`;

    const request = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, displayName: 'Nouvelle personne', password: PASSWORD },
    });
    expect(request.statusCode).toBe(201);
    expect(request.json().user.status).toBe('pending');
    const pending = await login(app, username);
    expect(pending.response.statusCode).toBe(403);
    expect(pending.response.json().error).toBe('ACCOUNT_PENDING');

    const approved = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${request.json().user.id}`,
      cookies: adminSession.cookies,
      payload: { status: 'active' },
    });
    expect(approved.json().user.status).toBe('active');
    expect((await login(app, username)).response.statusCode).toBe(200);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, displayName: 'Doublon', password: PASSWORD },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'USERNAME_TAKEN', field: 'username' });
    await app.close();
  });

  it('refuse les demandes de compte quand elles sont fermées, et les mots de passe trop courts', async () => {
    const app = await start({ allowRegistration: false });
    const closed = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'quelquun', displayName: 'X', password: PASSWORD },
    });
    expect(closed.statusCode).toBe(403);
    await app.close();

    const open = await start();
    const short = await open.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'quelquun', displayName: 'X', password: 'court' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().field).toBe('password');
    await open.close();
  });

  it('création par un Admin avec mot de passe temporaire, à changer à la connexion', async () => {
    const app = await start();
    const admin = await login(app, (await account('admin')).username);
    const username = `cree-${createId().slice(-8).toLowerCase()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      cookies: admin.cookies,
      payload: { username, displayName: 'Créé par l’Admin' },
    });
    expect(created.statusCode).toBe(201);
    const temporary = created.json().temporaryPassword as string;
    expect(temporary).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}-[\w]{4}$/);

    const user = await login(app, username, temporary);
    expect(user.response.json().user.mustChangePassword).toBe(true);
    // Tant que le mot de passe n'est pas changé, seules quelques routes répondent.
    const blocked = await app.inject({ method: 'GET', url: '/admin/users', cookies: user.cookies });
    expect(blocked.json().error).toBe('PASSWORD_CHANGE_REQUIRED');

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/password',
      cookies: user.cookies,
      payload: { currentPassword: 'faux', newPassword: 'un-nouveau-mot-de-passe' },
    });
    expect(wrong.statusCode).toBe(400);
    const changed = await app.inject({
      method: 'POST',
      url: '/auth/password',
      cookies: user.cookies,
      payload: { currentPassword: temporary, newPassword: 'un-nouveau-mot-de-passe' },
    });
    expect(changed.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: user.cookies });
    expect(me.json().user.mustChangePassword).toBe(false);
    expect((await login(app, username, 'un-nouveau-mot-de-passe')).response.statusCode).toBe(200);
    await app.close();
  });

  it('désactiver, réinitialiser ou supprimer un compte ferme ses sessions', async () => {
    const app = await start();
    const admin = await login(app, (await account('admin')).username);
    const target = await account();
    const session = await login(app, target.username);
    const patch = (payload: object) =>
      app.inject({
        method: 'PATCH',
        url: `/admin/users/${target.id}`,
        cookies: admin.cookies,
        payload,
      });

    await patch({ status: 'disabled' });
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', cookies: session.cookies })).statusCode,
    ).toBe(401);
    expect((await login(app, target.username)).response.json().error).toBe('ACCOUNT_DISABLED');

    await patch({ status: 'active' });
    const again = await login(app, target.username);
    const reset = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/reset-password`,
      cookies: admin.cookies,
    });
    expect(reset.json().temporaryPassword).toBeTypeOf('string');
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', cookies: again.cookies })).statusCode,
    ).toBe(401);
    expect((await login(app, target.username)).response.statusCode).toBe(401);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}`,
      cookies: admin.cookies,
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      (await login(app, target.username, reset.json().temporaryPassword)).response.statusCode,
    ).toBe(401);
    await app.close();
  });

  it('un Admin ne peut ni se désactiver ni se supprimer', async () => {
    const app = await start();
    const admin = await account('admin');
    const session = await login(app, admin.username);
    const disable = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${admin.id}`,
      cookies: session.cookies,
      payload: { status: 'disabled' },
    });
    expect(disable.json().error).toBe('SELF_MODIFICATION');
    const remove = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${admin.id}`,
      cookies: session.cookies,
    });
    expect(remove.json().error).toBe('SELF_MODIFICATION');
    await app.close();
  });

  it('réserve l’administration aux Admins', async () => {
    const app = await start();
    const user = await login(app, (await account()).username);
    expect((await app.inject({ method: 'GET', url: '/admin/users' })).statusCode).toBe(401);
    const forbidden = await app.inject({
      method: 'GET',
      url: '/admin/users',
      cookies: user.cookies,
    });
    expect(forbidden.statusCode).toBe(403);
    const audit = await app.inject({
      method: 'GET',
      url: '/boards/demo/audit',
      cookies: user.cookies,
    });
    expect(audit.statusCode).toBe(403);
    await app.close();
  });

  it('refuse une requête qui modifie quelque chose depuis une autre origine', async () => {
    const app = await start();
    const { username } = await account();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: 'https://site-malveillant.example', host: 'localhost:3000' },
      payload: { identifier: username, password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    const same = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: { identifier: username, password: PASSWORD },
    });
    expect(same.statusCode).toBe(200);
    await app.close();
  });

  it('crée le premier Admin une seule fois, et trace les événements de compte', async () => {
    const app = await start();
    // Un Admin actif existe déjà (créé par les tests) : rien n'est créé.
    await account('admin');
    expect(await auth.ensureInitialAdmin({ username: 'premier-admin', password: PASSWORD })).toBe(
      false,
    );

    const admin = await account('admin');
    const session = await login(app, admin.username);
    await login(app, admin.username, 'mauvais-mot-de-passe');
    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit?limit=20',
      cookies: session.cookies,
    });
    const actions = (audit.json().entries as Array<{ action: string; objectId: string }>)
      .filter(({ objectId }) => objectId === admin.id)
      .map(({ action }) => action);
    expect(actions).toEqual(['auth.login_failed', 'auth.login']);
    await app.close();
  });

  it('WebSocket : session requise, nom du compte affiché, connexion fermée à la désactivation', async () => {
    const app = await start();
    const anonymous = await app.injectWS('/ws').then(
      () => 'ouverte',
      (error: Error) => error.message,
    );
    expect(anonymous).toMatch(/401/);

    const admin = await login(app, (await account('admin')).username);
    const target = await account();
    const session = await login(app, target.username);
    // Board de l'utilisateur : sans droit sur un board, la session serait refusée.
    const board = await app.inject({
      method: 'POST',
      url: '/boards',
      cookies: session.cookies,
      payload: { name: 'Session' },
    });
    const socket = await app.injectWS('/ws', {
      headers: { cookie: `${SESSION_COOKIE}=${session.cookies[SESSION_COOKIE]}` },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: 1 }));
    socket.send(
      JSON.stringify({
        type: 'JOIN',
        boardId: board.json().board.id,
        name: 'Nom choisi',
        clientId: 'c1',
      }),
    );
    await waitUntil(() => messages.some(({ type }) => type === 'JOINED'));
    const joined = messages.find(({ type }) => type === 'JOINED') as {
      participants: Array<{ name: string }>;
    };
    // Le nom vient du compte, pas du client.
    expect(joined.participants.map(({ name }) => name)).toEqual([`Nom ${target.username}`]);

    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}`,
      cookies: admin.cookies,
      payload: { status: 'disabled' },
    });
    expect(await closed).toBe(4401);
    await app.close();
  });
});

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  if (!condition()) throw new Error('Délai dépassé');
}
