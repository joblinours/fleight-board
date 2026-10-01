import type { ServerSessionMessage } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { CollaborationHub } from './hub';
import { type BoardCommit, MemoryBoardStore } from './store';
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
    connection.receive({ type: 'JOIN', boardId: 'b', name: 'Alice' });
    connection.receive({
      type: 'OPS',
      batchId: '1',
      operations: [{ kind: 'create', object: rect('a') }],
    });
    await drain(hub);

    failing = true;
    connection.receive({
      type: 'OPS',
      batchId: '2',
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
      .receive({ type: 'JOIN', boardId: 'b', name: 'Alice' });
    await drain(hub);
    expect(again[0]).toMatchObject({ type: 'JOINED', snapshot: { seq: 1, objects: [rect('a')] } });
  });
});
