import type { BoardRole } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { MemoryBoardStore } from './store';
import { createNetwork, rect } from './test-network';

/** Réseau dont les rôles viennent d'une table modifiable (utilisateur → rôle). */
async function setup(roles: Record<string, BoardRole | undefined>) {
  const network = createNetwork('board', new MemoryBoardStore(), {
    authorize: (_boardId, user) => (user ? roles[user.id] : undefined),
  });
  const owner = network.connect('owner', { asUser: true });
  await network.settle();
  owner.client.applyLocal([{ kind: 'create', object: rect('a') }]);
  await network.settle();
  return { network, owner, roles };
}

describe('permissions du hub', () => {
  it('un Viewer voit le board mais ne peut ni modifier ni verrouiller', async () => {
    const { network, owner } = await setup({ owner: 'owner', viewer: 'viewer' });
    const viewer = network.connect('viewer', { asUser: true });
    await network.settle();
    expect(viewer.client.role).toBe('viewer');
    expect(viewer.document.get('a')).toBeDefined();

    viewer.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 500 } }]);
    viewer.client.lock(['a']);
    await network.settle();
    expect(viewer.events).toContainEqual({ type: 'rejected', detail: 'FORBIDDEN' });
    // Resynchronisé : la modification refusée a disparu, rien n'a bougé chez l'Owner.
    expect(viewer.document.get('a')).toMatchObject({ x: 0 });
    expect(owner.document.get('a')).toMatchObject({ x: 0 });
    expect(owner.client.lockedByOther('a')).toBeUndefined();
  });

  it('sans accès, la connexion est refusée', async () => {
    const { network } = await setup({ owner: 'owner' });
    const stranger = network.connect('stranger', { asUser: true });
    await network.settle();
    expect(stranger.disconnects).toEqual(['forbidden']);
    expect(stranger.client.status).not.toBe('joined');
  });

  it('les participants voient le rôle de chacun', async () => {
    const { network, owner } = await setup({ owner: 'owner', editor: 'editor' });
    network.connect('editor', { asUser: true });
    await network.settle();
    expect(owner.client.participants.map(({ name, role }) => [name, role])).toEqual([
      ['owner', 'owner'],
      ['editor', 'editor'],
    ]);
  });

  it('un changement de rôle s’applique en direct ; une révocation déconnecte', async () => {
    const { network, owner, roles } = await setup({ owner: 'owner', bob: 'editor' });
    const bob = network.connect('bob', { asUser: true });
    await network.settle();
    bob.client.lock(['a']);
    await network.settle();
    expect(owner.client.lockedByOther('a')).toBe('bob');

    // Rétrogradé en Viewer : il rend ses verrous et ne peut plus modifier.
    roles.bob = 'viewer';
    await network.hub.refreshAccess('board');
    await network.settle();
    expect(bob.client.role).toBe('viewer');
    expect(owner.client.participants.find(({ name }) => name === 'bob')?.role).toBe('viewer');
    expect(owner.client.lockedByOther('a')).toBeUndefined();
    bob.client.applyLocal([{ kind: 'update', id: 'a', patch: { x: 9 } }]);
    await network.settle();
    expect(owner.document.get('a')).toMatchObject({ x: 0 });

    // Retiré du board sans accès par défaut : déconnecté.
    roles.bob = undefined;
    await network.hub.refreshAccess('board');
    await network.settle();
    expect(bob.disconnects).toEqual(['forbidden']);
    expect(owner.client.participants.map(({ name }) => name)).toEqual(['owner']);
  });
});
