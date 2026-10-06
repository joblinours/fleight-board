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

describe('sessions privées', () => {
  it('salle d’attente : la connexion attend la décision, puis rejoint ou est refusée', async () => {
    const { network, roles } = await setup({ owner: 'owner' });
    const pending = new Set(['alice', 'bob']);
    network.hub.awaitsAccess = async (_boardId, user) => !!user && pending.has(user.id);

    const alice = network.connect('alice', { asUser: true });
    const bob = network.connect('bob', { asUser: true });
    await network.settle();
    expect(alice.client.status).toBe('waiting');
    expect(bob.client.status).toBe('waiting');
    expect(alice.document.get('a')).toBeUndefined();

    // Alice est acceptée, la demande de Bob est refusée.
    roles.alice = 'editor';
    pending.clear();
    await network.hub.refreshAccess('board');
    await network.settle();
    expect(alice.client.status).toBe('joined');
    expect(alice.document.get('a')).toBeDefined();
    expect(bob.disconnects).toEqual(['forbidden']);
  });

  it('les demandes d’accès ne sont signalées qu’aux Co-owners et au propriétaire', async () => {
    const { network, owner } = await setup({ owner: 'owner', editor: 'editor' });
    const editor = network.connect('editor', { asUser: true });
    await network.settle();
    network.hub.notifyAccessRequests('board', 2);
    await network.settle();
    expect(owner.events.some(({ type }) => type === 'accessRequests')).toBe(true);
    expect(editor.events.some(({ type }) => type === 'accessRequests')).toBe(false);
  });

  it('présence d’un compte et départ signalé (accès « tant qu’il est connecté »)', async () => {
    const { network, owner } = await setup({ owner: 'owner' });
    const left: string[] = [];
    network.hub.onLeave = (_boardId, userId) => left.push(userId);
    expect(network.hub.isConnected('board', 'owner')).toBe(true);
    owner.close();
    await network.settle();
    expect(network.hub.isConnected('board', 'owner')).toBe(false);
    expect(left).toEqual(['owner']);
  });
});
