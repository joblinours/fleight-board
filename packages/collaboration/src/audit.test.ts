import { UndoHistory } from '@fleight/document';
import { describe, expect, it } from 'vitest';
import { auditEntriesOf } from './audit';
import { createNetwork, rect } from './test-network';

describe('auditEntriesOf', () => {
  it('produit une entrée par opération, avec ses détails', () => {
    const entries = auditEntriesOf('board', {
      seq: 7,
      actor: 'alice',
      session: 'conn-1',
      actorName: 'Alice',
      gestureId: 'g',
      intent: 'undo',
      operations: [
        { kind: 'create', object: rect('a') },
        { kind: 'update', id: 'b', patch: { y: 2, x: 1 } },
        { kind: 'delete', id: 'c' },
      ],
    });

    const common = { boardId: 'board', actor: 'alice', actorType: 'client', session: 'conn-1' };
    const metadata = { seq: 7, actorName: 'Alice', gestureId: 'g', intent: 'undo' };
    expect(entries).toEqual([
      {
        ...common,
        action: 'object.create',
        objectId: 'a',
        metadata: { ...metadata, objectType: 'rectangle' },
      },
      {
        ...common,
        action: 'object.update',
        objectId: 'b',
        metadata: { ...metadata, fields: ['x', 'y'] },
      },
      { ...common, action: 'object.delete', objectId: 'c', metadata },
    ]);
  });
});

describe('audit en collaboration', () => {
  it('un geste de plusieurs lots ne produit qu’une entrée par objet', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();

    const gesture = { id: 'drag-1', final: false };
    for (let x = 1; x <= 5; x++) {
      alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: x * 10 } }], gesture);
      alice.tick();
      await network.settle();
    }
    alice.client.endGesture('drag-1');
    await network.settle();

    expect(network.store.audit).toMatchObject([
      { action: 'object.create', objectId: 'a', actor: 'alice' },
      {
        action: 'object.update',
        objectId: 'a',
        actor: 'alice',
        metadata: { actorName: 'alice', gestureId: 'drag-1', fields: ['x'] },
      },
    ]);
    // La session est la connexion, distincte du client.
    expect(network.store.audit[0]?.session).toEqual(expect.any(String));
  });

  it('enregistre les annulations et rétablissements', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    const history = new UndoHistory();
    history.track(alice.document, [{ kind: 'create', object: rect('a') }], () =>
      alice.client.applyLocal([{ kind: 'create', object: rect('a') }]),
    );
    await network.settle();
    history.undo(alice.document, (operations) =>
      alice.client.applyLocal(operations, undefined, 'undo'),
    );
    await network.settle();
    history.redo(alice.document, (operations) =>
      alice.client.applyLocal(operations, undefined, 'redo'),
    );
    await network.settle();

    expect(
      network.store.audit.map(({ action, metadata }) => [action, metadata.intent ?? null]),
    ).toEqual([
      ['object.create', null],
      ['object.delete', 'undo'],
      ['object.create', 'redo'],
    ]);
  });

  it('n’enregistre rien pour un lot refusé', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();

    // Même propriété modifiée en parallèle : le lot de Bob arrive second et est refusé.
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Alice' } }]);
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Bob' } }]);
    await network.settle();

    expect(network.store.audit.map(({ action, actor }) => [action, actor])).toEqual([
      ['object.create', 'alice'],
      ['object.update', 'alice'],
    ]);
  });
});
