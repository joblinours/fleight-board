import type { ServerSessionMessage } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { CollaborationHub } from './hub';
import { type BoardCommit, MemoryBoardStore, mergeCommits } from './store';
import { createNetwork, drain, rect, sorted } from './test-network';

describe('persistance', () => {
  it('retrouve l’état après un redémarrage du serveur', async () => {
    const store = new MemoryBoardStore();
    const first = createNetwork('board', store);
    const alice = first.connect('alice');
    await first.settle();
    alice.client.applyLocal([
      { kind: 'create', object: rect('a') },
      { kind: 'create', object: rect('b', 200) },
    ]);
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Firewall' } }]);
    alice.client.applyLocal([{ kind: 'delete', id: 'b' }]);
    await first.settle();

    // Nouveau serveur, même stockage.
    const second = createNetwork('board', store);
    const bob = second.connect('bob');
    await second.settle();

    expect(sorted([...bob.document.all()])).toEqual([{ ...rect('a'), label: 'Firewall' }]);
    expect(bob.client.seq).toBe(3);
  });

  it('journalise un lot hors geste par entrée, et un geste complet en une seule entrée', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();

    const gesture = { id: 'drag-1', final: false };
    for (let x = 1; x <= 4; x++) {
      alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: x * 10 } }], gesture);
      alice.tick();
      await network.settle();
    }
    alice.client.endGesture('drag-1');
    await network.settle();

    const journal = network.store.journal.get('board') ?? [];
    expect(journal).toHaveLength(2);
    expect(journal[0]).toMatchObject({ actor: 'alice', operations: [{ kind: 'create' }] });
    expect(journal[1]).toMatchObject({
      actor: 'alice',
      gestureId: 'drag-1',
      operations: [{ kind: 'update', id: 'a', patch: { x: 40 } }],
    });
  });

  it('journalise un geste interrompu quand son auteur quitte le board', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }], { id: 'g', final: false });
    alice.tick();
    await network.settle();
    expect(network.store.journal.get('board')).toBeUndefined();

    alice.close();
    await network.drain();
    expect(network.store.journal.get('board')).toMatchObject([{ gestureId: 'g' }]);
  });

  it('décharge un board de la mémoire quand le dernier participant part', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    expect(network.hub.roomCount).toBe(1);

    alice.close();
    await network.drain();
    expect(network.hub.roomCount).toBe(0);
  });
});

describe('échec de l’enregistrement', () => {
  it('ne confirme pas le lot, déconnecte les participants et recharge l’état enregistré', async () => {
    const store = new MemoryBoardStore();
    let failing = false;
    const flaky = {
      load: (boardId: string) => store.load(boardId),
      commit: async (boardId: string, commit: BoardCommit) => {
        if (failing) throw new Error('base indisponible');
        await store.commit(boardId, commit);
      },
    };
    const hub = new CollaborationHub({ store: flaky });
    const received: ServerSessionMessage[] = [];
    let disconnected = false;
    const connection = hub.open(
      'alice',
      (message) => received.push(message),
      () => {
        disconnected = true;
      },
    );
    connection.receive({ type: 'JOIN', boardId: 'b', name: 'Alice', clientId: 'alice' });
    connection.receive({
      type: 'OPS',
      batchId: '1',
      baseSeq: 0,
      operations: [{ kind: 'create', object: rect('a') }],
    });
    await drain(hub);

    failing = true;
    connection.receive({
      type: 'OPS',
      batchId: '2',
      baseSeq: 1,
      operations: [{ kind: 'create', object: rect('z') }],
    });
    await drain(hub);

    expect(
      received.filter(({ type }) => type === 'ACK').map((m) => (m as { batchId: string }).batchId),
    ).toEqual(['1']);
    expect(disconnected).toBe(true);
    expect(hub.roomCount).toBe(0);

    // À la reconnexion, seul l'état réellement enregistré est servi.
    failing = false;
    const again: ServerSessionMessage[] = [];
    hub
      .open('alice-2', (message) => again.push(message))
      .receive({ type: 'JOIN', boardId: 'b', name: 'Alice', clientId: 'alice' });
    await drain(hub);
    expect(again[0]).toMatchObject({ type: 'JOINED', snapshot: { seq: 1, objects: [rect('a')] } });
  });
});

