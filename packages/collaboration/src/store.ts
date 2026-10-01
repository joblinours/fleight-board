import type { BoardObject, Operation } from '@fleight/protocol';

/** État persisté d'un board. */
export type StoredBoard = {
  seq: number;
  objects: BoardObject[];
  versions: Record<string, number>;
};

/** Entrée du journal : effet net d'un lot ou d'un geste complet. */
export type JournalEntry = {
  /** Séquence du dernier lot inclus. */
  seq: number;
  /** Connexion à l'origine (utilisateur à partir de M1.1). */
  actor: string;
  gestureId?: string;
  operations: Operation[];
};

/** Modifications à enregistrer de façon atomique après un lot. */
export type BoardCommit = {
  seq: number;
  upserts: Array<{ object: BoardObject; version: number }>;
  deletes: string[];
  journal: JournalEntry[];
};

/**
 * Stockage durable des boards. Les commits d'un même board arrivent dans
 * l'ordre de leur séquence et ne sont jamais concurrents entre eux.
 */
export type BoardStore = {
  load(boardId: string): Promise<StoredBoard | undefined>;
  commit(boardId: string, commit: BoardCommit): Promise<void>;
};

/** Stockage en mémoire (tests, développement sans base). */
export class MemoryBoardStore implements BoardStore {
  readonly boards = new Map<
    string,
    { seq: number; objects: Map<string, { object: BoardObject; version: number }> }
  >();
  readonly journal = new Map<string, JournalEntry[]>();

  async load(boardId: string): Promise<StoredBoard | undefined> {
    const board = this.boards.get(boardId);
    if (!board) return undefined;
    const objects = [...board.objects.values()];
    return {
      seq: board.seq,
      objects: objects.map(({ object }) => structuredClone(object)),
      versions: Object.fromEntries(objects.map(({ object, version }) => [object.id, version])),
    };
  }

  async commit(boardId: string, commit: BoardCommit): Promise<void> {
    let board = this.boards.get(boardId);
    if (!board) {
      board = { seq: 0, objects: new Map() };
      this.boards.set(boardId, board);
    }
    board.seq = Math.max(board.seq, commit.seq);
    for (const { object, version } of commit.upserts) {
      board.objects.set(object.id, { object: structuredClone(object), version });
    }
    for (const id of commit.deletes) board.objects.delete(id);
    if (commit.journal.length) {
      const entries = this.journal.get(boardId) ?? [];
      entries.push(...structuredClone(commit.journal));
      this.journal.set(boardId, entries);
    }
  }
}
