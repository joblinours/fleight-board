import { atLeast, can } from '@fleight/permissions';
import {
  type BoardRole,
  type ClientSessionMessage,
  ClientSessionMessageSchema,
  type Operation,
  PARTICIPANT_COLORS,
  type Participant,
  type ServerSessionMessage,
} from '@fleight/protocol';
import { BoardRoom } from './board-room';
import { compactOperations, touchedIds } from './compact';
import { LockTable } from './locks';
import { InMemoryPubSub, type PubSub, type Unsubscribe } from './pubsub';
import {
  type BoardCommit,
  type BoardStore,
  type JournalEntry,
  MemoryBoardStore,
  mergeCommits,
} from './store';

/** Message diffusé aux connexions d'un board ; `exclude` ne le reçoit pas. */
/**
 * Message diffusé aux connexions d'un board ; `exclude` ne le reçoit pas, et
 * seules les connexions d'au moins `minRole` le reçoivent.
 */
type Broadcast = { payload: ServerSessionMessage; exclude?: string; minRole?: BoardRole };

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
  /**
   * Commits en attente du prochain enregistrement : ceux qui arrivent pendant
   * qu'un enregistrement est en cours partent ensemble, en une transaction.
   */
  nextGroup: CommitGroup | undefined;
  /** Le stockage a échoué ou le board a été supprimé : il doit être rechargé. */
  broken: boolean;
  /** Le board n'existe pas dans le stockage. */
  missing: boolean;
};

/**
 * Raison pour laquelle le serveur ferme une connexion : échec d'enregistrement
 * (le client se reconnecte), board inexistant ou supprimé (inutile de revenir).
 */
export type DisconnectReason = 'storage' | 'board-not-found' | 'board-deleted' | 'forbidden';

/** Utilisateur authentifié d'une connexion (compte, ou invité sans compte). */
export type HubUser = { id: string; name: string; guest?: boolean };

/**
 * Rôle d'un utilisateur sur un board ; `undefined` : aucun accès.
 * Sans authentification (`user` absent), la décision revient aussi à cette fonction.
 */
export type Authorize = (
  boardId: string,
  user: HubUser | undefined,
) => Promise<BoardRole | undefined> | BoardRole | undefined;

type CommitGroup = Array<{ commit: BoardCommit; then: (() => void) | undefined }>;

