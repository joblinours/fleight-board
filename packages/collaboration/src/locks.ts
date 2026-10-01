/** Durée de vie d'un verrou sans activité de son détenteur. */
export const LOCK_TTL_MS = 10_000;

export type AcquireResult = { ok: true } | { ok: false; holder: string; objectIds: string[] };

/**
 * Verrous temporaires d'objets : un objet en cours de modification appartient
 * à une seule connexion. Les verrous expirent sans activité (client parti
 * sans prévenir, onglet gelé…).
 */
export class LockTable {
  readonly #locks = new Map<string, { holder: string; expiresAt: number }>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? LOCK_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Détenteur actuel d'un objet (verrous expirés ignorés). */
  holderOf(objectId: string): string | undefined {
    const lock = this.#locks.get(objectId);
    return lock && lock.expiresAt > this.#now() ? lock.holder : undefined;
  }

  /** Verrouille tous les objets, ou aucun si l'un est détenu par une autre connexion. */
  acquire(holder: string, objectIds: readonly string[]): AcquireResult {
    for (const id of objectIds) {
      const current = this.holderOf(id);
      if (current && current !== holder) {
        return {
          ok: false,
          holder: current,
          objectIds: objectIds.filter((other) => this.holderOf(other) === current),
        };
      }
    }
    const expiresAt = this.#now() + this.#ttlMs;
    for (const id of objectIds) this.#locks.set(id, { holder, expiresAt });
    return { ok: true };
  }

  /** Prolonge les verrous que la connexion détient parmi ces objets. */
  touch(holder: string, objectIds: Iterable<string>): void {
    const expiresAt = this.#now() + this.#ttlMs;
    for (const id of objectIds) {
      const lock = this.#locks.get(id);
      if (lock?.holder === holder) lock.expiresAt = expiresAt;
    }
  }

  /** Libère les verrous de la connexion parmi ces objets ; retourne ceux libérés. */
  release(holder: string, objectIds: Iterable<string>): string[] {
    const released: string[] = [];
    for (const id of objectIds) {
      if (this.#locks.get(id)?.holder === holder) {
        this.#locks.delete(id);
        released.push(id);
      }
    }
    return released;
  }

  /** Libère tous les verrous d'une connexion (départ). */
  releaseAll(holder: string): string[] {
    return this.release(
      holder,
      [...this.#locks].filter(([, lock]) => lock.holder === holder).map(([id]) => id),
    );
  }

  /** Retire les verrous d'objets qui n'existent plus, quel que soit leur détenteur. */
  remove(objectIds: Iterable<string>): string[] {
    const removed: string[] = [];
    for (const id of objectIds) if (this.#locks.delete(id)) removed.push(id);
    return removed;
  }

  /** Supprime les verrous expirés ; retourne les objets libérés. */
  expire(): string[] {
    const now = this.#now();
    const expired: string[] = [];
    for (const [id, lock] of this.#locks) {
      if (lock.expiresAt <= now) {
        this.#locks.delete(id);
        expired.push(id);
      }
    }
    return expired;
  }

  /** Verrous actifs : objet → détenteur. */
  snapshot(): Record<string, string> {
    const now = this.#now();
    const result: Record<string, string> = {};
    for (const [id, lock] of this.#locks) if (lock.expiresAt > now) result[id] = lock.holder;
    return result;
  }
}
