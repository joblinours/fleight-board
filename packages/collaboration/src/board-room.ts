import { BoardDocument } from '@fleight/document';
import type { BoardObject, Operation, Snapshot } from '@fleight/protocol';
import { touchedIds } from './compact';

export type ApplyResult =
  | {
      ok: true;
      /** Lot déjà appliqué (renvoyé après une reconnexion) : rien n'a été modifié. */
      duplicate?: boolean;
      seq: number;
      versions: Record<string, number>;
      /** Objets créés ou modifiés, avec leur nouvelle version (à persister). */
      upserts: Array<{ object: BoardObject; version: number }>;
      /** Objets supprimés. */
      deletes: string[];
    }
  | { ok: false; code: 'INVALID' | 'CONFLICT'; message: string };

/** Origine d'un lot, pour détecter les conflits et les doublons. */
export type ApplyContext = {
  /** Client à l'origine du lot (stable à travers les reconnexions). */
  actor: string;
  /** Dernière séquence connue du client quand il a fait ces modifications. */
  baseSeq: number;
  batchId: string;
};

type Writer = { seq: number; actor: string };

/** Nombre de lots récents mémorisés pour reconnaître un renvoi. */
const RECENT_BATCHES = 2000;
/** Nombre de suppressions récentes mémorisées pour expliquer un conflit. */
const RECENT_DELETIONS = 5000;

/**
 * État autoritaire d'un board côté serveur : les lots sont appliqués dans leur
 * ordre d'arrivée, chacun reçoit un numéro de séquence, et chaque objet une version.
 */
export class BoardRoom {
  readonly boardId: string;
  readonly document = new BoardDocument();
  #seq = 0;
  readonly #versions = new Map<string, number>();
  /** Dernier auteur de chaque propriété de chaque objet (en mémoire). */
  readonly #writers = new Map<string, Map<string, Writer>>();
  readonly #deletions = new Map<string, Writer>();
  readonly #recentBatches = new Map<string, Writer>();

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

  /**
   * Applique un lot de façon atomique ; un lot invalide ou en conflit ne modifie rien.
   *
   * Conflit : le lot modifie une propriété (ou supprime un objet) qu'un autre client
   * a changée après `baseSeq` — typiquement des modifications faites hors connexion.
   */
  apply(operations: readonly Operation[], context?: ApplyContext): ApplyResult {
    if (context) {
      const known = this.#recentBatches.get(context.batchId);
      if (known !== undefined) {
        return {
          ok: true,
          duplicate: true,
          seq: known.seq,
          versions: {},
          upserts: [],
          deletes: [],
        };
      }
      const conflict = this.#findConflict(operations, context);
      if (conflict) return { ok: false, code: 'CONFLICT', message: conflict };
    }
    try {
      this.document.apply(operations);
    } catch (error) {
      return {
        ok: false,
        code: 'INVALID',
        message: error instanceof Error ? error.message.slice(0, 500) : 'Opération invalide',
      };
    }
    this.#seq += 1;
    if (context) this.#remember(operations, context);
    const versions: Record<string, number> = {};
    const upserts: Array<{ object: BoardObject; version: number }> = [];
    const deletes: string[] = [];
    for (const id of touchedIds(operations)) {
      const object = this.document.get(id);
      if (object) {
        const version = (this.#versions.get(id) ?? 0) + 1;
        this.#versions.set(id, version);
        versions[id] = version;
        upserts.push({ object, version });
      } else {
        this.#versions.delete(id);
        versions[id] = 0;
        deletes.push(id);
      }
    }
    return { ok: true, seq: this.#seq, versions, upserts, deletes };
  }

  #findConflict(
    operations: readonly Operation[],
    { actor, baseSeq }: ApplyContext,
  ): string | undefined {
    const changedByOther = (writer: Writer | undefined) =>
      writer !== undefined && writer.seq > baseSeq && writer.actor !== actor;

    for (const operation of operations) {
      if (operation.kind === 'create') continue;
      const id = operation.id;
      if (!this.document.has(id)) {
        if (changedByOther(this.#deletions.get(id))) return `Objet ${id} supprimé entre-temps`;
        continue;
      }
      const writers = this.#writers.get(id);
      const keys =
        operation.kind === 'update' ? Object.keys(operation.patch) : [...(writers?.keys() ?? [])];
      for (const key of keys) {
        if (changedByOther(writers?.get(key))) return `Objet ${id} modifié entre-temps (${key})`;
      }
    }
    return undefined;
  }

  #remember(operations: readonly Operation[], { actor, batchId }: ApplyContext): void {
    const writer = { seq: this.#seq, actor };
    for (const operation of operations) {
      if (operation.kind === 'delete') {
        this.#writers.delete(operation.id);
        this.#deletions.set(operation.id, writer);
        continue;
      }
      const id = operation.kind === 'create' ? operation.object.id : operation.id;
      const keys = Object.keys(operation.kind === 'create' ? operation.object : operation.patch);
      let writers = this.#writers.get(id);
      if (!writers) {
        writers = new Map();
        this.#writers.set(id, writers);
      }
      for (const key of keys) writers.set(key, writer);
    }
    this.#recentBatches.set(batchId, writer);
    trim(this.#recentBatches, RECENT_BATCHES);
    trim(this.#deletions, RECENT_DELETIONS);
  }

  /** Lots récents d'un client déjà appliqués (pour sa reconnexion). */
  appliedBatchesOf(actor: string): string[] {
    const batches: string[] = [];
    for (const [batchId, writer] of this.#recentBatches) {
      if (writer.actor === actor) batches.push(batchId);
    }
    return batches;
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

/** Ne garde que les `max` dernières entrées d'une Map (ordre d'insertion). */
function trim(map: Map<string, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}
