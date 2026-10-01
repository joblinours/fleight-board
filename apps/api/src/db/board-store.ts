import type { BoardCommit, BoardStore, StoredBoard } from '@fleight/collaboration';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../database';
import { boards, objects, operations, snapshots } from './schema';

/** Une copie complète du board est conservée tous les N lots. */
export const SNAPSHOT_INTERVAL = 500;

/** Stockage des boards dans PostgreSQL. Chaque commit est une transaction. */
export class PostgresBoardStore implements BoardStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async load(boardId: string): Promise<StoredBoard | undefined> {
    const [board] = await this.#db.select().from(boards).where(eq(boards.id, boardId));
    if (!board) return undefined;
    const rows = await this.#db
      .select({ data: objects.data, version: objects.version })
      .from(objects)
      .where(eq(objects.boardId, boardId));
    return {
      seq: board.seq,
      objects: rows.map(({ data }) => data),
      versions: Object.fromEntries(rows.map(({ data, version }) => [data.id, version])),
    };
  }

  async commit(boardId: string, commit: BoardCommit): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ seq: boards.seq })
        .from(boards)
        .where(eq(boards.id, boardId))
        .for('update');
      const previousSeq = previous?.seq ?? 0;

      await tx
        .insert(boards)
        .values({ id: boardId, seq: commit.seq })
        .onConflictDoUpdate({
          target: boards.id,
          set: { seq: sql`greatest(${boards.seq}, ${commit.seq})`, updatedAt: sql`now()` },
        });

      if (commit.upserts.length) {
        await tx
          .insert(objects)
          .values(
            commit.upserts.map(({ object, version }) => ({
              boardId,
              id: object.id,
              data: object,
              version,
            })),
          )
          .onConflictDoUpdate({
            target: [objects.boardId, objects.id],
            set: {
              data: sql`excluded.data`,
              version: sql`excluded.version`,
              updatedAt: sql`now()`,
            },
          });
      }

      if (commit.deletes.length) {
        await tx
          .delete(objects)
          .where(and(eq(objects.boardId, boardId), inArray(objects.id, commit.deletes)));
      }

      if (commit.journal.length) {
        await tx.insert(operations).values(
          commit.journal.map((entry) => ({
            boardId,
            seq: entry.seq,
            actor: entry.actor,
            gestureId: entry.gestureId ?? null,
            intent: entry.intent ?? null,
            operations: entry.operations,
          })),
        );
      }

      // Copie complète à chaque palier de SNAPSHOT_INTERVAL lots.
      if (
        Math.floor(commit.seq / SNAPSHOT_INTERVAL) > Math.floor(previousSeq / SNAPSHOT_INTERVAL)
      ) {
        const current = await tx
          .select({ data: objects.data })
          .from(objects)
          .where(eq(objects.boardId, boardId));
        await tx
          .insert(snapshots)
          .values({ boardId, seq: commit.seq, objects: current.map(({ data }) => data) })
          .onConflictDoNothing();
      }
    });
  }
}
