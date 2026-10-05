import { createId } from '@fleight/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { AuthService } from '../auth/auth-service';
import { hashPassword } from '../auth/passwords';
import { SESSION_COOKIE } from '../auth/routes';
import { BoardService } from '../boards/board-service';
import { connectDatabase, type Database } from '../database';
import { createTestBoard } from '../test-helpers';
import { PostgresAuditLog, writeAuditEvent } from './audit-log';
import { PostgresBoardStore } from './board-store';
import { users } from './schema';

/** Tests sur un vrai PostgreSQL, ignorés sans TEST_DATABASE_URL (voir board-store.test.ts). */
const url = process.env.TEST_DATABASE_URL;

const rectangle = (id: string) => ({
  type: 'rectangle' as const,
  id,
  zIndex: 0,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 2,
  label: '',
});

describe.skipIf(!url)('audit_logs', () => {
  let database: Database;
  let store: PostgresBoardStore;
  let audit: PostgresAuditLog;

  beforeAll(async () => {
    database = connectDatabase(url as string);
    store = new PostgresBoardStore(database.db);
    audit = new PostgresAuditLog(database.db);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('enregistre une entrée par opération finale, avec le journal', async () => {
    const boardId = `audit-${createId()}`;
    await createTestBoard(database.db, boardId);
    await store.commit(boardId, {
      seq: 1,
      upserts: [{ object: rectangle('a'), version: 1 }],
      deletes: [],
      journal: [
        {
          seq: 1,
          actor: 'alice',
          session: 'conn-1',
          operations: [{ kind: 'create', object: rectangle('a') }],
        },
      ],
    });
    await store.commit(boardId, {
      seq: 3,
      upserts: [],
      deletes: ['a'],
      journal: [
        {
          seq: 2,
          actor: 'bob',
          session: 'conn-2',
          gestureId: 'g1',
          operations: [{ kind: 'update', id: 'a', patch: { x: 10, y: 5 } }],
        },
        { seq: 3, actor: 'alice', intent: 'undo', operations: [{ kind: 'delete', id: 'a' }] },
      ],
    });
    // Commit sans journal (lots d'un geste en cours) : pas d'audit.
    await store.commit(boardId, { seq: 4, upserts: [], deletes: [], journal: [] });

    const { entries } = await audit.query({ boardId, limit: 10 });
    expect(entries.map(({ id: _id, createdAt: _createdAt, ...entry }) => entry)).toEqual([
      {
        actor: 'alice',
        actorType: 'client',
        action: 'object.delete',
        boardId,
        objectId: 'a',
        sessionId: null,
        metadata: { seq: 3, intent: 'undo' },
      },
      {
        actor: 'bob',
        actorType: 'client',
        action: 'object.update',
        boardId,
        objectId: 'a',
        sessionId: 'conn-2',
        metadata: { seq: 2, gestureId: 'g1', fields: ['x', 'y'] },
      },
      {
        actor: 'alice',
        actorType: 'client',
        action: 'object.create',
        boardId,
        objectId: 'a',
        sessionId: 'conn-1',
        metadata: { seq: 1, objectType: 'rectangle' },
      },
    ]);
    expect(Date.parse(entries[0]?.createdAt ?? '')).not.toBeNaN();
    expect((await audit.query({ boardId, limit: 1 })).entries).toHaveLength(1);
  });

  it('expose l’audit d’un board en HTTP', async () => {
    const boardId = `audit-${createId()}`;
    await createTestBoard(database.db, boardId);
    await store.commit(boardId, {
      seq: 1,
      upserts: [{ object: rectangle('a'), version: 1 }],
      deletes: [],
      journal: [
        { seq: 1, actor: 'alice', operations: [{ kind: 'create', object: rectangle('a') }] },
      ],
    });
    const auth = new AuthService(database.db);
    const app = await buildApp({
      database: { ping: async () => true },
      auth,
      audit,
      boards: new BoardService(database.db),
    });
    const username = `admin-${createId().slice(-10).toLowerCase()}`;
    await database.db.insert(users).values({
      id: createId(),
      username,
      displayName: 'Admin',
      passwordHash: await hashPassword('mot-de-passe-admin'),
      role: 'admin',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: username, password: 'mot-de-passe-admin' },
    });
    const cookies = { [SESSION_COOKIE]: login.cookies[0]?.value as string };

    const response = await app.inject({
      method: 'GET',
      url: `/boards/${boardId}/audit`,
      cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toMatchObject([{ actor: 'alice', action: 'object.create' }]);

    const invalid = await app.inject({
      method: 'GET',
      url: `/boards/${boardId}/audit?limit=0`,
      cookies,
    });
    expect(invalid.statusCode).toBe(400);

    // Filtres en paramètres de requête ; audit global de l'Admin.
    const filtered = await app.inject({
      method: 'GET',
      url: `/boards/${boardId}/audit?category=access`,
      cookies,
    });
    expect(filtered.json()).toEqual({ entries: [], nextBefore: null });
    const global = await app.inject({
      method: 'GET',
      url: `/admin/audit?scope=boards&boardId=${boardId}&q=alice`,
      cookies,
    });
    expect(global.json().entries).toMatchObject([{ boardId, action: 'object.create' }]);
    expect(
      (await app.inject({ method: 'GET', url: '/admin/audit?scope=tout', cookies })).statusCode,
    ).toBe(400);
    await app.close();
  });
  it('filtre par famille, auteur, recherche, période ; pagine vers les plus anciennes', async () => {
    const boardId = `audit-${createId()}`;
    await createTestBoard(database.db, boardId);
    await store.commit(boardId, {
      seq: 3,
      upserts: [
        { object: rectangle('a'), version: 1 },
        { object: rectangle('b'), version: 1 },
      ],
      deletes: [],
      journal: [
        {
          seq: 1,
          actor: 'u-alice',
          actorType: 'user',
          actorName: 'Alice Martin',
          operations: [{ kind: 'create', object: rectangle('a') }],
        },
        {
          seq: 2,
          actor: 'u-bob',
          actorType: 'user',
          actorName: 'Bob',
          operations: [{ kind: 'create', object: rectangle('b') }],
        },
        {
          seq: 3,
          actor: 'u-alice',
          actorType: 'user',
          actorName: 'Alice Martin',
          operations: [{ kind: 'update', id: 'b', patch: { x: 3 } }],
        },
      ],
    });
    await writeAuditEvent(database.db, {
      actor: 'u-alice',
      actorType: 'user',
      action: 'board.member.add',
      boardId,
      metadata: { actorName: 'Alice Martin', member: 'u-bob' },
    });

    const all = await audit.query({ boardId, limit: 10 });
    expect(all.entries).toHaveLength(4);
    expect(all.nextBefore).toBeNull();

    const access = await audit.query({ boardId, limit: 10, category: 'access' });
    expect(access.entries.map(({ action }) => action)).toEqual(['board.member.add']);
    const objects = await audit.query({
      boardId,
      limit: 10,
      category: 'objects',
      actor: 'u-alice',
    });
    expect(objects.entries.map(({ action }) => action)).toEqual(['object.update', 'object.create']);
    // Recherche insensible à la casse dans le nom, l'auteur ou l'objet ; jokers pris littéralement.
    expect((await audit.query({ boardId, limit: 10, q: 'martin' })).entries).toHaveLength(3);
    expect((await audit.query({ boardId, limit: 10, q: '%' })).entries).toHaveLength(0);
    expect((await audit.query({ boardId, limit: 10, objectId: 'b' })).entries).toHaveLength(2);
    expect((await audit.query({ boardId, limit: 10, from: '2100-01-01' })).entries).toHaveLength(0);
    expect((await audit.query({ boardId, limit: 10, to: '2000-01-01' })).entries).toHaveLength(0);

    // Pages de 3, puis la suivante à partir du curseur.
    const first = await audit.query({ boardId, limit: 3 });
    expect(first.entries).toHaveLength(3);
    expect(first.nextBefore).toBe(first.entries[2]?.id);
    const second = await audit.query({ boardId, limit: 3, before: first.nextBefore ?? 0 });
    expect(second.entries.map(({ action }) => action)).toEqual(['object.create']);
    expect(second.nextBefore).toBeNull();

    // Hors board : événements de compte seulement ; tous les boards : aucun événement de compte.
    const accounts = await audit.query({ limit: 50, scope: 'accounts' });
    expect(accounts.entries.every(({ boardId: id }) => id === null)).toBe(true);
    const boards = await audit.query({ limit: 50, scope: 'boards' });
    expect(boards.entries.every(({ boardId: id }) => id !== null)).toBe(true);
  });
});
