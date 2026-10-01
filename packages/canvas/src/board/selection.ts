export type SelectionListener = (ids: ReadonlySet<string>) => void;

/** Objets sélectionnés par l'utilisateur local. */
export class Selection {
  #ids = new Set<string>();
  readonly #listeners = new Set<SelectionListener>();

  get ids(): ReadonlySet<string> {
    return this.#ids;
  }

  get size(): number {
    return this.#ids.size;
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  /** L'unique objet sélectionné, s'il y en a exactement un. */
  single(): string | undefined {
    if (this.#ids.size !== 1) return undefined;
    const [id] = this.#ids;
    return id;
  }

  set(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === this.#ids.size && [...next].every((id) => this.#ids.has(id))) return;
    this.#ids = next;
    this.#notify();
  }

  toggle(id: string): void {
    const next = new Set(this.#ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.set(next);
  }

  clear(): void {
    this.set([]);
  }

  subscribe(listener: SelectionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#ids);
  }
}
