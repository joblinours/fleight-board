import { type BoardObject, BoardObjectSchema } from '@fleight/protocol';
import type { DocumentOperation, ObjectPatch } from './operations';

export type DocumentChange = {
  created: string[];
  updated: string[];
  deleted: BoardObject[];
};

export type DocumentListener = (change: DocumentChange) => void;

export class DocumentError extends Error {}

/**
 * État d'un whiteboard : ensemble d'objets modifié uniquement par des opérations.
 * Chaque opération appliquée retourne son inverse (base de l'undo).
 */
export class BoardDocument {
  readonly #objects = new Map<string, BoardObject>();
  /** Connecteurs accrochés à chaque objet. */
  readonly #connectors = new Map<string, Set<string>>();
  readonly #listeners = new Set<DocumentListener>();

  get size(): number {
    return this.#objects.size;
  }

  get(id: string): BoardObject | undefined {
    return this.#objects.get(id);
  }

  has(id: string): boolean {
    return this.#objects.has(id);
  }

  all(): IterableIterator<BoardObject> {
    return this.#objects.values();
  }

  /** Connecteurs dont une extrémité est accrochée à l'objet. */
  connectorsOf(objectId: string): string[] {
    return [...(this.#connectors.get(objectId) ?? [])];
  }

  /** Plus grand zIndex utilisé (pour placer un nouvel objet au-dessus). */
  topZIndex(): number {
    let top = -1;
    for (const object of this.#objects.values()) top = Math.max(top, object.zIndex);
    return top;
  }

  /** Applique des opérations de façon atomique et retourne leurs inverses (à appliquer dans l'ordre). */
  apply(operations: readonly DocumentOperation[]): DocumentOperation[] {
    const inverses: DocumentOperation[] = [];
    const change: DocumentChange = { created: [], updated: [], deleted: [] };
    try {
      for (const operation of operations) {
        inverses.unshift(this.#applyOne(operation, change));
      }
    } catch (error) {
      // Annulation de ce qui a déjà été appliqué.
      for (const inverse of inverses) this.#applyOne(inverse, undefined);
      throw error;
    }
    this.#notify(change);
    return inverses;
  }

  /** Remplace tout le contenu (chargement d'un board). */
  load(objects: Iterable<BoardObject>): void {
    const deleted = [...this.#objects.values()];
    this.#objects.clear();
    this.#connectors.clear();
    const created: string[] = [];
    for (const object of objects) {
      const parsed = BoardObjectSchema.parse(object);
      this.#objects.set(parsed.id, parsed);
      this.#index(parsed);
      created.push(parsed.id);
    }
    this.#notify({ created, updated: [], deleted });
  }

  subscribe(listener: DocumentListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #applyOne(operation: DocumentOperation, change: DocumentChange | undefined): DocumentOperation {
    switch (operation.kind) {
      case 'create': {
        if (this.#objects.has(operation.object.id)) {
          throw new DocumentError(`Objet ${operation.object.id} déjà existant`);
        }
        const object = BoardObjectSchema.parse(operation.object);
        this.#objects.set(object.id, object);
        this.#index(object);
        change?.created.push(object.id);
        return { kind: 'delete', id: object.id };
      }
      case 'update': {
        const current = this.#require(operation.id);
        // Dans un patch, `null` retire une propriété facultative (ex. opacité d'un objet
        // créé avant qu'elle existe) ; l'inverse d'une propriété absente est donc `null`.
        const previous: ObjectPatch = {};
        const merged: Record<string, unknown> = { ...current };
        for (const [key, value] of Object.entries(operation.patch)) {
          if (key === 'id' || key === 'type') throw new DocumentError(`${key} non modifiable`);
          previous[key] = (current as Record<string, unknown>)[key] ?? null;
          if (value === null) delete merged[key];
          else merged[key] = value;
        }
        const next = BoardObjectSchema.parse(merged);
        this.#unindex(current);
        this.#objects.set(next.id, next);
        this.#index(next);
        change?.updated.push(next.id);
        return { kind: 'update', id: next.id, patch: previous };
      }
      case 'delete': {
        const current = this.#require(operation.id);
        this.#unindex(current);
        this.#objects.delete(current.id);
        change?.deleted.push(current);
        return { kind: 'create', object: current };
      }
    }
  }

  #require(id: string): BoardObject {
    const object = this.#objects.get(id);
    if (!object) throw new DocumentError(`Objet ${id} introuvable`);
    return object;
  }

  #index(object: BoardObject): void {
    if (object.type !== 'connector') return;
    for (const endpoint of [object.start, object.end]) {
      if (endpoint.kind !== 'object') continue;
      let set = this.#connectors.get(endpoint.objectId);
      if (!set) {
        set = new Set();
        this.#connectors.set(endpoint.objectId, set);
      }
      set.add(object.id);
    }
  }

  #unindex(object: BoardObject): void {
    if (object.type !== 'connector') return;
    for (const endpoint of [object.start, object.end]) {
      if (endpoint.kind !== 'object') continue;
      const set = this.#connectors.get(endpoint.objectId);
      set?.delete(object.id);
      if (set?.size === 0) this.#connectors.delete(endpoint.objectId);
    }
  }

  #notify(change: DocumentChange): void {
    if (!change.created.length && !change.updated.length && !change.deleted.length) return;
    for (const listener of this.#listeners) listener(change);
  }
}
