import type { LockOwner, LockService } from '@fleight/canvas';
import type { CollaborationClient } from '@fleight/collaboration';

/** Verrous de l'éditeur adossés au client de collaboration. */
export function createLockService(client: CollaborationClient): LockService {
  const owner = (connectionId: string): LockOwner => {
    const participant = client.participants.find(
      (current) => current.connectionId === connectionId,
    );
    // Couleur attribuée par le serveur : la même que le curseur du participant.
    return { name: participant?.name ?? 'Un participant', color: participant?.color ?? '#e11d48' };
  };

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
