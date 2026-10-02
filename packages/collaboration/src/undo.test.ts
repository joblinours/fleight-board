import { UndoHistory } from '@fleight/document';
import type { Operation } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { createNetwork, rect, sorted, type TestClient } from './test-network';

/** Client avec son historique individuel, comme l'éditeur. */
function withHistory(client: TestClient) {
  const history = new UndoHistory();
  return {
    act(operations: Operation[]) {
      history.track(client.document, operations, () => client.client.applyLocal(operations));
    },
    undo() {
      return history.undo(client.document, (operations) =>
        client.client.applyLocal(operations, undefined, 'undo'),
      );
    },
    redo() {
      return history.redo(client.document, (operations) =>
        client.client.applyLocal(operations, undefined, 'redo'),
      );
    },
  };
}

describe('undo individuel en collaboration', () => {
  it('Alice annule son déplacement sans toucher à la couleur choisie par Bob', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('x') }]);
    await network.settle();

    const aliceHistory = withHistory(alice);
    const bobHistory = withHistory(bob);
    aliceHistory.act([{ kind: 'update', id: 'x', patch: { x: 120, y: 60 } }]);
    await network.settle();
    bobHistory.act([{ kind: 'update', id: 'x', patch: { fill: '#ff0000' } }]);
    await network.settle();

    expect(aliceHistory.undo()).toEqual({ applied: true, skipped: [] });
    await network.settle();

    const expected = { ...rect('x'), fill: '#ff0000' };
    expect(await network.serverObjects()).toEqual([expected]);
    expect(sorted([...alice.document.all()])).toEqual([expected]);
    expect(sorted([...bob.document.all()])).toEqual([expected]);

    // L'annulation est journalisée comme telle (base de l'audit).
    const journal = network.store.journal.get('board') ?? [];
    expect(journal.at(-1)).toMatchObject({ actor: 'alice', intent: 'undo' });

    aliceHistory.redo();
    await network.settle();
    expect(bob.document.get('x')).toMatchObject({ x: 120, y: 60, fill: '#ff0000' });
    expect((network.store.journal.get('board') ?? []).at(-1)).toMatchObject({ intent: 'redo' });
  });

  it('l’annulation d’Alice est ignorée si Bob a supprimé l’objet entre-temps', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('x') }]);
    await network.settle();

    const aliceHistory = withHistory(alice);
    aliceHistory.act([{ kind: 'update', id: 'x', patch: { x: 50 } }]);
    await network.settle();
    bob.client.applyLocal([{ kind: 'delete', id: 'x' }]);
    await network.settle();

    expect(aliceHistory.undo()).toEqual({ applied: false, skipped: ['x'] });
    await network.settle();
    expect(await network.serverObjects()).toEqual([]);
  });
});
