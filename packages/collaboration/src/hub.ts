import {
  type ClientSessionMessage,
  ClientSessionMessageSchema,
  type Participant,
  type ServerSessionMessage,
} from '@fleight/protocol';
import { BoardRoom } from './board-room';
import { InMemoryPubSub, type PubSub, type Unsubscribe } from './pubsub';

/** Message diffusé aux connexions d'un board ; `exclude` ne le reçoit pas. */
type Broadcast = { payload: ServerSessionMessage; exclude?: string };

export type HubConnection = {
  /** Message de session déjà décodé (JSON) reçu de la connexion. */
  receive(data: unknown): void;
  close(): void;
};

export type HubLogger = {
  warn(details: Record<string, unknown>, message: string): void;
};

/**
 * Gestion des sessions collaboratives, indépendante du transport :
 * chaque connexion rejoint un board, envoie des lots d'opérations,
 * reçoit accusés de réception et opérations des autres.
 */
export class CollaborationHub {
  readonly #rooms = new Map<string, BoardRoom>();
  readonly #participants = new Map<string, Map<string, Participant>>();
  readonly #pubsub: PubSub<Broadcast>;
  readonly #log: HubLogger | undefined;

  constructor(options: { pubsub?: PubSub<Broadcast>; log?: HubLogger } = {}) {
    this.#pubsub = options.pubsub ?? new InMemoryPubSub<Broadcast>();
    this.#log = options.log;
  }

  /** Nombre de boards chargés en mémoire. */
  get roomCount(): number {
    return this.#rooms.size;
  }

  room(boardId: string): BoardRoom | undefined {
    return this.#rooms.get(boardId);
  }

  open(connectionId: string, send: (message: ServerSessionMessage) => void): HubConnection {
    let boardId: string | undefined;
    let unsubscribe: Unsubscribe | undefined;

    const leave = () => {
      if (!boardId) return;
      unsubscribe?.();
      unsubscribe = undefined;
      this.#participants.get(boardId)?.delete(connectionId);
      void this.#pubsub.publish(channel(boardId), {
        payload: { type: 'PARTICIPANT_LEFT', connectionId },
        exclude: connectionId,
      });
      boardId = undefined;
    };

    const handle = (message: ClientSessionMessage) => {
      switch (message.type) {
        case 'JOIN': {
          leave();
          boardId = message.boardId;
          const room = this.#room(boardId);
          const participants = this.#participantsOf(boardId);
          const participant = { connectionId, name: message.name };
          participants.set(connectionId, participant);
          unsubscribe = this.#pubsub.subscribe(channel(boardId), ({ payload, exclude }) => {
            if (exclude !== connectionId) send(payload);
          });
          send({
            type: 'JOINED',
            snapshot: room.snapshot(),
            participants: [...participants.values()],
          });
          void this.#pubsub.publish(channel(boardId), {
            payload: { type: 'PARTICIPANT_JOINED', participant },
            exclude: connectionId,
          });
          break;
        }
        case 'LEAVE':
          leave();
          break;
        case 'SYNC_REQUEST':
          if (boardId) send({ type: 'SNAPSHOT', snapshot: this.#room(boardId).snapshot() });
          break;
        case 'OPS': {
          if (!boardId) {
            send({
              type: 'REJECT',
              batchId: message.batchId,
              code: 'NOT_JOINED',
              message: 'Aucun board rejoint',
            });
            return;
          }
          const result = this.#room(boardId).apply(message.operations);
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
            },
            exclude: connectionId,
          });
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
        handle(parsed.data);
      },
      close: leave,
    };
  }

  #room(boardId: string): BoardRoom {
    let room = this.#rooms.get(boardId);
    if (!room) {
      room = new BoardRoom(boardId);
      this.#rooms.set(boardId, room);
    }
    return room;
  }

  #participantsOf(boardId: string): Map<string, Participant> {
    let participants = this.#participants.get(boardId);
    if (!participants) {
      participants = new Map();
      this.#participants.set(boardId, participants);
    }
    return participants;
  }
}

function channel(boardId: string): string {
  return `board:${boardId}`;
}
