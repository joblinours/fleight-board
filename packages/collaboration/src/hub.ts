import {
  type ClientSessionMessage,
  ClientSessionMessageSchema,
  type Operation,
  type Participant,
  type ServerSessionMessage,
} from '@fleight/protocol';
import { BoardRoom } from './board-room';
import { compactOperations, touchedIds } from './compact';
import { LockTable } from './locks';
import { InMemoryPubSub, type PubSub, type Unsubscribe } from './pubsub';
import { type BoardStore, type JournalEntry, MemoryBoardStore } from './store';

/** Message diffusé aux connexions d'un board ; `exclude` ne le reçoit pas. */
type Broadcast = { payload: ServerSessionMessage; exclude?: string };

export type HubConnection = {
  /** Message de session déjà décodé (JSON) reçu de la connexion. */
  receive(data: unknown): void;
  close(): void;
};

export type HubLogger = {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
};

/** Board chargé en mémoire. */
type LoadedRoom = {
  room: BoardRoom;
  participants: Map<string, Participant>;
  locks: LockTable;
  /** Enregistrements en cours, chaînés pour respecter l'ordre des séquences. */
  persistence: Promise<void>;
  /** Le stockage a échoué : le board doit être rechargé. */
  broken: boolean;
};

/** Geste en cours d'une connexion : ses opérations sont journalisées en une fois. */
type OpenGesture = { id: string; operations: Operation[]; seq: number };

/**
 * Gestion des sessions collaboratives, indépendante du transport :
 * chaque connexion rejoint un board, envoie des lots d'opérations,
 * reçoit accusés de réception et opérations des autres.
 *
 * Un lot est appliqué en mémoire dans l'ordre d'arrivée, puis enregistré ;
 * l'accusé de réception et la diffusion n'ont lieu qu'une fois l'enregistrement fait.
 */
export class CollaborationHub {
  readonly #rooms = new Map<string, Promise<LoadedRoom>>();
  readonly #pubsub: PubSub<Broadcast>;
  readonly #store: BoardStore;
  readonly #log: HubLogger | undefined;
  readonly #disconnects = new Map<string, () => void>();
  readonly #lockOptions: { ttlMs?: number; now?: () => number };

