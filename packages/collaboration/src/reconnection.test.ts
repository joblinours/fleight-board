import { describe, expect, it } from 'vitest';
import { type BoardCommit, MemoryBoardStore } from './store';
import { createNetwork, rect, sorted, type TestClient } from './test-network';
import { createRandom } from './test-random';

const objects = (client: TestClient) => sorted([...client.document.all()]);

async function setup() {
  const network = createNetwork();
  const alice = network.connect('alice');
  const bob = network.connect('bob');
  await network.settle();
  alice.client.applyLocal([
    { kind: 'create', object: rect('a') },
    { kind: 'create', object: rect('b', 200) },
  ]);
  await network.settle();
  return { network, alice, bob };
}

describe('reconnexion', () => {
  it('les modifications faites hors connexion partent au retour du réseau', async () => {
    const { network, alice, bob } = await setup();
    alice.goOffline();
    await network.settle();

    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 80 } }]);
    alice.client.applyLocal([{ kind: 'create', object: rect('c', 400) }]);
    bob.client.applyLocal([{ kind: 'update', id: 'b', patch: { label: 'Switch' } }]);
    await network.settle();

    expect(alice.client.status).toBe('closed');
    expect(alice.client.pendingCount).toBe(2);
    expect(alice.client.pendingActions).toBe(2);
    expect(bob.document.has('c')).toBe(false);

    alice.goOnline();
    await network.settle();

    const server = await network.serverObjects();
    expect(server.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(server.find(({ id }) => id === 'a')).toMatchObject({ x: 80 });
    expect(server.find(({ id }) => id === 'b')).toMatchObject({ label: 'Switch' });
    expect(objects(alice)).toEqual(server);
    expect(objects(bob)).toEqual(server);
    expect(alice.client.pendingCount).toBe(0);
  });

  it('refuse une modification hors ligne en conflit, sans perdre les autres', async () => {
    const { network, alice, bob } = await setup();
    alice.goOffline();

    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Alice' } }]); // conflit
    alice.client.applyLocal([{ kind: 'update', id: 'b', patch: { x: 300 } }]); // sans conflit
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Bob' } }]);
    await network.settle();

    alice.goOnline();
    await network.settle();

    const server = await network.serverObjects();
    expect(server.find(({ id }) => id === 'a')).toMatchObject({ label: 'Bob' });
    expect(server.find(({ id }) => id === 'b')).toMatchObject({ x: 300 });
    expect(alice.events).toEqual([{ type: 'rejected', detail: 'CONFLICT' }]);
    expect(objects(alice)).toEqual(server);
  });

  it('n’applique pas deux fois un lot dont l’accusé de réception a été perdu', async () => {
    const { network, alice, bob } = await setup();
    alice.client.applyLocal([{ kind: 'create', object: rect('c', 400) }]);
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 5 } }]);
    alice.upload();
    await network.drain();
    // Le serveur a appliqué les lots, mais la connexion tombe avant les accusés.
    alice.goOffline();
    alice.goOnline();
    await network.settle();

    expect(alice.events).toEqual([]);
    expect(alice.client.pendingCount).toBe(0);
    expect(objects(alice)).toEqual(await network.serverObjects());
    expect(objects(bob)).toEqual(await network.serverObjects());
    expect(
      network.store.journal
        .get('board')
        ?.filter(({ operations }) =>
          operations.some(
            (operation) => operation.kind === 'create' && operation.object.id === 'c',
          ),
        ),
    ).toHaveLength(1);
  });

  it('un geste interrompu par la coupure est terminé au retour', async () => {
    const { network, alice, bob } = await setup();
    const gesture = { id: 'drag', final: false };
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 10 } }], gesture);
    alice.tick();
    await network.settle();
    alice.goOffline();
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 30 } }], gesture);
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 60 } }], gesture);
    // Un geste en plusieurs lots compte pour une seule action en attente.
    expect(alice.client.pendingActions).toBe(1);
    alice.client.endGesture('drag');
    alice.goOnline();
    await network.settle();

    expect(bob.document.get('a')).toMatchObject({ x: 60 });
    expect(alice.client.pendingCount).toBe(0);
  });

  it('converge malgré des coupures aléatoires (3 clients)', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const random = createRandom(seed);
      const network = createNetwork();
      const clients = ['alice', 'bob', 'carol'].map((name) => network.connect(name));
      await network.settle();
      clients[0]?.client.applyLocal(
        ['a', 'b', 'c', 'd'].map((id) => ({ kind: 'create' as const, object: rect(id) })),
      );
      await network.settle();

      for (let step = 0; step < 60; step++) {
        const client = clients[Math.floor(random() * clients.length)];
        if (!client) continue;
        const action = random();
        const existing = [...client.document.all()];
        const target = existing[Math.floor(random() * existing.length)];
        if (action < 0.5 && target) {
          const patch = random() < 0.5 ? { x: Math.round(random() * 500) } : { label: `L${step}` };
          client.client.applyLocal([{ kind: 'update', id: target.id, patch }]);
        } else if (action < 0.58 && target) {
          client.client.applyLocal([{ kind: 'delete', id: target.id }]);
        } else if (action < 0.66) {
          client.client.applyLocal([{ kind: 'create', object: rect(`n${seed}-${step}`) }]);
        } else if (action < 0.74) {
          if (client.client.status === 'closed') client.goOnline();
          else client.goOffline();
        } else if (action < 0.87) {
          client.upload();
          await network.drain();
        } else {
          client.download();
        }
      }
      for (const client of clients) if (client.client.status === 'closed') client.goOnline();
      await network.settle();

      const server = await network.serverObjects();
      for (const client of clients) {
        expect(objects(client), `graine ${seed}, ${client.name}`).toEqual(server);
        expect(client.client.pendingCount, `graine ${seed}, ${client.name}`).toBe(0);
      }
    }
  });

  it('ignore les opérations diffusées en retard, déjà incluses dans l’état reçu', async () => {
    // Stockage dont on libère les enregistrements un par un.
    const store = new MemoryBoardStore();
    const waiting: Array<() => void> = [];
    let gated = false;
    const slow = {
      load: (boardId: string) => store.load(boardId),
      commit: async (boardId: string, commit: BoardCommit) => {
        if (gated) await new Promise<void>((resolve) => waiting.push(resolve));
        await store.commit(boardId, commit);
      },
    };
    const network = createNetwork('board', slow);
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();
    gated = true;
    const send = async (
      client: TestClient,
      operations: Parameters<TestClient['client']['applyLocal']>[0],
    ) => {
      client.client.applyLocal(operations);
      client.tick();
      client.upload();
      await microtasks();
    };

    // Bob crée « c » (1er enregistrement, bloqué) puis déplace « a » (en file).
    await send(bob, [{ kind: 'create', object: rect('c') }]);
    await send(bob, [{ kind: 'update', id: 'a', patch: { x: 10 } }]);
    // Alice se reconnecte : l'état reçu contient déjà les deux lots de Bob.
    alice.goOffline();
    alice.goOnline();
    alice.upload();
    await microtasks();
    alice.download();
    // Elle déplace « a » à son tour, en connaissance de cause.
    await send(alice, [{ kind: 'update', id: 'a', patch: { x: 20 } }]);

    // La création de « c » est enfin diffusée : déjà connue d'Alice.
    waiting.shift()?.();
    await microtasks();
    alice.download();
    alice.upload();
    await microtasks();
    alice.download();
    // Puis le déplacement de Bob, plus ancien que l'état d'Alice.
    gated = false;
    waiting.shift()?.();
    await network.settle();

    expect(await network.serverObjects()).toEqual([{ ...rect('a'), x: 20 }, rect('c')]);
    expect(objects(alice)).toEqual([{ ...rect('a'), x: 20 }, rect('c')]);
    expect(objects(bob)).toEqual([{ ...rect('a'), x: 20 }, rect('c')]);
  });

  it('ne réapplique pas sur un état complet un lot qu’il inclut déjà', async () => {
    const store = new MemoryBoardStore();
    let release = () => {};
    let gate: Promise<void> | undefined;
    const slow = {
      load: (boardId: string) => store.load(boardId),
      commit: async (boardId: string, commit: BoardCommit) => {
        await gate;
        await store.commit(boardId, commit);
      },
    };
    const network = createNetwork('board', slow);
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();
    alice.client.applyLocal([
      { kind: 'create', object: rect('a') },
      { kind: 'create', object: rect('b', 200) },
    ]);
    await network.settle();
    bob.client.lock(['b']);
    await network.settle();
    gate = new Promise<void>((resolve) => (release = resolve));
    const send = async (
      client: TestClient,
      operations: Parameters<TestClient['client']['applyLocal']>[0],
    ) => {
      client.client.applyLocal(operations);
      client.tick();
      client.upload();
      await microtasks();
    };

    // Alice déplace « a » : appliqué par le serveur, pas encore confirmé.
    await send(alice, [{ kind: 'update', id: 'a', patch: { x: 5 } }]);
    // Bob le voit (reconnexion) et le déplace à son tour.
    bob.goOffline();
    bob.goOnline();
    bob.upload();
    await microtasks();
    bob.download();
    await send(bob, [{ kind: 'update', id: 'a', patch: { x: 7 } }]);
    // Alice touche « b », verrouillé par Bob : refus, puis état complet (x: 7).
    await send(alice, [{ kind: 'update', id: 'b', patch: { x: 1 } }]);
    alice.download();
    alice.upload();
    await microtasks();
    alice.download();
    expect(alice.document.get('a')).toMatchObject({ x: 7 });

    release();
    await network.settle();
    expect(await network.serverObjects()).toEqual([{ ...rect('a'), x: 7 }, rect('b', 200)]);
    expect(objects(alice)).toEqual([{ ...rect('a'), x: 7 }, rect('b', 200)]);
    expect(objects(bob)).toEqual([{ ...rect('a'), x: 7 }, rect('b', 200)]);
  });
});

async function microtasks() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
