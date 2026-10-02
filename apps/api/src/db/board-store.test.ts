import { CollaborationHub } from '@fleight/collaboration';
import { createId } from '@fleight/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { buildApp } from '../app';
import { connectDatabase, type Database } from '../database';
import { identifyAnyone } from '../test-helpers';
import { PostgresBoardStore, SNAPSHOT_INTERVAL } from './board-store';
import { operations, snapshots } from './schema';

/**
 * Tests sur un vrai PostgreSQL. Ils sont ignorés si TEST_DATABASE_URL n'est pas défini
 * (la CI fournit une base ; en local : `pnpm db:up` puis
 * TEST_DATABASE_URL=postgres://fleight:fleight@localhost:5432/fleight pnpm test).
 */
const url = process.env.TEST_DATABASE_URL;

const rectangle = (id: string, x = 0) => ({
  type: 'rectangle' as const,
  id,
  zIndex: 0,
  x,
  y: 0,
  width: 100,
  height: 50,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 2,
  label: '',
});

describe.skipIf(!url)('PostgresBoardStore', () => {
  let database: Database;
  let store: PostgresBoardStore;

  beforeAll(async () => {
    database = connectDatabase(url as string);
    store = new PostgresBoardStore(database.db);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('retourne undefined pour un board inconnu', async () => {
    expect(await store.load(`inconnu-${createId()}`)).toBeUndefined();
  });

  it('enregistre et recharge l’état courant, les versions et le journal', async () => {
    const boardId = `test-${createId()}`;
    await store.commit(boardId, {
      seq: 1,
      upserts: [
        { object: rectangle('a'), version: 1 },
        { object: rectangle('b', 200), version: 1 },
      ],
      deletes: [],
      journal: [
        {
          seq: 1,
          actor: 'alice',
          operations: [{ kind: 'create', object: rectangle('a') }],
        },
      ],
    });
    await store.commit(boardId, {
      seq: 2,
      upserts: [{ object: { ...rectangle('a'), label: 'Firewall' }, version: 2 }],
      deletes: ['b'],
      journal: [
        {
          seq: 2,
          actor: 'bob',
          gestureId: 'g1',
          intent: 'undo',
          operations: [{ kind: 'update', id: 'a', patch: { label: 'Firewall' } }],
        },
      ],
    });

    expect(await store.load(boardId)).toEqual({
      seq: 2,
      objects: [{ ...rectangle('a'), label: 'Firewall' }],
      versions: { a: 2 },
    });

    const journal = await database.db
      .select()
      .from(operations)
      .where(eq(operations.boardId, boardId))
      .orderBy(operations.seq);
    expect(
      journal.map(({ seq, actor, gestureId, intent }) => ({ seq, actor, gestureId, intent })),
    ).toEqual([
      { seq: 1, actor: 'alice', gestureId: null, intent: null },
      { seq: 2, actor: 'bob', gestureId: 'g1', intent: 'undo' },
    ]);
  });

  it('conserve une copie complète à chaque palier de séquence', async () => {
    const boardId = `test-${createId()}`;
    await store.commit(boardId, {
      seq: SNAPSHOT_INTERVAL - 1,
      upserts: [{ object: rectangle('a'), version: 1 }],
      deletes: [],
      journal: [],
    });
    await store.commit(boardId, {
      seq: SNAPSHOT_INTERVAL,
      upserts: [{ object: rectangle('b'), version: 1 }],
      deletes: [],
      journal: [],
    });

    const rows = await database.db.select().from(snapshots).where(eq(snapshots.boardId, boardId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(SNAPSHOT_INTERVAL);
    expect(rows[0]?.objects.map(({ id }) => id).sort()).toEqual(['a', 'b']);
  });

  it('ne perd rien quand l’API redémarre', async () => {
    const boardId = `restart-${createId()}`;

    const start = () =>
      buildApp({
        database: { ping: async () => true },
        identify: identifyAnyone,
        createHub: (log) => new CollaborationHub({ store, log }),
      });

    const session = async (app: Awaited<ReturnType<typeof start>>) => {
      await app.ready();
      const socket: WebSocket = await app.injectWS('/ws');
      const messages: Array<Record<string, unknown>> = [];
      socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
      const waitFor = async (type: string) => {
        for (let i = 0; i < 200; i++) {
          const found = messages.find((message) => message.type === type);
          if (found) return found;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`${type} non reçu`);
      };
      socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: 1 }));
      await waitFor('HELLO');
      socket.send(JSON.stringify({ type: 'JOIN', boardId, name: 'Alice', clientId: 'alice' }));
      return { socket, joined: await waitFor('JOINED'), waitFor };
    };

    const first = await start();
    const alice = await session(first);
    alice.socket.send(
      JSON.stringify({
        type: 'OPS',
        batchId: 'b1',
        baseSeq: 0,
        operations: [{ kind: 'create', object: rectangle('router') }],
      }),
    );
    await alice.waitFor('ACK');
    alice.socket.terminate();
    await first.close();

    const second = await start();
    const bob = await session(second);
    expect(bob.joined).toMatchObject({
      snapshot: { boardId, seq: 1, objects: [rectangle('router')], versions: { router: 1 } },
    });
    bob.socket.terminate();
    await second.close();
  });
});
