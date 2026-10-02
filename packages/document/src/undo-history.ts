import type { BoardObject, Operation } from '@fleight/protocol';
import type { BoardDocument } from './document';
import { deleteObjectsOperations } from './edits';

/** État d'un objet avant et après une action (`undefined` : absent). */
type Change = { before: BoardObject | undefined; after: BoardObject | undefined };

/** Une action de l'utilisateur (un geste, une commande) : objets touchés. */
type Entry = Map<string, Change>;

export type RevertResult = {
  /** Une action a été annulée ou rétablie (même partiellement). */
  applied: boolean;
  /**
   * Objets non restaurés, entièrement ou en partie : supprimés, modifiés depuis
   * par d'autres participants, ou en cours de modification.
   */
  skipped: string[];
};

export type RevertOptions = {
  /** Objet en cours de modification par un autre participant : on n'y touche pas. */
  blocked?(id: string): boolean;
};

const MAX_ENTRIES = 200;

/**
 * Historique d'annulation **individuel** : seules les actions locales y entrent.
 *
 * Annuler ne restaure que ce que l'utilisateur a lui-même modifié, et seulement
 * si personne ne l'a changé depuis : une propriété modifiée entre-temps par un
 * autre participant garde sa nouvelle valeur ; un objet supprimé par un autre
 * n'est pas recréé.
 */
export class UndoHistory {
  #undo: Entry[] = [];
  #redo: Entry[] = [];
  /** Geste en cours : ses opérations successives forment une seule entrée. */
  #open: { group: string; entry: Entry } | undefined;

  get canUndo(): boolean {
    return this.#undo.length > 0 || this.#open !== undefined;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Applique des opérations locales (via `apply`) en mémorisant l'état des objets
   * touchés. Les appels d'un même `group` (geste) forment une seule entrée.
   */
  track(
    document: BoardDocument,
    operations: readonly Operation[],
    apply: () => void,
    group?: string,
  ): void {
    let entry: Entry;
    if (group && this.#open?.group === group) {
      entry = this.#open.entry;
    } else {
      this.#closeOpen();
      entry = new Map();
    }
    const ids = touched(operations);
    for (const id of ids) {
      if (!entry.has(id)) entry.set(id, { before: copy(document.get(id)), after: undefined });
    }
    apply();
    for (const id of ids) {
      const change = entry.get(id);
      if (change) change.after = copy(document.get(id));
    }
    if (group) this.#open = { group, entry };
    else this.#push(this.#undo, entry);
    this.#redo = [];
  }

  /** Fin d'un geste : son entrée rejoint l'historique. */
  endGroup(group: string): void {
    if (this.#open?.group === group) this.#closeOpen();
  }

  /** Annule la dernière action locale. */
  undo(
    document: BoardDocument,
    apply: (operations: Operation[]) => void,
    options: RevertOptions = {},
  ): RevertResult {
    this.#closeOpen();
    return this.#revert(document, this.#undo, this.#redo, apply, options);
  }

  /** Rétablit la dernière action annulée. */
  redo(
    document: BoardDocument,
    apply: (operations: Operation[]) => void,
    options: RevertOptions = {},
  ): RevertResult {
    return this.#revert(document, this.#redo, this.#undo, apply, options);
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
    this.#open = undefined;
  }

  #revert(
    document: BoardDocument,
    from: Entry[],
    to: Entry[],
    apply: (operations: Operation[]) => void,
    options: RevertOptions,
  ): RevertResult {
    const entry = from.pop();
    if (!entry) return { applied: false, skipped: [] };

    const { operations, skipped } = revertOperations(document, entry, options);
    if (!operations.length) return { applied: false, skipped };

    // L'annulation est elle-même une action : on la mémorise pour pouvoir la défaire.
    const inverse: Entry = new Map();
    const ids = touched(operations);
    for (const id of ids) inverse.set(id, { before: copy(document.get(id)), after: undefined });
    apply(operations);
    for (const id of ids) {
      const change = inverse.get(id);
      if (change) change.after = copy(document.get(id));
    }
    this.#push(to, inverse);
    return { applied: true, skipped };
  }

  #closeOpen(): void {
    if (!this.#open) return;
    if (this.#open.entry.size) this.#push(this.#undo, this.#open.entry);
    this.#open = undefined;
  }

  #push(stack: Entry[], entry: Entry): void {
    stack.push(entry);
    if (stack.length > MAX_ENTRIES) stack.shift();
  }
}

/** Opérations qui ramènent les objets d'une entrée à leur état `before`. */
function revertOperations(
  document: BoardDocument,
  entry: Entry,
  options: RevertOptions,
): { operations: Operation[]; skipped: string[] } {
  const creates: Operation[] = [];
  const updates: Operation[] = [];
  const deletes: string[] = [];
  const skipped: string[] = [];

  for (const [id, { before, after }] of entry) {
    if (options.blocked?.(id)) {
      skipped.push(id);
      continue;
    }
    const current = document.get(id);

    if (!after && before) {
      // L'action avait supprimé l'objet : on le recrée, sauf s'il existe à nouveau.
      if (current) skipped.push(id);
      else creates.push({ kind: 'create', object: before });
    } else if (after && !before) {
      // L'action avait créé l'objet : on le supprime s'il existe encore.
      if (current) deletes.push(id);
    } else if (after && before) {
      if (!current) {
        skipped.push(id);
        continue;
      }
      const patch: Record<string, unknown> = {};
      let conflict = false;
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (key === 'id' || key === 'type') continue;
        const wrote = (after as Record<string, unknown>)[key];
        const previous = (before as Record<string, unknown>)[key];
        if (equal(wrote, previous)) continue;
        // Seulement si la valeur est toujours celle écrite par l'utilisateur.
        // Propriété absente avant l'action : `null` la retire (transmissible en JSON).
        if (equal((current as Record<string, unknown>)[key], wrote)) patch[key] = previous ?? null;
        else conflict = true;
      }
      if (conflict) skipped.push(id);
      if (Object.keys(patch).length) updates.push({ kind: 'update', id, patch });
    }
  }

  return {
    operations: [...creates, ...updates, ...deleteObjectsOperations(document, deletes)],
    skipped,
  };
}

function touched(operations: readonly Operation[]): string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    ids.add(operation.kind === 'create' ? operation.object.id : operation.id);
  }
  return [...ids];
}

/** Copie profonde (les objets du board sont des valeurs JSON). */
function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Égalité structurelle de valeurs JSON. */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
