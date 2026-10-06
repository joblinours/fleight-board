import { PARTICIPANT_COLORS } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { pickColor } from './hub';
import { MemoryBoardStore } from './store';
import { createNetwork } from './test-network';

async function setup() {
  let now = 0;
  const network = createNetwork('board', new MemoryBoardStore(), { now: () => now });
  const alice = network.connect('alice');
  const bob = network.connect('bob');
  await network.settle();
  return { network, alice, bob, advance: (ms: number) => (now += ms) };
}

describe('présence', () => {
  it('chaque participant reçoit une couleur distincte et le mode « cursor » par défaut', async () => {
    const { alice, bob } = await setup();
    const participants = alice.client.participants;
    expect(participants).toHaveLength(2);
    expect(new Set(participants.map(({ color }) => color)).size).toBe(2);
    expect(participants.every(({ mode }) => mode === 'cursor')).toBe(true);
    expect(bob.client.participants.map(({ color }) => color).sort()).toEqual(
      participants.map(({ color }) => color).sort(),
    );
  });

  it('relaie le curseur aux autres participants, et sa disparition', async () => {
    const { network, alice, bob, advance } = await setup();
    alice.client.moveCursor({ x: 10, y: 20 });
    await network.settle();
    expect(bob.client.cursors.get('alice')).toEqual({ x: 10, y: 20 });
    expect(alice.client.cursors.size).toBe(0);

    advance(100);
    alice.client.moveCursor(null);
    await network.settle();
    expect(bob.client.cursors.size).toBe(0);
  });

  it('limite le débit côté client : seule la dernière position d’une rafale part en différé', async () => {
    const { network, alice, bob, advance } = await setup();
    alice.client.moveCursor({ x: 1, y: 1 });
    alice.client.moveCursor({ x: 2, y: 2 });
    alice.client.moveCursor({ x: 3, y: 3 });
    expect(alice.outgoing.filter(({ type }) => type === 'CURSOR')).toHaveLength(1);
    alice.upload();
    await network.drain();
    advance(100);
    await network.settle();
    expect(bob.client.cursors.get('alice')).toEqual({ x: 3, y: 3 });
  });

  it('le serveur ignore les curseurs trop rapprochés', async () => {
    const { network, alice, bob } = await setup();
    // Sans avancer l'horloge du serveur : la seconde position est ignorée.
    alice.client.moveCursor({ x: 1, y: 1 });
    await network.settle();
    alice.client.moveCursor({ x: 9, y: 9 });
    await network.settle();
    expect(bob.client.cursors.get('alice')).toEqual({ x: 1, y: 1 });
  });

  it('mode « Drawing only » : le curseur disparaît et n’est plus relayé', async () => {
    const { network, alice, bob, advance } = await setup();
    alice.client.moveCursor({ x: 5, y: 5 });
    await network.settle();
    expect(bob.client.cursors.has('alice')).toBe(true);

    advance(100);
    alice.client.setPresenceMode('drawing');
    await network.settle();
    expect(bob.client.cursors.has('alice')).toBe(false);
    expect(bob.client.participants.find(({ name }) => name === 'alice')?.mode).toBe('drawing');

    advance(100);
    alice.client.moveCursor({ x: 50, y: 50 });
    await network.settle();
    expect(bob.client.cursors.has('alice')).toBe(false);
    // Même un client qui passerait outre n'est pas relayé par le serveur.
    expect(alice.outgoing.some(({ type }) => type === 'CURSOR')).toBe(false);
  });

  it('le mode est conservé à la reconnexion ; le départ efface le curseur', async () => {
    const { network, alice, bob, advance } = await setup();
    alice.client.setPresenceMode('drawing');
    await network.settle();
    alice.goOffline();
    alice.goOnline();
    await network.settle();
    expect(bob.client.participants.find(({ name }) => name === 'alice')?.mode).toBe('drawing');

    advance(100);
    bob.client.moveCursor({ x: 1, y: 2 });
    await network.settle();
    expect(alice.client.cursors.get('bob')).toEqual({ x: 1, y: 2 });
    bob.close();
    await network.settle();
    expect(alice.client.cursors.size).toBe(0);
  });
});

describe('pickColor', () => {
  it('stable pour un même utilisateur, une couleur libre sinon', () => {
    const first = pickColor('user-1', new Set());
    expect(pickColor('user-1', new Set())).toBe(first);
    const second = pickColor('user-1', new Set([first]));
    expect(second).not.toBe(first);
    expect(pickColor('user-1', new Set(PARTICIPANT_COLORS))).toBe(first);
  });
});
