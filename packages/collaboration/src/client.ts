import { BoardDocument } from '@fleight/document';
import {
  type ClientSessionMessage,
  type Intent,
  type Operation,
  type Participant,
  PROTOCOL_VERSION,
  type PresenceMode,
  type RejectMessage,
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
  /**
   * Des lots locaux ont été refusés (conflit, verrou, objet disparu) : l'état a été
   * resynchronisé depuis le serveur. `count` regroupe les refus d'une même resynchronisation.
   */
  onRejected?(code: RejectMessage['code'], count: number): void;
  /** Nombre de modifications locales pas encore confirmées par le serveur. */
  onPending?(count: number): void;
  /** Les verrous ont changé (objet → connexion qui le détient). */
  onLocks?(locks: ReadonlyMap<string, string>): void;
  /** Une demande de verrou a été refusée : l'objet est modifié par `holder`. */
  onLockDenied?(objectIds: readonly string[], holder: string): void;
  /** Curseurs des autres participants (connexion → position monde). */
  onCursors?(cursors: ReadonlyMap<string, CursorPoint>): void;
};

export type CursorPoint = { x: number; y: number };

/** Intervalle minimal entre deux envois du curseur (~20 Hz). */
export const CURSOR_SEND_MS = 50;

/** Intervalle de renouvellement des verrous détenus (le serveur les expire après 10 s). */
export const LOCK_RENEW_MS = 4000;

