import { describe, expect, it } from 'vitest';
import { MemoryBoardStore } from './store';
import { createNetwork, rect } from './test-network';

async function setup(hubOptions: { lockTtlMs?: number; now?: () => number } = {}) {
  const network = createNetwork('board', new MemoryBoardStore(), hubOptions);
  const alice = network.connect('alice');
  const bob = network.connect('bob');
  await network.settle();
  alice.client.applyLocal([{ kind: 'create', object: rect('a') }]);
  await network.settle();
  return { network, alice, bob };
}

describe('verrous', () => {
  it('un objet verrouillé par Alice ne peut être ni verrouillé ni modifié par Bob', async () => {
    const { network, alice, bob } = await setup();
    alice.client.lock(['a']);
    await network.settle();

    expect(bob.client.lockedByOther('a')).toBe('alice');
    expect(alice.client.lockedByOther('a')).toBeUndefined();

    bob.client.lock(['a']);
    await network.settle();
    expect(bob.events).toContainEqual({
      type: 'lockDenied',
      detail: { ids: ['a'], holder: 'alice' },
    });

    // Même en passant outre, le serveur refuse la modification et Bob est resynchronisé.
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 999 } }]);
    await network.settle();
    expect(bob.events).toContainEqual({ type: 'rejected', detail: 'LOCKED' });
    expect(bob.document.get('a')).toMatchObject({ x: 0 });

    // Alice, elle, modifie l'objet normalement.
    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 50 } }]);
    await network.settle();
    expect(bob.document.get('a')).toMatchObject({ x: 50 });
  });

  it('libère les verrous quand le détenteur les rend ou quitte le board', async () => {
    const { network, alice, bob } = await setup();
    alice.client.lock(['a']);
    await network.settle();
    alice.client.unlock(['a']);
    await network.settle();
    expect(bob.client.lockedByOther('a')).toBeUndefined();

    alice.client.lock(['a']);
    await network.settle();
    alice.close();
    await network.settle();
    expect(bob.client.lockedByOther('a')).toBeUndefined();
  });

  it('diffuse la libération après les dernières modifications du détenteur', async () => {
    const { network, alice, bob } = await setup();
    alice.client.lock(['a']);
    await network.settle();

    alice.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 70 } }]);
    alice.client.unlock(['a']);
    alice.upload();
    await network.drain();

    const types = bob.received.map(({ type }) => type);
    expect(types.indexOf('OPS')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('OPS')).toBeLessThan(types.lastIndexOf('LOCKS'));
  });

  it('fait expirer un verrou abandonné, et le renouvelle tant qu’il est tenu', async () => {
    let now = 0;
    const { network, alice, bob } = await setup({ lockTtlMs: 10_000, now: () => now });
    alice.client.lock(['a']);
    await network.settle();

    // Renouvellement côté client (tick) : le verrou survit au-delà de 10 s.
    now = 8_000;
    alice.tick();
    await network.settle();
    now = 15_000;
    await network.hub.sweepLocks();
    await network.settle();
    expect(bob.client.lockedByOther('a')).toBe('alice');

    // Onglet d'Alice gelé : plus rien n'arrive de sa part, le verrou expire.
    now = 40_000;
    await network.hub.sweepLocks();
    await network.drain();
    bob.download();
    expect(bob.client.lockedByOther('a')).toBeUndefined();
  });

  it('libère le verrou d’un objet supprimé', async () => {
    const { network, alice, bob } = await setup();
    alice.client.lock(['a']);
    await network.settle();
    alice.client.applyLocal([{ kind: 'delete', id: 'a' }]);
    await network.settle();

    expect(bob.document.has('a')).toBe(false);
    expect(bob.client.locks.has('a')).toBe(false);
  });

  it('rend un verrou accordé après un refus arrivé entre-temps', async () => {
    const { network, alice, bob } = await setup();
    alice.client.lock(['a']);
    await network.settle();

    // Bob demande le verrou : refusé, mais le refus n'est pas encore arrivé chez lui.
    bob.client.lock(['a']);
    bob.upload();
    await network.drain();
    // Alice relâche ; le renouvellement de Bob, parti entre-temps, obtient le verrou.
    alice.client.unlock(['a']);
    alice.upload();
    await network.drain();
    bob.tick();
    bob.upload();
    await network.drain();

    // Le refus fait abandonner l'objet à Bob : le verrou accordé ensuite doit être rendu.
    await network.settle();
    expect(bob.events).toContainEqual({
      type: 'lockDenied',
      detail: { ids: ['a'], holder: 'alice' },
    });
    expect(alice.client.lockedByOther('a')).toBeUndefined();
    expect(bob.client.locks.has('a')).toBe(false);
  });
});