/** Intervalle minimal entre deux curseurs relayés pour une connexion. */
const CURSOR_INTERVAL_MS = 20;

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
  /** Boards chargés, accessibles sans attente (vérifications synchrones). */
  readonly #loaded = new Map<string, LoadedRoom>();
  readonly #pubsub: PubSub<Broadcast>;
  readonly #store: BoardStore;
  readonly #log: HubLogger | undefined;
  readonly #disconnects = new Map<string, (reason: DisconnectReason) => void>();
  /** Réévaluation du rôle de chaque connexion (membres modifiés). */
  readonly #refreshers = new Map<
    string,
    { boardId: () => string | undefined; refresh: () => Promise<void> }
  >();
  /**
   * Rôle de chaque connexion sur le board qu'elle rejoint (permissions). Sans
   * cette fonction, tout participant est Editor. Modifiable après la construction
   * (l'application la branche sur ses whiteboards).
   */
  authorize: Authorize | undefined;
  readonly #requireExistingBoards: boolean;
  readonly #lockOptions: { ttlMs?: number; now?: () => number };
  readonly #now: () => number;

  constructor(
    options: {
      pubsub?: PubSub<Broadcast>;
      store?: BoardStore;
      log?: HubLogger;
      /** Durée de vie d'un verrou sans activité (10 s par défaut). */
      lockTtlMs?: number;
      /** Horloge, injectable pour les tests. */
      now?: () => number;
      /**
       * Refuse de rejoindre un board absent du stockage (créé par l'API) ; sinon
       * il est créé à la première modification (tests, développement sans base).
       */
      requireExistingBoards?: boolean;
      /**
       * Rôle de chaque connexion sur le board qu'elle rejoint (permissions).
       * Sans cette fonction, tout participant est Editor.
       */
      authorize?: Authorize;
    } = {},
  ) {
    this.authorize = options.authorize;
    this.#requireExistingBoards = options.requireExistingBoards ?? false;
    this.#pubsub = options.pubsub ?? new InMemoryPubSub<Broadcast>();
    this.#store = options.store ?? new MemoryBoardStore();
    this.#log = options.log;
    this.#now = options.now ?? Date.now;
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

  /**
   * Board supprimé : il est déchargé, ses enregistrements en attente abandonnés,
   * et ses participants déconnectés.
   */
  evict(boardId: string): void {
    const loaded = this.#loaded.get(boardId);
    if (!loaded) return;
    loaded.broken = true;
    this.#unload(boardId, loaded);
    for (const connectionId of loaded.participants.keys()) {
      this.#disconnects.get(connectionId)?.('board-deleted');
    }
  }

  /**
   * Les membres d'un board ont changé : le rôle de chaque connexion est réévalué.
   * Un participant qui perd l'accès est déconnecté ; les autres voient son nouveau rôle.
   */
  async refreshAccess(boardId: string): Promise<void> {
    const refreshes = [...this.#refreshers.values()]
      .filter((entry) => entry.boardId() === boardId)
      .map((entry) => entry.refresh());
    await Promise.all(refreshes);
  }

  /**
   * Session privée : sans accès, une connexion dont l'accès est demandé attend la
   * décision au lieu d'être refusée (`true` : une demande est en attente).
   */
  awaitsAccess: ((boardId: string, user: HubUser | undefined) => Promise<boolean>) | undefined;

  /** Un participant authentifié (compte) a quitté un board. */
  onLeave: ((boardId: string, userId: string) => void) | undefined;

  /** Le compte est connecté au board (accès « tant qu'il est connecté »). */
  isConnected(boardId: string, userId: string): boolean {
    const loaded = this.#loaded.get(boardId);
    if (!loaded) return false;
    for (const participant of loaded.participants.values()) {
      if (participant.userId === userId) return true;
    }
    return false;
  }

  /** Prévient les Co-owners et le propriétaire connectés que les demandes d'accès ont changé. */
  notifyAccessRequests(boardId: string, pending: number): void {
    if (!this.#loaded.has(boardId)) return;
    void this.#pubsub.publish(channel(boardId), {
      payload: { type: 'ACCESS_REQUESTED', pending },
      minRole: 'co-owner',
    });
  }

  /** Réévalue les droits de toutes les sessions (accès temporaires expirés). */
  async refreshAllAccess(): Promise<void> {
    await Promise.all([...this.#loaded.keys()].map((boardId) => this.refreshAccess(boardId)));
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
    disconnect?: (reason: DisconnectReason) => void,
    /** Utilisateur authentifié : auteur journalisé et nom affiché aux autres participants. */
    user?: HubUser,
  ): HubConnection {
    let joined:
      | { boardId: string; loaded: LoadedRoom; unsubscribe: Unsubscribe; clientId: string }
      | undefined;
    let gesture: OpenGesture | undefined;
    /** Rôle sur le board rejoint. */
    let role: BoardRole = 'editor';
    /** Dernier curseur relayé (limitation du débit). */
    let lastCursorAt = Number.NEGATIVE_INFINITY;
    /** Auteur journalisé : l'utilisateur, à défaut le client (stable à travers les reconnexions). */
    let actor = user?.id ?? connectionId;
    let actorName: string | undefined = user?.name;
    const actorType = user
      ? user.guest
        ? ('guest' as const)
        : ('user' as const)
      : ('client' as const);
    /** Session privée : JOIN en attente de la décision sur la demande d'accès. */
    let waiting: Extract<ClientSessionMessage, { type: 'JOIN' }> | undefined;
    // Les messages d'une connexion sont traités l'un après l'autre (le JOIN est asynchrone).
    let queue = Promise.resolve();
    if (disconnect) this.#disconnects.set(connectionId, disconnect);

    /** Journalise le geste ouvert (fin du geste, nouveau geste, départ). */
    const closeGesture = (): JournalEntry[] => {
      if (!gesture) return [];
      const entry: JournalEntry = {
        seq: gesture.seq,
        actor,
        session: connectionId,
        actorType,
        ...(actorName ? { actorName } : {}),
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
      if (user && !user.guest) this.onLeave?.(boardId, user.id);
    };

    /** Rejoint un board : rôle vérifié, salle d'attente d'une session privée. */
    const join = async (message: Extract<ClientSessionMessage, { type: 'JOIN' }>) => {
      leave();
      waiting = undefined;
      const loaded = await this.#join(message.boardId);
      if (loaded.missing && this.#requireExistingBoards) {
        this.#evictIfEmpty(message.boardId, loaded);
        disconnect?.('board-not-found');
        return;
      }
      const granted = this.authorize
        ? await this.authorize(message.boardId, user)
        : ('editor' as const);
      if (!granted || !can(granted, 'board.view')) {
        this.#evictIfEmpty(message.boardId, loaded);
        if (await this.awaitsAccess?.(message.boardId, user)) {
          // Demande d'accès en attente : la connexion attend la décision (refreshAccess).
          waiting = message;
          send({ type: 'ACCESS_PENDING' });
          return;
        }
        disconnect?.('forbidden');
        return;
      }
      role = granted;
      const used = new Set([...loaded.participants.values()].map(({ color }) => color));
      const participant: Participant = {
        connectionId,
        name: user?.name ?? message.name,
        ...(user && !user.guest ? { userId: user.id } : {}),
        ...(user?.guest ? { guest: true } : {}),
        color: pickColor(user?.id ?? message.clientId, used),
        mode: message.mode ?? 'cursor',
        role,
      };
      loaded.participants.set(connectionId, participant);
      const unsubscribe = this.#pubsub.subscribe(
        channel(message.boardId),
        ({ payload, exclude, minRole }) => {
          if (exclude === connectionId) return;
          if (minRole && !atLeast(role, minRole)) return;
          send(payload);
        },
      );
      joined = { boardId: message.boardId, loaded, unsubscribe, clientId: message.clientId };
      // Sans compte, le client (stable à travers les reconnexions) tient lieu d'auteur.
      if (!user) {
        actor = message.clientId;
        actorName = message.name;
      }
      send({
        type: 'JOINED',
        self: connectionId,
        role,
        snapshot: loaded.room.snapshot(),
        participants: [...loaded.participants.values()],
        locks: loaded.locks.snapshot(),
        applied: loaded.room.appliedBatchesOf(message.clientId),
      });
      void this.#pubsub.publish(channel(message.boardId), {
        payload: { type: 'PARTICIPANT_JOINED', participant },
        exclude: connectionId,
      });
    };

    const handle = async (message: ClientSessionMessage) => {
      switch (message.type) {
        case 'JOIN':
          await join(message);
          break;
        case 'LEAVE':
          waiting = undefined;
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
          if (!joined || !can(role, 'board.edit')) return;
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
        case 'CURSOR': {
          if (!joined) return;
          const participant = joined.loaded.participants.get(connectionId);
          // « Drawing only » : le curseur n'est pas partagé.
          if (participant?.mode !== 'cursor') return;
          const now = this.#now();
          // Un curseur qui quitte le board passe toujours ; les autres sont limités.
          if (message.position && now - lastCursorAt < CURSOR_INTERVAL_MS) return;
          lastCursorAt = now;
          void this.#pubsub.publish(channel(joined.boardId), {
            payload: { type: 'CURSOR', connectionId, position: message.position },
            exclude: connectionId,
          });
          break;
        }
        case 'PRESENCE_MODE': {
          if (!joined) return;
          const current = joined.loaded.participants.get(connectionId);
          if (!current || current.mode === message.mode) return;
          const participant = { ...current, mode: message.mode };
          joined.loaded.participants.set(connectionId, participant);
          // Tous les participants (le demandeur compris) voient le nouveau mode.
          void this.#pubsub.publish(channel(joined.boardId), {
            payload: { type: 'PARTICIPANT_UPDATED', participant },
          });
          break;
        }
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
          const { boardId, loaded, clientId } = joined;
          if (!can(role, 'board.edit')) {
            send({
              type: 'REJECT',
              batchId: message.batchId,
              code: 'FORBIDDEN',
              message: 'Votre rôle ne permet pas de modifier ce board',
            });
            return;
          }
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
          const result = loaded.room.apply(message.operations, {
            actor: clientId,
            baseSeq: message.baseSeq,
            batchId: message.batchId,
          });
          if (!result.ok) {
            this.#log?.warn({ connectionId, boardId, reason: result.message }, 'lot refusé');
            send({
              type: 'REJECT',
              batchId: message.batchId,
              code: result.code === 'CONFLICT' ? 'CONFLICT' : 'INVALID_OPERATION',
              message: result.message,
            });
            return;
          }
          if (result.duplicate) {
            // Lot renvoyé après une reconnexion, déjà appliqué : on le confirme seulement.
            const seq = result.seq;
            this.#after(loaded, () =>
              send({ type: 'ACK', batchId: message.batchId, seq, versions: {}, duplicate: true }),
            );
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
              actor,
              session: connectionId,
              actorType,
              ...(actorName ? { actorName } : {}),
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

    /** Réévalue le rôle (membres modifiés) ; sans accès, la connexion est fermée. */
    const refresh = async () => {
      // En salle d'attente : la décision est peut-être prise.
      if (waiting && !joined) {
        await join(waiting);
        return;
      }
      if (!joined || !this.authorize) return;
      const { boardId } = joined;
      const granted = await this.authorize(boardId, user);
      // La connexion a pu quitter le board pendant la vérification.
      if (!joined || joined.boardId !== boardId) return;
      if (!granted || !can(granted, 'board.view')) {
        leave();
        disconnect?.('forbidden');
        return;
      }
      if (granted === role) return;
      role = granted;
      const { loaded } = joined;
      // Qui ne peut plus modifier rend ses verrous.
      if (!can(role, 'board.edit')) {
        const released = loaded.locks.releaseAll(connectionId);
        if (released.length) this.#broadcastLocks(boardId, loaded, {}, released);
      }
      const current = loaded.participants.get(connectionId);
      if (!current) return;
      const participant = { ...current, role };
      loaded.participants.set(connectionId, participant);
      void this.#pubsub.publish(channel(boardId), {
        payload: { type: 'PARTICIPANT_UPDATED', participant },
      });
    };
    this.#refreshers.set(connectionId, {
      boardId: () => joined?.boardId ?? waiting?.boardId,
      refresh: () => {
        // Dans la file de la connexion : après un JOIN en cours.
        queue = queue.then(refresh).catch((error: unknown) => {
          this.#log?.error(
            { connectionId, error: String(error) },
            'échec de la vérification des droits',
          );
        });
        return queue;
      },
    });

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
            disconnect?.('storage');
          });
      },
      close: () => {
        this.#disconnects.delete(connectionId);
        this.#refreshers.delete(connectionId);
        queue = queue.then(leave);
      },
    };
  }

  /**
   * Board à rejoindre. Il a pu être déchargé pendant son attente (dernier participant
   * parti au même moment) : on le recharge alors, pour ne jamais rejoindre un board
   * qui n'est plus celui que les autres connexions utiliseront.
   */
  async #join(boardId: string): Promise<LoadedRoom> {
    for (;;) {
      const loaded = await this.#load(boardId);
      if (this.#loaded.get(boardId) === loaded && !loaded.broken) return loaded;
    }
  }

  /** Charge un board (une seule fois, même si plusieurs connexions le demandent). */
  #load(boardId: string): Promise<LoadedRoom> {
    let loading = this.#rooms.get(boardId);
    if (!loading) {
      const promise: Promise<LoadedRoom> = this.#store.load(boardId).then((stored) => {
        const loaded: LoadedRoom = {
          room: new BoardRoom(boardId, stored),
          participants: new Map<string, Participant>(),
          locks: new LockTable(this.#lockOptions),
          persistence: Promise.resolve(),
          nextGroup: undefined,
          broken: false,
          missing: stored === undefined,
        };
        if (this.#rooms.get(boardId) === promise) this.#loaded.set(boardId, loaded);
        return loaded;
      });
      loading = promise;
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
    this.#after(loaded, () =>
      this.#pubsub.publish(channel(boardId), { payload: { type: 'LOCKS', locked, unlocked } }),
    );
  }

  /**
   * Enregistre un commit après les précédents, puis appelle `then`.
   * Les commits arrivés pendant un enregistrement sont regroupés en une seule
   * transaction (group commit) : le débit ne dépend plus de la latence de la base.
   */
  #persist(boardId: string, loaded: LoadedRoom, commit: BoardCommit, then?: () => void): void {
    if (loaded.nextGroup) {
      loaded.nextGroup.push({ commit, then });
      return;
    }
    const group: CommitGroup = [{ commit, then }];
    loaded.nextGroup = group;
    loaded.persistence = loaded.persistence.then(async () => {
      if (loaded.nextGroup === group) loaded.nextGroup = undefined;
      if (loaded.broken) return;
      try {
        await this.#store.commit(boardId, mergeCommits(group.map(({ commit }) => commit)));
        for (const { then } of group) then?.();
      } catch (error) {
        this.#fail(boardId, loaded, error);
      }
    });
  }

  /** Exécute `action` après les enregistrements déjà demandés (ordre conservé). */
  #after(loaded: LoadedRoom, action: () => void | Promise<void>): void {
    // Les commits suivants ne doivent pas rejoindre un groupe qui partirait avant `action`.
    loaded.nextGroup = undefined;
    loaded.persistence = loaded.persistence.then(action);
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
    this.#unload(boardId, loaded);
    for (const connectionId of loaded.participants.keys()) {
      this.#disconnects.get(connectionId)?.('storage');
    }
  }

  /** Décharge un board sans participant une fois ses enregistrements terminés. */
  #evictIfEmpty(boardId: string, loaded: LoadedRoom): void {
    if (loaded.participants.size > 0) return;
    void loaded.persistence.then(() => {
      // Vérification synchrone : personne ne peut rejoindre entre le test et le déchargement.
      if (loaded.participants.size === 0) this.#unload(boardId, loaded);
    });
  }

  #unload(boardId: string, loaded: LoadedRoom): void {
    if (this.#loaded.get(boardId) !== loaded) return;
    this.#loaded.delete(boardId);
    this.#rooms.delete(boardId);
  }
}

function channel(boardId: string): string {
  return `board:${boardId}`;
}

/**
 * Couleur d'un participant : une couleur libre du board, choisie à partir de
 * l'utilisateur pour rester la même d'une session à l'autre quand c'est possible.
 */
export function pickColor(seed: string, used: ReadonlySet<string>): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const count = PARTICIPANT_COLORS.length;
  for (let i = 0; i < count; i++) {
    const color = PARTICIPANT_COLORS[(hash + i) % count] as string;
    if (!used.has(color)) return color;
  }
  return PARTICIPANT_COLORS[hash % count] as string;
}
