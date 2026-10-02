import { createId } from '@fleight/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { connectDatabase, type Database } from '../database';
import { PostgresAuditLog } from './audit-log';
import { PostgresBoardStore } from './board-store';

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

    const entries = await audit.list(boardId, 10);
    expect(entries.map(({ id: _id, createdAt: _createdAt, ...entry }) => entry)).toEqual([
      {
        actor: 'alice',
        actorType: 'client',
        action: 'object.delete',
        objectId: 'a',
        sessionId: null,
        metadata: { seq: 3, intent: 'undo' },
      },
      {
        actor: 'bob',
        actorType: 'client',
        action: 'object.update',
        objectId: 'a',
        sessionId: 'conn-2',
        metadata: { seq: 2, gestureId: 'g1', fields: ['x', 'y'] },
      },
      {
        actor: 'alice',
        actorType: 'client',
        action: 'object.create',
        objectId: 'a',
        sessionId: 'conn-1',
        metadata: { seq: 1, objectType: 'rectangle' },
      },
    ]);
    expect(Date.parse(entries[0]?.createdAt ?? '')).not.toBeNaN();
    expect(await audit.list(boardId, 1)).toHaveLength(1);
  });

  it('expose l’audit d’un board en HTTP', async () => {
    const boardId = `audit-${createId()}`;
    await store.commit(boardId, {
      seq: 1,
      upserts: [{ object: rectangle('a'), version: 1 }],
      deletes: [],
      journal: [
        { seq: 1, actor: 'alice', operations: [{ kind: 'create', object: rectangle('a') }] },
      ],
    });
    const app = await buildApp({ database: { ping: async () => true }, audit });

    const response = await app.inject({ method: 'GET', url: `/boards/${boardId}/audit` });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toMatchObject([{ actor: 'alice', action: 'object.create' }]);

    const invalid = await app.inject({ method: 'GET', url: `/boards/${boardId}/audit?limit=0` });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