export type CollaborationClientOptions = CollaborationEvents & {
  boardId: string;
  name: string;
  /** Identité du client (générée par défaut). */
  clientId?: string;
  document?: BoardDocument;
  /** Intervalle minimal entre deux envois, en ms (~30 Hz par défaut). */
  flushIntervalMs?: number;
  /** Mode de présence initial (« cursor » par défaut). */
  mode?: PresenceMode;
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
  intent?: Intent;
  /** Séquence connue quand la modification a été faite (détection des conflits). */
  baseSeq: number;
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
  /** Identité du client pour la durée de la page, conservée à travers les reconnexions. */
  readonly clientId: string;
  readonly #options: CollaborationClientOptions;
  readonly #schedule: (callback: () => void, delayMs: number) => void;
  #transport: Transport | undefined;
  #status: ConnectionStatus = 'connecting';
  #participants: Participant[] = [];
  #connectionId: string | undefined;
  /** Modifications locales non confirmées, dans l'ordre d'application. */
  #pending: PendingEntry[] = [];
  #flushScheduled = false;
  /** Geste dont des lots ont été envoyés sans le lot final. */
  #openGesture: string | undefined;
  #seq = 0;
  readonly #versions = new Map<string, number>();
  /** Verrous connus : objet → connexion qui le détient. */
  readonly #locks = new Map<string, string>();
  /** Verrous demandés par ce client, renouvelés tant qu'ils sont tenus. */
  readonly #held = new Set<string>();
  #renewScheduled = false;
  /** Refus reçus depuis la dernière resynchronisation. */
  #rejected: { count: number; code: RejectMessage['code'] } | undefined;
  /** Une resynchronisation est demandée sur la connexion courante. */
  #syncRequested = false;
  /**
   * Pour chaque demande de resynchronisation en cours, les lots déjà envoyés à ce
   * moment : le serveur traite les messages d'une connexion dans l'ordre, l'état
   * complet qu'il renverra les inclut donc déjà (ou ils auront été refusés).
   */
  #syncMarks: Array<Set<string>> = [];
  #mode: PresenceMode;
  readonly #cursors = new Map<string, CursorPoint>();
  /** Dernière position du curseur local pas encore envoyée (`null` : hors du board). */
  #cursor: { position: CursorPoint | null } | undefined;
  #cursorScheduled = false;

  constructor(options: CollaborationClientOptions) {
    this.#options = options;
    this.document = options.document ?? new BoardDocument();
    this.clientId = options.clientId ?? createId();
    this.#schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.#mode = options.mode ?? 'cursor';
  }

  /** Curseurs visibles des autres participants. */
  get cursors(): ReadonlyMap<string, CursorPoint> {
    return this.#cursors;
  }

  get presenceMode(): PresenceMode {
    return this.#mode;
  }

  /**
   * « drawing » : seuls les dessins sont partagés ; « cursor » : le curseur aussi.
   * Le mode est conservé à travers les reconnexions.
   */
  setPresenceMode(mode: PresenceMode): void {
    if (mode === this.#mode) return;
    if (mode === 'drawing' && this.#status === 'joined') {
      // Le curseur disparaît chez les autres avant le changement de mode.
      this.#send({ type: 'CURSOR', position: null });
    }
    this.#mode = mode;
    this.#cursor = undefined;
    if (this.#status === 'joined') this.#send({ type: 'PRESENCE_MODE', mode });
  }

  /**
   * Position du curseur local en coordonnées monde (`null` : il quitte le board).
   * Envoyée au plus toutes les 50 ms, seulement en mode « cursor ».
   */
  moveCursor(position: CursorPoint | null): void {
    if (this.#mode !== 'cursor' || this.#status !== 'joined') return;
    this.#cursor = { position };
    if (this.#cursorScheduled) return;
    this.#sendCursor();
  }

  #sendCursor(): void {
    const cursor = this.#cursor;
    if (!cursor || this.#mode !== 'cursor' || this.#status !== 'joined') return;
    this.#cursor = undefined;
    this.#send({ type: 'CURSOR', position: cursor.position });
    this.#cursorScheduled = true;
    this.#schedule(() => {
      this.#cursorScheduled = false;
      this.#sendCursor();
    }, CURSOR_SEND_MS);
  }

  #setCursor(connectionId: string, position: CursorPoint | null): void {
    if (position) this.#cursors.set(connectionId, position);
    else if (!this.#cursors.delete(connectionId)) return;
    this.#options.onCursors?.(this.#cursors);
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
    this.#send({
      type: 'JOIN',
      boardId: this.#options.boardId,
      name: this.#options.name,
      clientId: this.clientId,
      mode: this.#mode,
    });
  }

  disconnect(): void {
    this.#transport?.close();
    this.#transport = undefined;
    this.#setStatus('closed');
  }

  /** À appeler quand le transport se ferme. */
  handleClose(): void {
    this.#transport = undefined;
    // Une demande de resynchronisation en cours est perdue avec la connexion.
    this.#syncRequested = false;
    this.#syncMarks = [];
    this.#clearCursors();
    this.#setStatus('closed');
  }

  #clearCursors(): void {
    if (!this.#cursors.size) return;
    this.#cursors.clear();
    this.#options.onCursors?.(this.#cursors);
  }

  /**
   * Applique des opérations locales et les met en file d'envoi.
   * `gesture` regroupe les lots d'un même geste (glisser, tracer).
   */
  applyLocal(operations: Operation[], gesture?: Gesture, intent?: Intent): void {
    if (!operations.length) return;
    const inverse = this.document.apply(operations);
    // Un lot ne mélange pas deux gestes : on envoie la file au changement de geste.
    const queued = this.#unsent();
    if (queued.length && queued[queued.length - 1]?.gesture?.id !== gesture?.id) this.flush();
    this.#pending.push({
      operations,
      inverse,
      baseSeq: this.#seq,
      ...(gesture ? { gesture } : {}),
      ...(intent ? { intent } : {}),
    });
    this.#notifyPending();
    if (!gesture || gesture.final) this.flush();
    else this.#scheduleFlush();
  }

  /** Fin d'un geste (pointer up) : son dernier lot est envoyé, marqué final. */
  endGesture(gestureId: string): void {
    const entries = this.#unsent();
    const last = entries[entries.length - 1];
    if (last?.gesture?.id === gestureId) {
      last.gesture = { id: gestureId, final: true };
      this.flush();
    } else if (this.#openGesture === gestureId) {
      // Tous les lots du geste sont partis : on signale seulement sa fin.
      this.#openGesture = undefined;
      if (this.#status === 'joined') this.#send({ type: 'GESTURE_END', gestureId });
    }
  }

  /**
   * Envoie immédiatement les opérations en file, en un seul lot.
   * Hors connexion, elles restent en file et partiront à la reconnexion.
   */
  flush(): void {
    if (this.#status !== 'joined') return;
    const entries = this.#unsent();
    if (!entries.length) return;
    const batchId = createId();
    const gesture = entries[entries.length - 1]?.gesture;
    for (const entry of entries) entry.batchId = batchId;
    this.#openGesture = gesture && !gesture.final ? gesture.id : undefined;
    this.#sendBatch(batchId, entries, gesture);
  }

  #sendBatch(batchId: string, entries: PendingEntry[], gesture?: Gesture): void {
    const operations = compactOperations(entries.flatMap((entry) => entry.operations));
    if (!operations.length) return;
    // Une annulation est envoyée seule (sans geste) : son lot porte son intention.
    const intent = entries.length === 1 ? entries[0]?.intent : undefined;
    this.#send({
      type: 'OPS',
      batchId,
      operations,
      baseSeq: Math.min(...entries.map((entry) => entry.baseSeq)),
      ...(gesture ? { gesture } : {}),
      ...(intent ? { intent } : {}),
    });
  }

  /**
   * Après une reconnexion : renvoie les lots partis sans confirmation (le serveur
   * reconnaît ceux qu'il avait déjà appliqués), puis la file d'attente.
   */
  #resendPending(): void {
    const batches = new Map<string, PendingEntry[]>();
    for (const entry of this.#pending) {
      if (entry.batchId === undefined) continue;
      const entries = batches.get(entry.batchId) ?? [];
      entries.push(entry);
      batches.set(entry.batchId, entries);
    }
    // Le geste éventuellement en cours avant la coupure est clos côté serveur.
    for (const [batchId, entries] of batches) this.#sendBatch(batchId, entries);
    this.#openGesture = undefined;

    // Modifications faites hors connexion : un lot par action (un geste = une action),
    // pour qu'un conflit n'entraîne que le refus de l'action concernée.
    const unsent = this.#unsent();
    const groups: PendingEntry[][] = [];
    for (const entry of unsent) {
      const last = groups[groups.length - 1];
      const previous = last?.[last.length - 1];
      if (last && entry.gesture && previous?.gesture?.id === entry.gesture.id) last.push(entry);
      else groups.push([entry]);
    }
    const lastGroup = groups.pop();
    for (const group of groups) {
      const batchId = createId();
      for (const entry of group) entry.batchId = batchId;
      this.#sendBatch(batchId, group);
    }
    // Le dernier groupe peut être un geste encore en cours : il suit le circuit normal.
    if (lastGroup?.length) this.flush();
  }

  /** Verrouille des objets avant de les modifier (renouvelé jusqu'à `unlock`). */
  lock(objectIds: Iterable<string>): void {
    const ids = [...objectIds].filter((id) => !this.#held.has(id));
    if (!ids.length) return;
    for (const id of ids) this.#held.add(id);
    this.#send({ type: 'LOCK', objectIds: ids });
    this.#scheduleRenew();
  }

  unlock(objectIds: Iterable<string>): void {
    const ids = [...objectIds].filter((id) => this.#held.delete(id));
    if (ids.length) this.#send({ type: 'UNLOCK', objectIds: ids });
  }

  /** Connexion qui modifie l'objet, si ce n'est pas celle-ci. */
  lockedByOther(objectId: string): string | undefined {
    const holder = this.#locks.get(objectId);
    return holder && holder !== this.#connectionId ? holder : undefined;
  }

  get locks(): ReadonlyMap<string, string> {
    return this.#locks;
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
        this.#connectionId = message.self;
        this.#locks.clear();
        for (const [id, holder] of Object.entries(message.locks)) this.#locks.set(id, holder);
        this.#options.onLocks?.(this.#locks);
        // Verrous tenus avant une reconnexion : on les redemande.
        if (this.#held.size) this.#send({ type: 'LOCK', objectIds: [...this.#held] });
        // Lots appliqués par le serveur dont l'accusé s'est perdu : déjà dans l'état reçu.
        if (message.applied.length) {
          const applied = new Set(message.applied);
          this.#pending = this.#pending.filter(
            ({ batchId }) => batchId === undefined || !applied.has(batchId),
          );
        }
        this.#loadSnapshot(message.snapshot);
        // L'état complet vient d'être reçu : les refus antérieurs sont résolus.
        this.#syncRequested = false;
        this.#syncMarks = [];
        this.#reportRejections();
        this.#participants = message.participants;
        this.#options.onParticipants?.(this.#participants);
        this.#clearCursors();
        this.#setStatus('joined');
        this.#resendPending();
        break;
      case 'SNAPSHOT': {
        // Les lots envoyés avant la demande sont déjà dans cet état : les réappliquer
        // par-dessus écraserait les modifications plus récentes des autres.
        const included = this.#syncMarks.shift();
        if (included) {
          this.#pending = this.#pending.filter(
            ({ batchId }) => batchId === undefined || !included.has(batchId),
          );
        }
        this.#loadSnapshot(message.snapshot);
        this.#syncRequested = false;
        this.#reportRejections();
        break;
      }
      case 'ACK': {
        this.#pending = this.#pending.filter(({ batchId }) => batchId !== message.batchId);
        this.#notifyPending();
        // Lot appliqué plus tôt : il a pu être réappliqué ici par-dessus des modifications
        // plus récentes. L'état du serveur fait foi.
        if (message.duplicate && !this.#syncRequested) {
          this.#syncRequested = true;
          this.#requestSync();
        }
        // Accusé d'un lot déjà inclus dans un état complet plus récent : ses versions sont dépassées.
        if (message.seq > this.#seq) {
          this.#seq = message.seq;
          this.#storeVersions(message.versions);
        }
        break;
      }
      case 'REJECT': {
        // Seul ce lot est abandonné ; l'état du serveur fait foi (resynchronisation).
        this.#pending = this.#pending.filter(({ batchId }) => batchId !== message.batchId);
        this.#notifyPending();
        if (!this.#syncRequested) {
          this.#syncRequested = true;
          this.#requestSync();
        }
        this.#rejected = {
          count: (this.#rejected?.count ?? 0) + 1,
          code: message.code,
        };
        break;
      }
      case 'LOCKS': {
        for (const id of message.unlocked) this.#locks.delete(id);
        for (const [id, holder] of Object.entries(message.locked)) this.#locks.set(id, holder);
        this.#options.onLocks?.(this.#locks);
        // Verrou accordé à une demande dont un refus antérieur, arrivé entre-temps,
        // a fait abandonner l'objet : on le rend aussitôt plutôt que d'attendre son expiration.
        const unwanted = Object.entries(message.locked)
          .filter(([id, holder]) => holder === this.#connectionId && !this.#held.has(id))
          .map(([id]) => id);
        if (unwanted.length) this.#send({ type: 'UNLOCK', objectIds: unwanted });
        break;
      }
      case 'LOCK_DENIED':
        for (const id of message.objectIds) {
          this.#held.delete(id);
          this.#locks.set(id, message.holder);
        }
        this.#options.onLocks?.(this.#locks);
        this.#options.onLockDenied?.(message.objectIds, message.holder);
        break;
      case 'OPS':
        // Lot diffusé après un état complet (JOINED, SNAPSHOT) qui l'inclut déjà :
        // le réappliquer ramènerait les objets en arrière.
        if (message.seq <= this.#seq) break;
        this.#applyRemote(message.operations);
        this.#seq = message.seq;
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
        this.#setCursor(message.connectionId, null);
        break;
      case 'PARTICIPANT_UPDATED': {
        const { participant } = message;
        this.#participants = this.#participants.map((current) =>
          current.connectionId === participant.connectionId ? participant : current,
        );
        this.#options.onParticipants?.(this.#participants);
        if (participant.mode !== 'cursor') this.#setCursor(participant.connectionId, null);
        break;
      }
      case 'CURSOR':
        this.#setCursor(message.connectionId, message.position);
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
    this.#notifyPending();
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
  #requestSync(): void {
    // Hors connexion, la demande serait perdue : l'état complet viendra avec JOINED.
    if (!this.#transport) return;
    this.#syncMarks.push(
      new Set(this.#pending.flatMap(({ batchId }) => (batchId === undefined ? [] : [batchId]))),
    );
    this.#send({ type: 'SYNC_REQUEST' });
  }

  #resync(): void {
    this.#pending = [];
    this.#notifyPending();
    this.#requestSync();
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

  #scheduleRenew(): void {
    if (this.#renewScheduled) return;
    this.#renewScheduled = true;
    this.#schedule(() => {
      this.#renewScheduled = false;
      // Un objet supprimé entre-temps n'a plus de verrou à renouveler.
      for (const id of this.#held) if (!this.document.has(id)) this.#held.delete(id);
      if (!this.#held.size) return;
      this.#send({ type: 'LOCK', objectIds: [...this.#held] });
      this.#scheduleRenew();
    }, LOCK_RENEW_MS);
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

  /** Signale en une fois les refus accumulés avant la dernière resynchronisation. */
  #reportRejections(): void {
    if (!this.#rejected) return;
    this.#options.onRejected?.(this.#rejected.code, this.#rejected.count);
    this.#rejected = undefined;
  }

  #notifyPending(): void {
    this.#options.onPending?.(this.pendingActions);
  }

  /** Actions locales non confirmées (un geste compte pour une action). */
  get pendingActions(): number {
    const gestures = new Set<string>();
    let count = 0;
    for (const entry of this.#pending) {
      if (!entry.gesture) count += 1;
      else if (!gestures.has(entry.gesture.id)) {
        gestures.add(entry.gesture.id);
        count += 1;
      }
    }
    return count;
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatus?.(status);
  }
}