describe('regroupement des enregistrements', () => {
  it('enregistre en une transaction les lots arrivés pendant un enregistrement', async () => {
    const store = new MemoryBoardStore();
    const commits: BoardCommit[] = [];
    let release: (() => void) | undefined;
    const slow = {
      load: (boardId: string) => store.load(boardId),
      commit: async (boardId: string, commit: BoardCommit) => {
        commits.push(commit);
        // Le premier enregistrement reste en cours jusqu'à `release`.
        if (commits.length === 1) await new Promise<void>((resolve) => (release = resolve));
        await store.commit(boardId, commit);
      },
    };
    const hub = new CollaborationHub({ store: slow });
    const received: ServerSessionMessage[] = [];
    const connection = hub.open('alice', (message) => received.push(message));
    connection.receive({ type: 'JOIN', boardId: 'b', name: 'Alice', clientId: 'alice' });
    const batch = (
      batchId: string,
      baseSeq: number,
      operations: BoardCommit['journal'][0]['operations'],
    ) => connection.receive({ type: 'OPS', batchId, baseSeq, operations });
    batch('1', 0, [{ kind: 'create', object: rect('a') }]);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(commits).toHaveLength(1);
    batch('2', 1, [{ kind: 'update', id: 'a', patch: { x: 10 } }]);
    batch('3', 2, [{ kind: 'create', object: rect('b') }]);
    batch('4', 3, [{ kind: 'delete', id: 'b' }]);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    // Aucun accusé tant que rien n'est enregistré.
    expect(received.filter(({ type }) => type === 'ACK')).toEqual([]);

    release?.();
    await drain(hub);

    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({
      seq: 4,
      upserts: [{ object: { id: 'a', x: 10 }, version: 2 }],
      deletes: ['b'],
    });
    expect(commits[1]?.journal.map(({ seq }) => seq)).toEqual([2, 3, 4]);
    expect(
      received.filter(({ type }) => type === 'ACK').map((m) => (m as { batchId: string }).batchId),
    ).toEqual(['1', '2', '3', '4']);
    expect((await store.load('b'))?.objects).toEqual([{ ...rect('a'), x: 10 }]);
  });

  it('fusionne des commits : dernier état de chaque objet, journal dans l’ordre', () => {
    const entry = (seq: number) => ({ seq, actor: 'alice', operations: [] });
    expect(
      mergeCommits([
        {
          seq: 1,
          upserts: [{ object: rect('a'), version: 1 }],
          deletes: ['x'],
          journal: [entry(1)],
        },
        {
          seq: 2,
          upserts: [
            { object: rect('a', 5), version: 2 },
            { object: rect('x'), version: 1 },
          ],
          deletes: [],
          journal: [entry(2)],
        },
        { seq: 3, upserts: [], deletes: ['a'], journal: [entry(3)] },
      ]),
    ).toEqual({
      seq: 3,
      upserts: [{ object: rect('x'), version: 1 }],
      deletes: ['a'],
      journal: [entry(1), entry(2), entry(3)],
    });
  });
});

describe('boards gérés par l’API', () => {
  it('refuse de rejoindre un board absent du stockage', async () => {
    const hub = new CollaborationHub({ requireExistingBoards: true });
    const received: ServerSessionMessage[] = [];
    const reasons: string[] = [];
    hub
      .open(
        'alice',
        (message) => received.push(message),
        (reason) => reasons.push(reason),
      )
      .receive({ type: 'JOIN', boardId: 'inconnu', name: 'Alice', clientId: 'alice' });
    await drain(hub);

    expect(reasons).toEqual(['board-not-found']);
    expect(received).toEqual([]);
    expect(hub.roomCount).toBe(0);
  });

  it('un board supprimé est déchargé et ses participants déconnectés', async () => {
    const store = new MemoryBoardStore();
    await store.commit('b', { seq: 0, upserts: [], deletes: [], journal: [] });
    const hub = new CollaborationHub({ store, requireExistingBoards: true });
    const reasons: string[] = [];
    for (const name of ['alice', 'bob']) {
      hub
        .open(
          name,
          () => {},
          (reason) => reasons.push(`${name}:${reason}`),
        )
        .receive({ type: 'JOIN', boardId: 'b', name, clientId: name });
    }
    await drain(hub);
    expect(hub.roomCount).toBe(1);

    hub.evict('b');
    expect(reasons.sort()).toEqual(['alice:board-deleted', 'bob:board-deleted']);
    expect(hub.roomCount).toBe(0);
  });
});
