import { BoardDocument } from '@fleight/document';
import type { BoardObject, Operation, Snapshot } from '@fleight/protocol';
import { touchedIds } from './compact';

export type ApplyResult =
  | { ok: true; seq: number; versions: Record<string, number> }
  | { ok: false; message: string };

/**
 * État autoritaire d'un board côté serveur : les lots sont appliqués dans leur
 * ordre d'arrivée, chacun reçoit un numéro de séquence, et chaque objet une version.
 */
export class BoardRoom {
  readonly boardId: string;
  readonly document = new BoardDocument();
  #seq = 0;
  readonly #versions = new Map<string, number>();

  constructor(
    boardId: string,
    initial?: { objects: BoardObject[]; seq: number; versions: Record<string, number> },
  ) {
    this.boardId = boardId;
    if (initial) {
      this.document.load(initial.objects);
      this.#seq = initial.seq;
      for (const [id, version] of Object.entries(initial.versions)) this.#versions.set(id, version);
    }
  }

  get seq(): number {
    return this.#seq;
  }

  /** Applique un lot de façon atomique ; un lot invalide ne modifie rien. */
  apply(operations: readonly Operation[]): ApplyResult {
    try {
      this.document.apply(operations);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message.slice(0, 500) : 'Opération invalide',
      };
    }
    this.#seq += 1;
    const versions: Record<string, number> = {};
    for (const id of touchedIds(operations)) {
      if (this.document.has(id)) {
        const version = (this.#versions.get(id) ?? 0) + 1;
        this.#versions.set(id, version);
        versions[id] = version;
      } else {
        this.#versions.delete(id);
        versions[id] = 0;
      }
    }
    return { ok: true, seq: this.#seq, versions };
  }

  snapshot(): Snapshot {
    return {
      boardId: this.boardId,
      seq: this.#seq,
      objects: [...this.document.all()],
      versions: Object.fromEntries(this.#versions),
    };
  }
}
