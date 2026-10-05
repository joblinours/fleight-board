/**
 * Protection des codes courts contre l'énumération : après trop de codes
 * inexistants depuis une même adresse, elle doit attendre (cooldown). Un code
 * valide remet le compteur à zéro. En mémoire : propre à chaque instance.
 */
export class CodeGuard {
  readonly #attempts = new Map<string, { failures: number; first: number; blockedUntil: number }>();
  readonly #maxFailures: number;
  readonly #windowMs: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor({
    maxFailures = 10,
    windowMs = 10 * 60_000,
    cooldownMs = 5 * 60_000,
    now = Date.now,
  }: { maxFailures?: number; windowMs?: number; cooldownMs?: number; now?: () => number } = {}) {
    this.#maxFailures = maxFailures;
    this.#windowMs = windowMs;
    this.#cooldownMs = cooldownMs;
    this.#now = now;
  }

  /** Secondes d'attente restantes pour cette adresse (0 : autorisée). */
  retryAfter(key: string): number {
    const entry = this.#attempts.get(key);
    const remaining = (entry?.blockedUntil ?? 0) - this.#now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  /** Code inexistant : compte l'échec, bloque l'adresse au-delà du seuil. */
  failure(key: string): void {
    const now = this.#now();
    let entry = this.#attempts.get(key);
    if (!entry || now - entry.first > this.#windowMs) {
      entry = { failures: 0, first: now, blockedUntil: 0 };
      this.#attempts.set(key, entry);
    }
    entry.failures += 1;
    if (entry.failures >= this.#maxFailures) {
      entry.blockedUntil = now + this.#cooldownMs;
      entry.failures = 0;
      entry.first = now;
    }
    // Purge occasionnelle des adresses inactives.
    if (this.#attempts.size > 10_000) {
      for (const [address, value] of this.#attempts) {
        if (now - value.first > this.#windowMs && value.blockedUntil < now) {
          this.#attempts.delete(address);
        }
      }
    }
  }

  /** Code valide : l'adresse repart de zéro. */
  success(key: string): void {
    const entry = this.#attempts.get(key);
    if (entry && entry.blockedUntil <= this.#now()) this.#attempts.delete(key);
  }
}
