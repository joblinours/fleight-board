import type { BoardObject, Intent, Operation } from '@fleight/protocol';
import { type AuditEntry, auditEntriesOf } from './audit';

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
  /** Connexion à l'origine de l'entrée (audit). */
  session?: string;
  /** Nom affiché de l'auteur (audit, en attendant les comptes de M1.1). */
  actorName?: string;
  gestureId?: string;
  /** Annulation ou rétablissement. */
  intent?: Intent;
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
 * Fusionne des commits consécutifs en un seul, équivalent : dernier état de
 * chaque objet (mise à jour ou suppression), journal dans l'ordre.
 */
export function mergeCommits(commits: readonly BoardCommit[]): BoardCommit {
  const [first] = commits;
  if (commits.length === 1 && first) return first;
  const objects = new Map<string, { object: BoardObject; version: number } | undefined>();
  const journal: JournalEntry[] = [];
  let seq = 0;
  for (const commit of commits) {
    seq = Math.max(seq, commit.seq);
    for (const upsert of commit.upserts) objects.set(upsert.object.id, upsert);
    for (const id of commit.deletes) objects.set(id, undefined);
    journal.push(...commit.journal);
  }
  const upserts = [...objects.values()].filter((upsert) => upsert !== undefined);
  const deletes = [...objects].filter(([, upsert]) => upsert === undefined).map(([id]) => id);
  return { seq, upserts, deletes, journal };
}

/**
 * Stockage durable des boards. Les commits d'un même board arrivent dans
 * l'ordre de leur séquence et ne sont jamais concurrents entre eux.
 * Chaque entrée du journal produit ses entrées d'audit dans le même commit
 * (voir `auditEntriesOf`).
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
  readonly audit: AuditEntry[] = [];

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
      this.audit.push(...commit.journal.flatMap((entry) => auditEntriesOf(boardId, entry)));
    }
  }
}
