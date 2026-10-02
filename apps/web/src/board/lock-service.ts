import type { LockOwner, LockService } from '@fleight/canvas';
import type { CollaborationClient } from '@fleight/collaboration';

const PARTICIPANT_COLORS = [
  '#e11d48',
  '#7c3aed',
  '#0891b2',
  '#ea580c',
  '#16a34a',
  '#db2777',
  '#2563eb',
];

/** Couleur stable d'un participant, dérivée de son identifiant de connexion. */
export function participantColor(connectionId: string): string {
  let hash = 0;
  for (const char of connectionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PARTICIPANT_COLORS[hash % PARTICIPANT_COLORS.length] ?? '#e11d48';
}

/** Verrous de l'éditeur adossés au client de collaboration. */
export function createLockService(client: CollaborationClient): LockService {
  const owner = (connectionId: string): LockOwner => ({
    name:
      client.participants.find((participant) => participant.connectionId === connectionId)?.name ??
      'Un participant',
    color: participantColor(connectionId),
  });

  return {
    lockedBy(id) {
      const holder = client.lockedByOther(id);
      return holder ? owner(holder) : undefined;
    },
    *lockedByOthers() {
      for (const id of client.locks.keys()) {
        const holder = client.lockedByOther(id);
        if (holder) yield [id, owner(holder)];
      }
    },
    acquire: (ids) => client.lock(ids),
    release: (ids) => client.unlock(ids),
  };
}
