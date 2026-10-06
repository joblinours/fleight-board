import { CollaborationHub } from '@fleight/collaboration';
import { createId } from '@fleight/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { AuthService } from '../auth/auth-service';
import { hashPassword } from '../auth/passwords';
import { SESSION_COOKIE } from '../auth/routes';
import { connectDatabase, type Database } from '../database';
import { PostgresAuditLog } from '../db/audit-log';
import { PostgresBoardStore } from '../db/board-store';
import { boardMembers, users } from '../db/schema';
import { BoardService } from './board-service';
import { GUEST_COOKIE } from './guest-auth';

/** Tests sur un vrai PostgreSQL, ignorés sans TEST_DATABASE_URL (voir board-store.test.ts). */
const url = process.env.TEST_DATABASE_URL;
const PASSWORD = 'correct-horse-battery';

type Cookies = Record<string, string>;

describe.skipIf(!url)('sessions publiques et privées, invités, durées d’accès', () => {
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let hub: CollaborationHub;

  beforeAll(async () => {
    database = connectDatabase(url as string);
    app = await buildApp({
      database: { ping: async () => true },
      auth: new AuthService(database.db),
      audit: new PostgresAuditLog(database.db),
      boards: new BoardService(database.db),
      createHub: (log) => {
        hub = new CollaborationHub({
          log,
          store: new PostgresBoardStore(database.db),
          requireExistingBoards: true,
        });
        return hub;
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  const address = () =>
    `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  async function signIn() {
    const username = `user-${createId().slice(-10).toLowerCase()}`;
    await database.db.insert(users).values({
      id: createId(),
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: address(),
      payload: { identifier: username, password: PASSWORD },
    });
    const cookies: Cookies = {
      [SESSION_COOKIE]: login.cookies.find(({ name }) => name === SESSION_COOKIE)?.value as string,
    };
    return { id: login.json().user.id as string, username, cookies, request: requester(cookies) };
  }

  function requester(cookies: Cookies) {
    return (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
      app.inject({
        method,
        url: path,
        cookies,
        remoteAddress: address(),
        ...(payload ? { payload } : {}),
      });
  }

  async function joinAsGuest(code: string, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/boards/code/${code}/guest`,
      remoteAddress: address(),
      payload: { name },
    });
    const token = response.cookies.find(({ name: cookie }) => cookie === GUEST_COOKIE)?.value;
    const cookies: Cookies = token ? { [GUEST_COOKIE]: token } : {};
    return { response, cookies, request: requester(cookies) };
  }

  /** Session WebSocket ; `messages` reçus et code de fermeture. */
  async function connect(cookies: Cookies, boardId: string) {
    const socket = await app.injectWS('/ws', {
      headers: {
        cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      },
    });
    const messages: Array<Record<string, unknown>> = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: 1 }));
    socket.send(JSON.stringify({ type: 'JOIN', boardId, name: 'x', clientId: createId() }));
    return {
      socket,
      messages,
      closed,
      has: (type: string) => messages.some((m) => m.type === type),
    };
  }

  async function until(condition: () => boolean) {
    for (let i = 0; i < 300 && !condition(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(condition()).toBe(true);
  }

  async function privateBoard(settings: object = {}) {
    const owner = await signIn();
    const board = (await owner.request('POST', '/boards', { name: 'Privé' })).json().board;
    await owner.request('PATCH', `/boards/${board.id}`, { visibility: 'private', ...settings });
    return { owner, board };
  }

  it('session publique : entrée directe avec le rôle par défaut', async () => {
    const owner = await signIn();
    const visitor = await signIn();
    const board = (await owner.request('POST', '/boards', { name: 'Public' })).json().board;
    expect(board).toMatchObject({
      visibility: 'public',
      defaultRole: 'editor',
      allowGuests: false,
    });
    await owner.request('PATCH', `/boards/${board.id}`, { defaultRole: 'viewer' });
    const found = await visitor.request('GET', `/boards/code/${board.code}`);
    expect(found.json().board.role).toBe('viewer');
    const session = await connect(visitor.cookies, board.id);
    await until(() => session.has('JOINED'));
    session.socket.close();
  });

  it('session privée : demande, salle d’attente, acceptation en direct', async () => {
    const { owner, board } = await privateBoard();
    const alice = await signIn();
    const editor = await signIn();
    await owner.request('POST', `/boards/${board.id}/members`, {
      identifier: editor.username,
      role: 'editor',
    });

    // Le propriétaire est connecté : il sera prévenu de la demande.
    const ownerSession = await connect(owner.cookies, board.id);
    await until(() => ownerSession.has('JOINED'));
    const editorSession = await connect(editor.cookies, board.id);
    await until(() => editorSession.has('JOINED'));

    expect((await alice.request('GET', `/boards/${board.id}`)).statusCode).toBe(403);
    expect((await alice.request('POST', `/boards/${board.id}/access-requests`)).json()).toEqual({
      status: 'pending',
    });
    // Une seconde demande ne crée pas de doublon.
    await alice.request('POST', `/boards/${board.id}/access-requests`);
    await until(() => ownerSession.has('ACCESS_REQUESTED'));
    expect(editorSession.has('ACCESS_REQUESTED')).toBe(false);

    const waiting = await connect(alice.cookies, board.id);
    await until(() => waiting.has('ACCESS_PENDING'));
    expect(waiting.has('JOINED')).toBe(false);

    expect((await editor.request('GET', `/boards/${board.id}/access-requests`)).statusCode).toBe(
      403,
    );
    const requests = (await owner.request('GET', `/boards/${board.id}/access-requests`)).json()
      .requests;
    expect(requests).toEqual([expect.objectContaining({ kind: 'user', username: alice.username })]);
    const accepted = await owner.request(
      'POST',
      `/boards/${board.id}/access-requests/${requests[0].id}`,
      { decision: 'accept', role: 'editor', duration: { kind: 'temporary', minutes: 60 } },
    );
    expect(accepted.statusCode).toBe(204);
    await until(() => waiting.has('JOINED'));
    expect(waiting.messages.find(({ type }) => type === 'JOINED')).toMatchObject({
      role: 'editor',
    });
    expect((await alice.request('GET', `/boards/${board.id}/access-request`)).json()).toEqual({
      status: 'granted',
    });
    const member = (await owner.request('GET', `/boards/${board.id}/members`)).json().members;
    expect(member.find(({ userId }: { userId: string }) => userId === alice.id).expiresAt).not.toBe(
      null,
    );

    // Accès temporaire expiré : la session est fermée au prochain contrôle.
    await database.db
      .update(boardMembers)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(boardMembers.userId, alice.id));
    await hub.refreshAllAccess();
    await until(() => waiting.socket.readyState === waiting.socket.CLOSED);
    expect((await alice.request('GET', `/boards/${board.id}`)).statusCode).toBe(403);
    for (const session of [ownerSession, editorSession, waiting]) session.socket.close();
  });

  it('session privée : une demande refusée ferme la salle d’attente', async () => {
    const { owner, board } = await privateBoard();
    const bob = await signIn();
    await bob.request('POST', `/boards/${board.id}/access-requests`);
    const waiting = await connect(bob.cookies, board.id);
    await until(() => waiting.has('ACCESS_PENDING'));
    const [request] = (await owner.request('GET', `/boards/${board.id}/access-requests`)).json()
      .requests;
    await owner.request('POST', `/boards/${board.id}/access-requests/${request.id}`, {
      decision: 'deny',
    });
    expect(await waiting.closed).toBe(4403);
    expect((await bob.request('GET', `/boards/${board.id}/access-request`)).json()).toEqual({
      status: 'denied',
    });
    // Sans demande en attente, la connexion est refusée d'emblée.
    const refused = await connect(bob.cookies, board.id);
    expect(await refused.closed).toBe(4403);
  });

  it('accès « tant que le détenteur est connecté »', async () => {
    const { owner, board } = await privateBoard();
    const carol = await signIn();
    await carol.request('POST', `/boards/${board.id}/access-requests`);
    const [request] = (await owner.request('GET', `/boards/${board.id}/access-requests`)).json()
      .requests;
    await owner.request('POST', `/boards/${board.id}/access-requests/${request.id}`, {
      decision: 'accept',
      role: 'viewer',
      duration: { kind: 'while-connected' },
    });
    // Le propriétaire n'est pas connecté au board : pas d'accès.
    expect((await carol.request('GET', `/boards/${board.id}`)).statusCode).toBe(403);

    const host = await connect(owner.cookies, board.id);
    await until(() => host.has('JOINED'));
    expect((await carol.request('GET', `/boards/${board.id}`)).json().board.role).toBe('viewer');
    const session = await connect(carol.cookies, board.id);
    await until(() => session.has('JOINED'));

    // Le détenteur part : l'accès prend fin et la session est fermée.
    // Coupure de la connexion (la fermeture propre n'aboutit pas avec injectWS).
    host.socket.terminate();
    expect(await session.closed).toBe(4403);
  });

  it('invités : refusés par défaut, entrée directe en session publique', async () => {
    const owner = await signIn();
    const board = (await owner.request('POST', '/boards', { name: 'Atelier' })).json().board;
    const refused = await joinAsGuest(board.code, 'Zoé');
    expect(refused.response.statusCode).toBe(403);
    expect(refused.response.json().error).toBe('GUESTS_NOT_ALLOWED');

    await owner.request('PATCH', `/boards/${board.id}`, {
      allowGuests: true,
      defaultRole: 'viewer',
    });
    const guest = await joinAsGuest(board.code.toLowerCase(), '  Zoé  ');
    expect(guest.response.statusCode).toBe(201);
    expect(guest.response.json()).toMatchObject({
      guest: { displayName: 'Zoé', boardId: board.id, role: 'viewer' },
      board: { id: board.id, role: 'viewer' },
    });
    expect((await guest.request('GET', '/guest')).json().guest.displayName).toBe('Zoé');
    // Un invité n'accède pas au reste de l'API.
    expect((await guest.request('GET', '/boards')).statusCode).toBe(401);

    const session = await connect(guest.cookies, board.id);
    await until(() => session.has('JOINED'));
    const joined = session.messages.find(({ type }) => type === 'JOINED') as {
      role: string;
      participants: Array<{ name: string; guest?: boolean }>;
    };
    expect(joined.role).toBe('viewer');
    expect(joined.participants).toEqual([expect.objectContaining({ name: 'Zoé', guest: true })]);

    // Il apparaît dans les membres ; un Co-owner peut le retirer.
    const members = (await owner.request('GET', `/boards/${board.id}/members`)).json();
    expect(members.guests).toEqual([
      expect.objectContaining({ displayName: 'Zoé', role: 'viewer' }),
    ]);
    await owner.request('DELETE', `/boards/${board.id}/guests/${members.guests[0].guestId}`);
    expect(await session.closed).toBe(4403);

    // Un invité est limité à son board.
    const other = (await owner.request('POST', '/boards', { name: 'Autre' })).json().board;
    const guest2 = await joinAsGuest(board.code, 'Yann');
    const elsewhere = await connect(guest2.cookies, other.id);
    expect(await elsewhere.closed).toBe(4403);
  });

  it('invités en session privée : demande d’accès, au plus Editor', async () => {
    const { owner, board } = await privateBoard({ allowGuests: true });
    const guest = await joinAsGuest(board.code, 'Inès');
    expect(guest.response.json().guest.role).toBe(null);
    const waiting = await connect(guest.cookies, board.id);
    await until(() => waiting.has('ACCESS_PENDING'));

    const [request] = (await owner.request('GET', `/boards/${board.id}/access-requests`)).json()
      .requests;
    expect(request).toMatchObject({ kind: 'guest', displayName: 'Inès', username: null });
    const tooHigh = await owner.request(
      'POST',
      `/boards/${board.id}/access-requests/${request.id}`,
      {
        decision: 'accept',
        role: 'co-owner',
      },
    );
    expect(tooHigh.statusCode).toBe(400);
    await owner.request('POST', `/boards/${board.id}/access-requests/${request.id}`, {
      decision: 'accept',
      role: 'editor',
    });
    await until(() => waiting.has('JOINED'));

    const audit = (await owner.request('GET', `/boards/${board.id}/audit`)).json().entries;
    expect(audit.map(({ action }: { action: string }) => action)).toEqual(
      expect.arrayContaining(['board.guest.join', 'board.access.request', 'board.access.accept']),
    );
    expect(
      audit.find(({ action }: { action: string }) => action === 'board.guest.join'),
    ).toMatchObject({ actorType: 'guest' });
    waiting.socket.close();
  });

  it('code : après trop de codes inexistants, l’adresse doit attendre', async () => {
    const user = await signIn();
    const ip = address();
    const lookup = (code: string) =>
      app.inject({
        method: 'GET',
        url: `/boards/code/${code}`,
        cookies: user.cookies,
        remoteAddress: ip,
      });
    for (let i = 0; i < 10; i++) expect((await lookup('ZZZZZZ')).statusCode).toBe(404);
    const blocked = await lookup('ZZZZZZ');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('CODE_COOLDOWN');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
