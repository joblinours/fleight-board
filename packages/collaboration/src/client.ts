import { BoardDocument } from '@fleight/document';
import {
  type ClientSessionMessage,
  type Operation,
  type Participant,
  PROTOCOL_VERSION,
  type ServerSessionMessage,
  ServerSessionMessageSchema,
  type Snapshot,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { compactOperations, touchedIds } from './compact';

/** Canal de communication avec le serveur (WebSocket dans le navigateur, factice en test). */
export type Transport = {
  send(message: string): void;
  close(): void;
};

export type ConnectionStatus = 'connecting' | 'joined' | 'closed';

export type CollaborationEvents = {
  onStatus?(status: ConnectionStatus): void;
  onParticipants?(participants: readonly Participant[]): void;
  /** Un lot local a été refusé : l'état a été resynchronisé depuis le serveur. */
  onRejected?(message: string): void;
};

export type CollaborationClientOptions = CollaborationEvents & {
  boardId: string;
  name: string;
  document?: BoardDocument;
  /** Intervalle minimal entre deux envois, en ms (~30 Hz par défaut). */
  flushIntervalMs?: number;
  /** Planification de l'envoi ; injectable pour les tests. */
  schedule?: (callback: () => void, delayMs: number) => void;
};

type Gesture = { id: string; final: boolean };

/** Modification locale appliquée mais pas encore confirmée par le serveur. */
type PendingEntry = {
  operations: Operation[];
  /** Opérations qui annulent `operations` sur l'état courant. */
  inverse: Operation[];
  /** Lot dans lequel l'entrée a été envoyée (absent : encore en file). */
  batchId?: string;
  gesture?: Gesture;
};

/**
 * Client de collaboration : applique les opérations locales immédiatement
 * (optimiste), les envoie par lots au serveur, et intègre les opérations distantes.
 *
 * Tant qu'un lot local n'est pas confirmé, il est réappliqué par-dessus les
 * opérations distantes qui touchent les mêmes objets : le serveur l'appliquera
 * après elles, l'état local anticipe donc correctement l'état du serveur.
 */
export class CollaborationClient {
  readonly document: BoardDocument;
  readonly #options: CollaborationClientOptions;
  readonly #schedule: (callback: () => void, delayMs: number) => void;
  #transport: Transport | undefined;
  #status: ConnectionStatus = 'connecting';
  #participants: Participant[] = [];
  #connectionId: string | undefined;
  /** Modifications locales non confirmées, dans l'ordre d'application. */
  #pending: PendingEntry[] = [];
  #flushScheduled = false;
  #seq = 0;
  readonly #versions = new Map<string, number>();

  constructor(options: CollaborationClientOptions) {
    this.#options = options;
    this.document = options.document ?? new BoardDocument();
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get participants(): readonly Participant[] {
    return this.#participants;
  }

  /** Numéro de séquence du dernier lot confirmé par le serveur. */
  get seq(): number {
    return this.#seq;
  }

  /** Nombre de modifications locales non confirmées. */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Branche le transport ; le handshake et le JOIN sont envoyés immédiatement. */
  connect(transport: Transport): void {
    this.#transport = transport;
    this.#setStatus('connecting');
    this.#send({ type: 'HELLO', protocolVersion: PROTOCOL_VERSION });
    this.#send({ type: 'JOIN', boardId: this.#options.boardId, name: this.#options.name });
  }

  disconnect(): void {
    this.#transport?.close();
    this.#transport = undefined;
    this.#setStatus('closed');
  }

  /** À appeler quand le transport se ferme. */
  handleClose(): void {
    this.#transport = undefined;
    this.#setStatus('closed');
  }

  /**
   * Applique des opérations locales et les met en file d'envoi.
   * `gesture` regroupe les lots d'un même geste (glisser, tracer).
   */
  applyLocal(operations: Operation[], gesture?: Gesture): void {
    if (!operations.length) return;
    const inverse = this.document.apply(operations);
    // Un lot ne mélange pas deux gestes : on envoie la file au changement de geste.
    const queued = this.#unsent();
    if (queued.length && queued[queued.length - 1]?.gesture?.id !== gesture?.id) this.flush();
    this.#pending.push({ operations, inverse, ...(gesture ? { gesture } : {}) });
    if (!gesture || gesture.final) this.flush();
    else this.#scheduleFlush();
  }

  /** Fin d'un geste (pointer up) : son dernier lot est envoyé, marqué final. */
  endGesture(gestureId: string): void {
    const entries = this.#unsent();
    const last = entries[entries.length - 1];
    if (last?.gesture?.id === gestureId) last.gesture = { id: gestureId, final: true };
    this.flush();
  }

  /** Envoie immédiatement les opérations en file, en un seul lot. */
  flush(): void {
    const entries = this.#unsent();
    if (!entries.length) return;
    const batchId = createId();
    const operations = compactOperations(entries.flatMap((entry) => entry.operations));
    const gesture = entries[entries.length - 1]?.gesture;
    for (const entry of entries) entry.batchId = batchId;
    this.#send({ type: 'OPS', batchId, operations, ...(gesture ? { gesture } : {}) });
  }

  /** Message reçu du serveur. */
  handleMessage(raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if ((data as { type?: unknown })?.type === 'HELLO') {
      this.#connectionId = (data as { connectionId?: string }).connectionId;
      return;
    }
    const parsed = ServerSessionMessageSchema.safeParse(data);
    if (parsed.success) this.#handle(parsed.data);
  }

  #handle(message: ServerSessionMessage): void {
    switch (message.type) {
      case 'JOINED':
        this.#loadSnapshot(message.snapshot);
        this.#participants = message.participants;
        this.#options.onParticipants?.(this.#participants);
        this.#setStatus('joined');
        break;
      case 'SNAPSHOT':
        this.#loadSnapshot(message.snapshot);
        break;
      case 'ACK': {
        this.#pending = this.#pending.filter(({ batchId }) => batchId !== message.batchId);
        this.#seq = Math.max(this.#seq, message.seq);
        this.#storeVersions(message.versions);
        break;
      }
      case 'REJECT': {
        // État local divergent : on abandonne les opérations en attente et on resynchronise.
        this.#pending = [];
        this.#send({ type: 'SYNC_REQUEST' });
        this.#options.onRejected?.(message.message);
        break;
      }
      case 'OPS':
        this.#applyRemote(message.operations);
        this.#seq = Math.max(this.#seq, message.seq);
        this.#storeVersions(message.versions);
        break;
      case 'PARTICIPANT_JOINED':
        this.#participants = [
          ...this.#participants.filter(
            ({ connectionId }) => connectionId !== message.participant.connectionId,
          ),
          message.participant,
        ];
        this.#options.onParticipants?.(this.#participants);
        break;
      case 'PARTICIPANT_LEFT':
        this.#participants = this.#participants.filter(
          ({ connectionId }) => connectionId !== message.connectionId,
        );
        this.#options.onParticipants?.(this.#participants);
        break;
    }
  }

  /** Identifiant de connexion attribué par le serveur. */
  get connectionId(): string | undefined {
    return this.#connectionId;
  }

  #applyRemote(operations: Operation[]): void {
    const remoteIds = touchedIds(operations);
    const overlap = this.#pending.some((entry) =>
      [...touchedIds(entry.operations)].some((id) => remoteIds.has(id)),
    );

    if (overlap) {
      // Rebase : annuler les modifications locales en attente (de la plus récente
      // à la plus ancienne), appliquer le lot distant, puis les réappliquer.
      for (let i = this.#pending.length - 1; i >= 0; i--) {
        const entry = this.#pending[i];
        if (entry && !this.#tryApply(entry.inverse)) {
          this.#resync();
          return;
        }
      }
    }

    // Le serveur a appliqué ce lot avec succès : il doit s'appliquer ici aussi.
    if (!this.#tryApply(operations)) {
      this.#resync();
      return;
    }

    if (overlap) this.#reapplyPending();
  }

  /** Réapplique les modifications en attente ; celles devenues impossibles sont abandonnées. */
  #reapplyPending(): void {
    const kept: PendingEntry[] = [];
    for (const entry of this.#pending) {
      try {
        entry.inverse = this.document.apply(entry.operations);
        kept.push(entry);
      } catch {
        // Objet supprimé entre-temps : si le lot a été envoyé, le serveur le refusera
        // et l'état sera resynchronisé.
      }
    }
    this.#pending = kept;
  }

  #tryApply(operations: Operation[]): boolean {
    try {
      this.document.apply(operations);
      return true;
    } catch {
      return false;
    }
  }

  /** Divergence détectée : on repart de l'état du serveur. */
  #resync(): void {
    this.#pending = [];
    this.#send({ type: 'SYNC_REQUEST' });
  }

  #unsent(): PendingEntry[] {
    return this.#pending.filter((entry) => entry.batchId === undefined);
  }

  #loadSnapshot(snapshot: Snapshot): void {
    this.document.load(snapshot.objects);
    this.#seq = snapshot.seq;
    this.#versions.clear();
    this.#storeVersions(snapshot.versions);
    // Les modifications locales non confirmées sont réappliquées par-dessus.
    this.#reapplyPending();
  }

  #storeVersions(versions: Record<string, number>): void {
    for (const [id, version] of Object.entries(versions)) {
      if (version === 0) this.#versions.delete(id);
      else this.#versions.set(id, version);
    }
  }

  #scheduleFlush(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    this.#schedule(() => {
      this.#flushScheduled = false;
      this.flush();
    }, this.#options.flushIntervalMs ?? 33);
  }

  #send(message: ClientSessionMessage | { type: 'HELLO'; protocolVersion: number }): void {
    this.#transport?.send(JSON.stringify(message));
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatus?.(status);
  }
}
