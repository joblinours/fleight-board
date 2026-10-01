import { describe, expect, it } from 'vitest';
import { createNetwork, rect, sorted, type TestClient } from './test-network';
import { createRandom } from './test-random';

const objects = (client: TestClient) => sorted([...client.document.all()]);

describe('session', () => {
  it('un participant qui rejoint reçoit l’état et la liste des participants', () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    network.settle();

    const bob = network.connect('bob');
    network.settle();

    expect(objects(bob)).toEqual([rect('a')]);
    expect(bob.client.status).toBe('joined');
    expect(alice.client.participants.map(({ name }) => name)).toEqual(['alice', 'bob']);

    bob.close();
    network.settle();
    expect(alice.client.participants.map(({ name }) => name)).toEqual(['alice']);
  });

  it('diffuse les modifications et confirme les lots', () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    network.settle();

    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    expect(alice.client.pendingCount).toBe(1);
    network.settle();

    expect(objects(bob)).toEqual([rect('a')]);
    expect(alice.client.pendingCount).toBe(0);
    expect(alice.client.seq).toBe(1);
    expect(bob.client.seq).toBe(1);
  });
});

describe('modifications concurrentes', () => {
  function twoClientsWithRect() {
    const network = createNetwork();
    const alice = network.connect('alice');
    const bob = network.connect('bob');
    network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    network.settle();
    return { network, alice, bob };
  }

  for (const first of ['alice', 'bob'] as const) {
    it(`converge sur un même champ quand ${first} arrive en premier au serveur`, () => {
      const { network, alice, bob } = twoClientsWithRect();
      alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 10 } }]);
      bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 20 } }]);

      // Le serveur reçoit les deux lots avant que quiconque ne reçoive quoi que ce soit.
      const [winnerLast, loserFirst] = first === 'alice' ? [bob, alice] : [alice, bob];
      loserFirst.upload();
      winnerLast.upload();
      alice.download();
      bob.download();
      network.settle();

      const expected = first === 'alice' ? 20 : 10;
      expect(network.serverObjects()[0]).toMatchObject({ x: expected });
      expect(objects(alice)).toEqual(network.serverObjects());
      expect(objects(bob)).toEqual(network.serverObjects());
    });
  }

  it('un lot local en attente reste visible malgré une modification distante antérieure', () => {
    const { network, alice, bob } = twoClientsWithRect();
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 20 } }]);
    bob.upload();
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 10 } }]);
    // Alice reçoit la modification de Bob avant l'accusé de réception de la sienne.
    alice.download();

    expect(alice.document.get('a')).toMatchObject({ x: 10 });
    network.settle();
    expect(objects(alice)).toEqual(network.serverObjects());
    expect(objects(bob)).toEqual(network.serverObjects());
  });

  it('resynchronise un client dont le lot est refusé (objet supprimé entre-temps)', () => {
    const { network, alice, bob } = twoClientsWithRect();
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { label: 'Router' } }]);
    alice.client.applyLocal([{ kind: 'delete', id: 'a' }]);
    alice.upload();
    bob.upload();
    network.settle();

    expect(network.serverObjects()).toEqual([]);
    expect(objects(alice)).toEqual([]);
    expect(objects(bob)).toEqual([]);
  });

  it('regroupe les lots d’un geste et envoie le dernier marqué final', () => {
    const network = createNetwork();
    const alice = network.connect('alice');
    network.settle();
    alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
    network.settle();

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

  it('converge avec 3 clients et des ordres de livraison aléatoires', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = createRandom(seed);
      const network = createNetwork();
      const clients = ['alice', 'bob', 'carol'].map((name) => network.connect(name));
      network.settle();
      const ids = ['a', 'b', 'c', 'd'];
      clients[0]?.client.applyLocal(
        ids.map((id) => ({ kind: 'create' as const, object: rect(id) })),
      );
      network.settle();

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
        } else {
          client.download();
        }
      }
      network.settle();

      const server = network.serverObjects();
      for (const client of clients) {
        expect(objects(client), `graine ${seed}, ${client.name}`).toEqual(server);
        expect(client.client.pendingCount).toBe(0);
      }
    }
  });
});
