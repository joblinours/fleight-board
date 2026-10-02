import type { BoardDocument } from '@fleight/document';
import type { BoardObject, ServerSessionMessage } from '@fleight/protocol';
import { CollaborationClient } from './client';
import { CollaborationHub } from './hub';
import { type BoardStore, MemoryBoardStore } from './store';

/**
 * Réseau simulé : les messages restent en file jusqu'à ce que le test les livre,
 * ce qui permet de reproduire n'importe quel ordre d'arrivée.
 */
export type TestClient = {
  name: string;
  client: CollaborationClient;
  document: BoardDocument;
  upload(): void;
  download(): void;
  tick(): void;
  readonly outgoing: Array<Record<string, unknown>>;
  /** Messages du serveur pas encore livrés au client. */
  readonly received: ServerSessionMessage[];
  /** Événements remontés par le client (rejets, verrous refusés). */
  events: Array<{ type: string; detail: unknown }>;
  close(): void;
  /** Coupure réseau : la connexion tombe, les messages en transit sont perdus. */
  goOffline(): void;
  /** Rétablissement : nouvelle connexion WebSocket, même client. */
  goOnline(): void;
};

/** Laisse le serveur traiter les messages reçus (traitement asynchrone). */
export async function drain(hub: CollaborationHub): Promise<void> {
  // Le stockage en mémoire ne fait que des micro-tâches : inutile d'attendre un tour d'horloge.
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 50; j++) await Promise.resolve();
    await hub.flush();
  }
}

export function createNetwork<Store extends BoardStore = MemoryBoardStore>(
  boardId = 'board',
  store: Store = new MemoryBoardStore() as unknown as Store,
  hubOptions: { lockTtlMs?: number; now?: () => number } = {},
) {
  const hub = new CollaborationHub({ store, ...hubOptions });
  const clients: TestClient[] = [];

  function connect(name: string): TestClient {
    const toServer: string[] = [];
    const toClient: ServerSessionMessage[] = [];
    const scheduled: Array<() => void> = [];
    let connections = 1;
    let online = true;
    let connection = hub.open(name, (message) => {
      if (online) toClient.push(message);
    });
    const events: Array<{ type: string; detail: unknown }> = [];
    const client = new CollaborationClient({
      boardId,
      name,
      clientId: name,
      schedule: (callback) => scheduled.push(callback),
      onRejected: (code) => events.push({ type: 'rejected', detail: code }),
      onLockDenied: (ids, holder) => events.push({ type: 'lockDenied', detail: { ids, holder } }),
    });
    client.connect({
      send: (message) => {
        if (online) toServer.push(message);
      },
      close: () => {},
    });

    const testClient: TestClient = {
      name,
      client,
      document: client.document,
      /** Livre au serveur les messages envoyés par ce client. */
      upload() {
        for (const raw of toServer.splice(0)) {
          const message = JSON.parse(raw);
          if (message.type !== 'HELLO') connection.receive(message);
        }
      },
      /** Livre au client les messages du serveur. */
      download() {
        for (const message of toClient.splice(0)) client.handleMessage(JSON.stringify(message));
      },
      /** Déclenche les envois différés (regroupement à ~30 Hz). */
      tick() {
        for (const callback of scheduled.splice(0)) callback();
      },
      events,
      get received() {
        return [...toClient];
      },
      get outgoing() {
        return toServer.map((raw) => JSON.parse(raw));
      },
      close() {
        connection.close();
      },
      goOffline() {
        online = false;
        toServer.length = 0;
        toClient.length = 0;
        connection.close();
        client.handleClose();
      },
      goOnline() {
        online = true;
        connections += 1;
        const current = hub.open(`${name}#${connections}`, (message) => {
          if (online && connection === current) toClient.push(message);
        });
        connection = current;
        client.connect({
          send: (message) => {
            if (online) toServer.push(message);
          },
          close: () => {},
        });
      },
    };
    clients.push(testClient);
    return testClient;
  }

  /** Livre tous les messages jusqu'à ce que le réseau soit vide. */
  async function settle() {
    for (let round = 0; round < 10; round++) {
      for (const client of clients) {
        client.tick();
        client.upload();
      }
      await drain(hub);
      for (const client of clients) client.download();
    }
  }

  async function serverObjects(): Promise<BoardObject[]> {
    return sorted([...((await hub.room(boardId))?.document.all() ?? [])]);
  }

  return { hub, store, connect, settle, serverObjects, drain: () => drain(hub) };
}

export function sorted(objects: BoardObject[]): BoardObject[] {
  return [...objects].sort((a, b) => a.id.localeCompare(b.id));
}

export function rect(id: string, x = 0, y = 0): BoardObject {
  return {
    type: 'rectangle',
    id,
    zIndex: 0,
    x,
    y,
    width: 100,
    height: 50,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  };
}
