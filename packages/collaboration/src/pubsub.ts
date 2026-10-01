export type Unsubscribe = () => void;

/**
 * Diffusion des messages entre connexions d'un même board.
 *
 * En v1, une seule instance backend : l'implémentation mémoire suffit.
 * Une implémentation Redis la remplacera quand plusieurs instances seront activées.
 */
export interface PubSub<T> {
  publish(channel: string, message: T): Promise<void>;
  subscribe(channel: string, handler: (message: T) => void): Unsubscribe;
}

export class InMemoryPubSub<T> implements PubSub<T> {
  readonly #channels = new Map<string, Set<(message: T) => void>>();

  async publish(channel: string, message: T): Promise<void> {
    const handlers = this.#channels.get(channel);
    if (!handlers) return;
    // Copie : un handler peut se désabonner pendant la diffusion.
    for (const handler of [...handlers]) handler(message);
  }

  subscribe(channel: string, handler: (message: T) => void): Unsubscribe {
    let handlers = this.#channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.#channels.set(channel, handlers);
    }
    handlers.add(handler);

    return () => {
      const current = this.#channels.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.#channels.delete(channel);
    };
  }

  /** Nombre de canaux actifs (observabilité et tests). */
  get channelCount(): number {
    return this.#channels.size;
  }
}
