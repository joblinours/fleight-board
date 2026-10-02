import { describe, expect, it } from 'vitest';
import { createNetwork, rect, sorted, type TestClient } from './test-network';
import { createRandom } from './test-random';

const objects = (client: TestClient) => sorted([...client.document.all()]);

describe('session', () => {
  it('un participant qui rejoint reçoit l’état et la liste des participants', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();

    const bob = network.connect('bob');
    await network.settle();

    expect(objects(bob)).toEqual([rect('a')]);
    expect(bob.client.status).toBe('joined');
    expect(alice.client.participants.map(({ name }) => name)).toEqual(['alice', 'bob']);

    bob.close();
    await network.settle();
    expect(alice.client.participants.map(({ name }) => name)).toEqual(['alice']);
  });

  it('diffuse les modifications et confirme les lots', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();

    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    expect(alice.client.pendingCount).toBe(1);
    await network.settle();

    expect(objects(bob)).toEqual([rect('a')]);
    expect(alice.client.pendingCount).toBe(0);
    expect(alice.client.seq).toBe(1);
    expect(bob.client.seq).toBe(1);
  });
});

describe('modifications concurrentes', () => {
  async function twoClientsWithRect() {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();
    return { network, alice, bob };
  }

  for (const first of ['alice', 'bob'] as const) {
    it(`même propriété modifiée en même temps : ${first}, arrivé le premier, l’emporte`, async () => {
      const { network, alice, bob } = await twoClientsWithRect();
      alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 10 } }]);
      bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 20 } }]);

      // Le serveur reçoit les deux lots avant que quiconque ne reçoive quoi que ce soit.
      const [winner, loser] = first === 'alice' ? [alice, bob] : [bob, alice];
      winner.upload();
      await network.drain();
      loser.upload();
      await network.drain();
      alice.download();
      bob.download();
      await network.settle();

      // Le second lot a été fait sans connaître le premier : il est refusé (conflit).
      const expected = first === 'alice' ? 10 : 20;
      expect((await network.serverObjects())[0]).toMatchObject({ x: expected });
      expect(loser.events).toContainEqual({ type: 'rejected', detail: 'CONFLICT' });
      expect(objects(alice)).toEqual(await network.serverObjects());
      expect(objects(bob)).toEqual(await network.serverObjects());
    });
  }

  it('des propriétés différentes modifiées en même temps sont toutes conservées', async () => {
    const { network, alice, bob } = await twoClientsWithRect();
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 10 } }]);
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Router' } }]);
    alice.upload();
    bob.upload();
    await network.settle();

    expect((await network.serverObjects())[0]).toMatchObject({ x: 10, label: 'Router' });
    expect(objects(alice)).toEqual(await network.serverObjects());
    expect(objects(bob)).toEqual(await network.serverObjects());
  });

  it('un lot local en attente reste visible malgré une modification distante antérieure', async () => {
    const { network, alice, bob } = await twoClientsWithRect();
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 20 } }]);
    bob.upload();
    await network.drain();
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 10 } }]);
    // Alice reçoit la modification de Bob avant l'accusé de réception de la sienne.
    alice.download();

    expect(alice.document.get('a')).toMatchObject({ x: 10 });
    await network.settle();
    expect(objects(alice)).toEqual(await network.serverObjects());
    expect(objects(bob)).toEqual(await network.serverObjects());
  });

  it('resynchronise un client dont le lot est refusé (objet supprimé entre-temps)', async () => {
    const { network, alice, bob } = await twoClientsWithRect();
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Router' } }]);
    alice.client.applyLocal([{ kind: 'delete', id: 'a' }]);
    alice.upload();
    await network.drain();
    bob.upload();
    await network.settle();

    expect(await network.serverObjects()).toEqual([]);
    expect(objects(alice)).toEqual([]);
    expect(objects(bob)).toEqual([]);
  });

  it('regroupe les lots d’un geste et envoie le dernier marqué final', async () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    await network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    await network.settle();

    const gesture = { id: 'g1', final: false };
    for (let x = 1; x <= 5; x++) {
      alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x } }], gesture);
    }
    expect(alice.outgoing).toEqual([]);

    alice.tick();
    expect(alice.outgoing).toHaveLength(1);
    expect(alice.outgoing[0]).toMatchObject({
      operations: [{ kind: 'update', id: 'a', patch: { x: 5 } }],
      gesture: { id: 'g1', final: false },
    });

    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 6 } }], gesture);
    alice.client.endGesture('g1');
    expect(alice.outgoing[1]).toMatchObject({ gesture: { id: 'g1', final: true } });
  });

  it('converge avec 3 clients et des ordres de livraison aléatoires', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = createRandom(seed);
      const network = createNetwork();
      const clients = ['alice', 'bob', 'carol'].map((name) => network.connect(name));
      await network.settle();
      const ids = ['a', 'b', 'c', 'd'];
      clients[0]?.client.applyLocal(
        ids.map((id) => ({ kind: 'create' as const, object: rect(id) })),
      );
      await network.settle();

      for (let step = 0; step < 60; step++) {
        const client = clients[Math.floor(random() * clients.length)];
        if (!client) continue;
        const action = random();
        if (action < 0.55) {
          const existing = [...client.document.all()];
          const target = existing[Math.floor(random() * existing.length)];
          if (target) {
            const patch =
              random() < 0.5 ? { x: Math.round(random() * 500) } : { label: `L${step}` };
            client.client.applyLocal([{ kind: 'update', id: target.id, patch }]);
          }
        } else if (action < 0.65) {
          const existing = [...client.document.all()];
          const target = existing[Math.floor(random() * existing.length)];
          if (target) client.client.applyLocal([{ kind: 'delete', id: target.id }]);
        } else if (action < 0.75) {
          client.client.applyLocal([{ kind: 'create', object: rect(`n${seed}-${step}`) }]);
        } else if (action < 0.88) {
          client.upload();
          await network.drain();
        } else {
          client.download();
        }
      }
      await network.settle();

      const server = await network.serverObjects();
      for (const client of clients) {
        expect(objects(client), `graine ${seed}, ${client.name}`).toEqual(server);
        expect(client.client.pendingCount).toBe(0);
      }
    }
  });
});