  constructor(
    options: {
      pubsub?: PubSub<Broadcast>;
      store?: BoardStore;
      log?: HubLogger;
      /** Durée de vie d'un verrou sans activité (10 s par défaut). */
      lockTtlMs?: number;
      /** Horloge, injectable pour les tests. */
      now?: () => number;
    } = {},
  ) {
    this.#pubsub = options.pubsub ?? new InMemoryPubSub<Broadcast>();
    this.#store = options.store ?? new MemoryBoardStore();
    this.#log = options.log;
    this.#lockOptions = {
      ...(options.lockTtlMs !== undefined ? { ttlMs: options.lockTtlMs } : {}),
      ...(options.now ? { now: options.now } : {}),
    };
  }

  /**
   * Libère les verrous expirés et prévient les participants.
   * À appeler périodiquement (toutes les secondes, par exemple).
   */
  async sweepLocks(): Promise<void> {
    for (const [boardId, loading] of this.#rooms) {
      const loaded = await loading;
      const expired = loaded.locks.expire();
      if (expired.length) this.#broadcastLocks(boardId, loaded, {}, expired);
    }
  }

  /** Nombre de boards chargés en mémoire. */
  get roomCount(): number {
    return this.#rooms.size;
  }

  /** Board chargé en mémoire, s'il l'est. */
  async room(boardId: string): Promise<BoardRoom | undefined> {
    return (await this.#rooms.get(boardId))?.room;
  }

  /** Attend la fin des enregistrements en cours (arrêt propre, tests). */
  async flush(): Promise<void> {
    const rooms = await Promise.all(this.#rooms.values());
    await Promise.all(rooms.map(({ persistence }) => persistence));
  }

  /**
   * Ouvre une connexion. `disconnect` est appelé si le serveur doit la fermer
   * (échec de l'enregistrement) : le client la rouvrira et rechargera l'état.
   */
  open(
    connectionId: string,
    send: (message: ServerSessionMessage) => void,
    disconnect?: () => void,
  ): HubConnection {
    let joined: { boardId: string; loaded: LoadedRoom; unsubscribe: Unsubscribe } | undefined;
    let gesture: OpenGesture | undefined;
    // Les messages d'une connexion sont traités l'un après l'autre (le JOIN est asynchrone).
    let queue = Promise.resolve();
    if (disconnect) this.#disconnects.set(connectionId, disconnect);

    /** Journalise le geste ouvert (fin du geste, nouveau geste, départ). */
    const closeGesture = (): JournalEntry[] => {
      if (!gesture) return [];
      const entry: JournalEntry = {
        seq: gesture.seq,
        actor: connectionId,
        gestureId: gesture.id,
        operations: compactOperations(gesture.operations),
      };
      gesture = undefined;
      return [entry];
    };

    const leave = () => {
      if (!joined) return;
      const { boardId, loaded, unsubscribe } = joined;
      joined = undefined;
      unsubscribe();
      const released = loaded.locks.releaseAll(connectionId);
      if (released.length) this.#broadcastLocks(boardId, loaded, {}, released);
      const journal = closeGesture();
      if (journal.length) {
        this.#persist(boardId, loaded, { seq: loaded.room.seq, upserts: [], deletes: [], journal });
      }
      loaded.participants.delete(connectionId);
      void this.#pubsub.publish(channel(boardId), {
        payload: { type: 'PARTICIPANT_LEFT', connectionId },
        exclude: connectionId,
      });
      this.#evictIfEmpty(boardId, loaded);
    };

    const handle = async (message: ClientSessionMessage) => {
      switch (message.type) {
        case 'JOIN': {
          leave();
          const loaded = await this.#load(message.boardId);
          const participant = { connectionId, name: message.name };
          loaded.participants.set(connectionId, participant);
          const unsubscribe = this.#pubsub.subscribe(
            channel(message.boardId),
            ({ payload, exclude }) => {
              if (exclude !== connectionId) send(payload);
            },
          );
          joined = { boardId: message.boardId, loaded, unsubscribe };
          send({
            type: 'JOINED',
            self: connectionId,
            snapshot: loaded.room.snapshot(),
            participants: [...loaded.participants.values()],
            locks: loaded.locks.snapshot(),
          });
          void this.#pubsub.publish(channel(message.boardId), {
            payload: { type: 'PARTICIPANT_JOINED', participant },
            exclude: connectionId,
          });
          break;
        }
        case 'LEAVE':
          leave();
          break;
        case 'GESTURE_END': {
          if (!joined || gesture?.id !== message.gestureId) return;
          const { boardId, loaded } = joined;
          this.#persist(boardId, loaded, {
            seq: loaded.room.seq,
            upserts: [],
            deletes: [],
            journal: closeGesture(),
          });
          break;
        }
        case 'LOCK': {
          if (!joined) return;
          const { boardId, loaded } = joined;
          // Seuls les objets existants se verrouillent.
          const objectIds = message.objectIds.filter((id) => loaded.room.document.has(id));
          if (!objectIds.length) return;
          const result = loaded.locks.acquire(connectionId, objectIds);
          if (!result.ok) {
            send({ type: 'LOCK_DENIED', objectIds: result.objectIds, holder: result.holder });
            return;
          }
          const locked = Object.fromEntries(objectIds.map((id) => [id, connectionId]));
          this.#broadcastLocks(boardId, loaded, locked, []);
          break;
        }
        case 'UNLOCK': {
          if (!joined) return;
          const { boardId, loaded } = joined;
          const released = loaded.locks.release(connectionId, message.objectIds);
          if (released.length) this.#broadcastLocks(boardId, loaded, {}, released);
          break;
        }
        case 'SYNC_REQUEST':
          if (joined) send({ type: 'SNAPSHOT', snapshot: joined.loaded.room.snapshot() });
          break;
        case 'OPS': {
          if (!joined) {
            send({
              type: 'REJECT',
              batchId: message.batchId,
              code: 'NOT_JOINED',
              message: 'Aucun board rejoint',
            });
            return;
          }
          const { boardId, loaded } = joined;
          // Un objet verrouillé par un autre participant n'est pas modifiable.
          const touched = touchedIds(message.operations);
          const holder = [...touched]
            .map((id) => loaded.locks.holderOf(id))
            .find((current) => current !== undefined && current !== connectionId);
          if (holder) {
            send({
              type: 'REJECT',
              batchId: message.batchId,
              code: 'LOCKED',
              message: 'Objet en cours de modification par un autre participant',
            });
            return;
          }
          const result = loaded.room.apply(message.operations);
          if (!result.ok) {
            this.#log?.warn({ connectionId, boardId, reason: result.message }, 'lot refusé');
            send({
              type: 'REJECT',
              batchId: message.batchId,
              code: 'INVALID_OPERATION',
              message: result.message,
            });
            return;
          }

          loaded.locks.touch(connectionId, touched);
          const removedLocks = loaded.locks.remove(result.deletes);

          // Journal : un lot hors geste est une entrée ; un geste n'en produit qu'une, à sa fin.
          const journal: JournalEntry[] = [];
          if (gesture && gesture.id !== message.gesture?.id) journal.push(...closeGesture());
          if (message.gesture) {
            gesture ??= { id: message.gesture.id, operations: [], seq: result.seq };
            gesture.operations.push(...message.operations);
            gesture.seq = result.seq;
            if (message.gesture.final) journal.push(...closeGesture());
          } else {
            journal.push({
              seq: result.seq,
              actor: connectionId,
              operations: message.operations,
              ...(message.intent ? { intent: message.intent } : {}),
            });
          }

          this.#persist(
            boardId,
            loaded,
            { seq: result.seq, upserts: result.upserts, deletes: result.deletes, journal },
            () => {
              send({
                type: 'ACK',
                batchId: message.batchId,
                seq: result.seq,
                versions: result.versions,
              });
              void this.#pubsub.publish(channel(boardId), {
                payload: {
                  type: 'OPS',
                  seq: result.seq,
                  actor: connectionId,
                  operations: message.operations,
                  versions: result.versions,
                  ...(message.gesture ? { gesture: message.gesture } : {}),
                  ...(message.intent ? { intent: message.intent } : {}),
                },
                exclude: connectionId,
              });
            },
          );
          if (removedLocks.length) this.#broadcastLocks(boardId, loaded, {}, removedLocks);
          break;
        }
      }
    };

    return {
      receive: (data) => {
        const parsed = ClientSessionMessageSchema.safeParse(data);
        if (!parsed.success) {
          const batchId = (data as { batchId?: unknown })?.batchId;
          if (typeof batchId === 'string') {
            send({ type: 'REJECT', batchId, code: 'INVALID_OPERATION', message: 'Lot invalide' });
          }
          this.#log?.warn({ connectionId }, 'message de session invalide');
          return;
        }
        queue = queue
          .then(() => handle(parsed.data))
          .catch((error: unknown) => {
            this.#log?.error({ connectionId, error: String(error) }, 'échec du traitement');
            disconnect?.();
          });
      },
      close: () => {
        this.#disconnects.delete(connectionId);
        queue = queue.then(leave);
      },
    };
  }

  /** Charge un board (une seule fois, même si plusieurs connexions le demandent). */
  #load(boardId: string): Promise<LoadedRoom> {
    let loading = this.#rooms.get(boardId);
    if (!loading) {
      loading = this.#store.load(boardId).then((stored) => ({
        room: new BoardRoom(boardId, stored),
        participants: new Map<string, Participant>(),
        locks: new LockTable(this.#lockOptions),
        persistence: Promise.resolve(),
        broken: false,
      }));
      this.#rooms.set(boardId, loading);
      // Un échec de chargement ne doit pas rester en cache.
      loading.catch(() => this.#rooms.delete(boardId));
    }
    return loading;
  }

  /**
   * Diffuse un changement de verrous à tous les participants. Il passe après les
   * enregistrements en cours : un participant ne voit un objet libéré qu'après
   * avoir reçu les dernières modifications de son détenteur.
   */
  #broadcastLocks(
    boardId: string,
    loaded: LoadedRoom,
    locked: Record<string, string>,
    unlocked: string[],
  ): void {
    loaded.persistence = loaded.persistence.then(() =>
      this.#pubsub.publish(channel(boardId), { payload: { type: 'LOCKS', locked, unlocked } }),
    );
  }

  /** Enregistre un commit après les précédents, puis appelle `then`. */
  #persist(
    boardId: string,
    loaded: LoadedRoom,
    commit: Parameters<BoardStore['commit']>[1],
    then?: () => void,
  ): void {
    loaded.persistence = loaded.persistence.then(async () => {
      if (loaded.broken) return;
      try {
        await this.#store.commit(boardId, commit);
        then?.();
      } catch (error) {
        this.#fail(boardId, loaded, error);
      }
    });
  }

  /**
   * Échec d'enregistrement : l'état en mémoire n'est plus garanti durable.
   * Le board est déchargé et ses participants déconnectés ; à leur retour,
   * ils retrouvent l'état réellement enregistré.
   */
  #fail(boardId: string, loaded: LoadedRoom, error: unknown): void {
    if (loaded.broken) return;
    loaded.broken = true;
    this.#log?.error({ boardId, error: String(error) }, 'échec de l’enregistrement du board');
    this.#rooms.delete(boardId);
    for (const connectionId of loaded.participants.keys()) this.#disconnects.get(connectionId)?.();
  }

  /** Décharge un board sans participant une fois ses enregistrements terminés. */
  #evictIfEmpty(boardId: string, loaded: LoadedRoom): void {
    if (loaded.participants.size > 0) return;
    void loaded.persistence.then(async () => {
      if (loaded.participants.size === 0 && (await this.#rooms.get(boardId)) === loaded) {
        this.#rooms.delete(boardId);
      }
    });
  }
}

function channel(boardId: string): string {
  return `board:${boardId}`;
}
