import RBush from 'rbush';
import type { Bounds } from './geometry';

type Entry = Bounds & { id: string };

/**
 * Index spatial (R-tree) : retrouve rapidement les éléments d'une zone,
 * pour le culling du viewport et le hit-testing.
 */
export class SpatialIndex {
  readonly #tree = new RBush<Entry>();
  readonly #entries = new Map<string, Entry>();

  get size(): number {
    return this.#entries.size;
  }

  upsert(id: string, bounds: Bounds): void {
    const previous = this.#entries.get(id);
    if (previous) this.#tree.remove(previous);
    const entry: Entry = { id, ...bounds };
    this.#entries.set(id, entry);
    this.#tree.insert(entry);
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#tree.remove(entry);
    this.#entries.delete(id);
  }

  /** Identifiants dont les bounds intersectent la zone. */
  search(bounds: Bounds): string[] {
    return this.#tree.search(bounds).map((entry) => entry.id);
  }

  /** Remplace tout le contenu (chargement initial, bien plus rapide que des insertions). */
  load(items: Iterable<{ id: string; bounds: Bounds }>): void {
    this.clear();
    const entries: Entry[] = [];
    for (const { id, bounds } of items) {
      const entry: Entry = { id, ...bounds };
      this.#entries.set(id, entry);
      entries.push(entry);
    }
    this.#tree.load(entries);
  }

  clear(): void {
    this.#tree.clear();
    this.#entries.clear();
  }
}
