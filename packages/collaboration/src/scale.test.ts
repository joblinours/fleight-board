import type { BoardObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { SimulatedUser, type SimulationStep } from './simulation';
import { type BoardCommit, MemoryBoardStore } from './store';
import { createNetwork, rect, sorted, type TestClient } from './test-network';
import { createRandom } from './test-random';

type Scenario = { users: number; rounds: number; seeds: number };

/**
 * M0.11 — N utilisateurs agissent en même temps : déplacements verrouillés,
 * tracés, renommages, créations, suppressions, annulations et coupures réseau,
 * avec un ordre de livraison aléatoire. À la fin, tous les clients doivent avoir
 * exactement l'état du serveur, sans modification en attente ni verrou résiduel.
 */
const SCENARIOS: Scenario[] = [
  { users: 2, rounds: 150, seeds: 10 },
  { users: 5, rounds: 120, seeds: 6 },
  { users: 20, rounds: 80, seeds: 3 },
  { users: 50, rounds: 50, seeds: 2 },
];

/** Multiplie le nombre de graines (vérification ponctuelle : `SCALE_SEED_FACTOR=50`). */
const SEED_FACTOR = Number(process.env.SCALE_SEED_FACTOR ?? 1);

describe('collaboration à plusieurs', () => {
  for (const { users, rounds, seeds: baseSeeds } of SCENARIOS) {
    const seeds = baseSeeds * SEED_FACTOR;
    it(`${users} utilisateurs convergent (${seeds} graines × ${rounds} tours)`, async () => {
      const counts: Record<string, number> = {};
      for (let seed = 1; seed <= seeds; seed++) {
        for (const [kind, count] of Object.entries(await runScenario(users, rounds, seed))) {
          counts[kind] = (counts[kind] ?? 0) + count;
        }
      }
      // Toutes les sortes d'actions ont été exercées.
      expect(Object.values(counts).every((count) => count > 0)).toBe(true);
    });
  }
});

async function runScenario(
  userCount: number,
  rounds: number,
  seed: number,
): Promise<Record<string, number>> {
  const random = createRandom(seed * 1000 + userCount);
  // Enregistrements lents (un tour de boucle) : les lots s'accumulent derrière
  // les états complets envoyés immédiatement (JOINED, SNAPSHOT), comme en production.
  const memory = new MemoryBoardStore();
  const store = {
    load: (boardId: string) => memory.load(boardId),
    commit: async (boardId: string, commit: BoardCommit) => {
      await new Promise((resolve) => setImmediate(resolve));
      await memory.commit(boardId, commit);
    },
  };
  const network = createNetwork('board', store);
  const clients = Array.from({ length: userCount }, (_, index) => network.connect(`u${index}`));
  await network.settle();
  clients[0]?.client.applyLocal(
    Array.from({ length: 10 }, (_, index) => ({
      kind: 'create' as const,
      object: rect(`seed-${index}`, index * 150),
    })),
  );
  await network.settle();

  const users = clients.map(
    (client) => new SimulatedUser(client.client, createRandom(random() * 2 ** 32), client.name),
  );
  const queues = new Map<TestClient, SimulationStep[]>(clients.map((client) => [client, []]));
  const runStep = (client: TestClient, user: SimulatedUser) => {
    const queue = queues.get(client) ?? [];
    if (!queue.length && random() < 0.6) queue.push(...user.nextAction());
    queue.shift()?.();
    queues.set(client, queue);
  };

  for (let round = 0; round < rounds; round++) {
    clients.forEach((client, index) => {
      const user = users[index];
      if (user) runStep(client, user);
    });
    // Réseau : chaque client envoie, reçoit ou se déconnecte au hasard.
    for (const client of clients) {
      const roll = random();
      if (roll < 0.5) {
        client.tick();
        client.upload();
      } else if (roll < 0.85) {
        client.download();
      } else if (roll < 0.87) {
        if (client.client.status === 'closed') client.goOnline();
        else client.goOffline();
      }
    }
    // Le plus souvent, le serveur n'a pas fini d'enregistrer quand les clients continuent.
    if (random() < 0.2) await network.drain();
    else for (let i = 0; i < 50; i++) await Promise.resolve();
  }

  // Fin : chaque utilisateur termine son action en cours, tout le monde revient en ligne.
  clients.forEach((client) => {
    for (const step of queues.get(client)?.splice(0) ?? []) step();
  });
  for (const client of clients) if (client.client.status === 'closed') client.goOnline();
  await network.settle();
  await network.settle();

  const server = await network.serverObjects();
  const context = `${userCount} utilisateurs, graine ${seed}`;
  for (const client of clients) {
    expect(objects(client), `${context}, ${client.name}`).toEqual(server);
    expect(client.client.pendingCount, `${context}, ${client.name}`).toBe(0);
    expect(client.client.locks.size, `${context}, verrous vus par ${client.name}`).toBe(0);
  }
  const counts: Record<string, number> = {};
  for (const user of users) {
    for (const [kind, count] of Object.entries(user.counts))
      counts[kind] = (counts[kind] ?? 0) + count;
  }
  return counts;
}

function objects(client: TestClient): BoardObject[] {
  return sorted([...client.document.all()]);
}
