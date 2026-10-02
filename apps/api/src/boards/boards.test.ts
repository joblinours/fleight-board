import { CollaborationHub } from '@fleight/collaboration';
import { createId } from '@fleight/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { AuthService } from '../auth/auth-service';
import { hashPassword } from '../auth/passwords';
import { SESSION_COOKIE } from '../auth/routes';
import { connectDatabase, type Database } from '../database';
import { PostgresAuditLog } from '../db/audit-log';
import { PostgresBoardStore } from '../db/board-store';
import { users } from '../db/schema';
import { BoardService } from './board-service';

/** Tests sur un vrai PostgreSQL, ignorés sans TEST_DATABASE_URL (voir board-store.test.ts). */
const url = process.env.TEST_DATABASE_URL;
const PASSWORD = 'correct-horse-battery';

describe.skipIf(!url)('whiteboards', () => {
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    database = connectDatabase(url as string);
    app = await buildApp({
      database: { ping: async () => true },
      auth: new AuthService(database.db),
      audit: new PostgresAuditLog(database.db),
      boards: new BoardService(database.db),
      createHub: (log) =>
        new CollaborationHub({
          log,
          store: new PostgresBoardStore(database.db),
          requireExistingBoards: true,
        }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  /** Compte créé en base puis connecté ; retourne de quoi faire des requêtes en son nom. */
  async function signIn(role: 'admin' | 'user' = 'user') {
    const username = `${role}-${createId().slice(-10).toLowerCase()}`;
    await database.db.insert(users).values({
      id: createId(),
      username,
      displayName: username,
      passwordHash: await hashPassword(PASSWORD),
      role,
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      // Adresse distincte par compte : la limite de connexions par IP ne gêne pas les tests.
      remoteAddress: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: { identifier: username, password: PASSWORD },
    });
    const token = login.cookies.find(({ name }) => name === SESSION_COOKIE)?.value as string;
    const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
      app.inject({
        method,
        url: path,
        cookies: { [SESSION_COOKIE]: token },
        ...(payload ? { payload } : {}),
      });
    return { id: login.json().user.id as string, token, request };
  }

  it('crée un board infini par défaut, ou une page standard ; code court unique', async () => {
    const alice = await signIn();
    const infinite = await alice.request('POST', '/boards', { name: '  Réseau du site  ' });
    expect(infinite.statusCode).toBe(201);
    expect(infinite.json().board).toMatchObject({
      name: 'Réseau du site',
      description: '',
      canvas: { kind: 'infinite' },
      ownerId: alice.id,
      hidden: false,
    });
    expect(infinite.json().board.code).toMatch(/^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{6}$/);

    const page = await alice.request('POST', '/boards', {
      name: 'Affiche',
      description: 'Format A4 paysage',
      canvas: { kind: 'standard', format: 'A4', width: 1123, height: 794 },
    });
    expect(page.json().board.canvas).toEqual({
      kind: 'standard',
      format: 'A4',
      width: 1123,
      height: 794,
    });
    expect(page.json().board.code).not.toBe(infinite.json().board.code);

    const invalid = await alice.request('POST', '/boards', {
      name: 'Trop grand',
      canvas: { kind: 'standard', format: 'custom', width: 50_000, height: 100 },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await alice.request('POST', '/boards', { name: ' ' })).statusCode).toBe(400);
  });

  it('liste ses propres boards, sans les boards masqués sauf demande', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const first = (await alice.request('POST', '/boards', { name: 'Premier' })).json().board;
    const second = (await alice.request('POST', '/boards', { name: 'Second' })).json().board;
    await bob.request('POST', '/boards', { name: 'Celui de Bob' });

    const list = await alice.request('GET', '/boards');
    expect(list.json().boards.map(({ name }: { name: string }) => name)).toEqual([
      'Second',
      'Premier',
    ]);

    await alice.request('PATCH', `/boards/${first.id}`, { hidden: true });
    const visible = (await alice.request('GET', '/boards')).json().boards;
    expect(visible.map(({ id }: { id: string }) => id)).toEqual([second.id]);
    const all = (await alice.request('GET', '/boards?hidden=true')).json().boards;
    expect(all).toHaveLength(2);
  });

  it('retrouve un board par son code, quelle que soit la casse', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const board = (await alice.request('POST', '/boards', { name: 'Partagé' })).json().board;

    const found = await bob.request('GET', `/boards/code/${board.code.toLowerCase()}`);
    expect(found.statusCode).toBe(200);
    expect(found.json().board.id).toBe(board.id);
    expect((await bob.request('GET', '/boards/code/ZZZZZZ')).statusCode).toBe(404);
    expect((await bob.request('GET', '/boards/code/O0I1S5')).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/boards/code/${board.code}` })).statusCode,
    ).toBe(401);
  });

  it('seul le propriétaire renomme, masque ou supprime ; la suppression est immédiate', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const board = (await alice.request('POST', '/boards', { name: 'Brouillon' })).json().board;

    const renamed = await alice.request('PATCH', `/boards/${board.id}`, {
      name: 'Version finale',
      description: 'Relue',
    });
    expect(renamed.json().board).toMatchObject({ name: 'Version finale', description: 'Relue' });

    expect((await bob.request('PATCH', `/boards/${board.id}`, { name: 'Volé' })).statusCode).toBe(
      403,
    );
    expect((await bob.request('DELETE', `/boards/${board.id}`)).statusCode).toBe(403);

    expect((await alice.request('DELETE', `/boards/${board.id}`)).statusCode).toBe(204);
    expect((await alice.request('GET', `/boards/${board.id}`)).statusCode).toBe(404);
    expect((await alice.request('DELETE', `/boards/${board.id}`)).statusCode).toBe(404);
  });

  it('accepte un identifiant choisi, unique', async () => {
    const alice = await signIn();
    const id = `demo-${createId().slice(-8).toLowerCase()}`;
    expect((await alice.request('POST', '/boards', { id, name: 'Démo' })).statusCode).toBe(201);
    const taken = await alice.request('POST', '/boards', { id, name: 'Encore' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('ID_TAKEN');
  });

  it('trace la création, la modification et la suppression ; audit réservé au propriétaire et aux Admins', async () => {
    const alice = await signIn();
    const bob = await signIn();
    const admin = await signIn('admin');
    const board = (await alice.request('POST', '/boards', { name: 'Audité' })).json().board;
    await alice.request('PATCH', `/boards/${board.id}`, { name: 'Audité bis' });

    const own = await alice.request('GET', `/boards/${board.id}/audit`);
    expect(own.json().entries.map(({ action }: { action: string }) => action)).toEqual([
      'board.update',
      'board.create',
    ]);
    expect((await bob.request('GET', `/boards/${board.id}/audit`)).statusCode).toBe(403);
    expect((await admin.request('GET', `/boards/${board.id}/audit`)).statusCode).toBe(200);

    await alice.request('DELETE', `/boards/${board.id}`);
    // Le board n'existe plus, l'audit si : un Admin retrouve la suppression.
    const afterDelete = await admin.request('GET', `/boards/${board.id}/audit`);
    expect(afterDelete.json().entries[0]).toMatchObject({
      action: 'board.delete',
      actor: alice.id,
      metadata: { name: 'Audité bis' },
    });
  });

  it('WebSocket : board inexistant refusé, board supprimé pendant la session', async () => {
    const alice = await signIn();
    const connect = async (boardId: string) => {
      const socket = await app.injectWS('/ws', {
        headers: { cookie: `${SESSION_COOKIE}=${alice.token}` },
      });
      const messages: Array<Record<string, unknown>> = [];
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      const closed = new Promise<number>((resolve) => socket.once('close', resolve));
      socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: 1 }));
      socket.send(JSON.stringify({ type: 'JOIN', boardId, name: 'Alice', clientId: createId() }));
      return { messages, closed };
    };

    const missing = await connect(`absent-${createId()}`);
    expect(await missing.closed).toBe(4404);
    expect(missing.messages.at(-1)).toMatchObject({ type: 'ERROR', code: 'BOARD_NOT_FOUND' });

    const board = (await alice.request('POST', '/boards', { name: 'Éphémère' })).json().board;
    const session = await connect(board.id);
    for (let i = 0; i < 100 && !session.messages.some(({ type }) => type === 'JOINED'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(session.messages.some(({ type }) => type === 'JOINED')).toBe(true);
    await alice.request('DELETE', `/boards/${board.id}`);
    expect(await session.closed).toBe(4410);
  });
});
