import type { BoardDocument } from '@fleight/document';
import type { BoardObject, ServerSessionMessage } from '@fleight/protocol';
import { CollaborationClient } from './client';
import { CollaborationHub } from './hub';

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
  close(): void;
};

export function createNetwork(boardId = 'board') {
  const hub = new CollaborationHub();
  const clients: TestClient[] = [];

  function connect(name: string): TestClient {
    const toServer: string[] = [];
    const toClient: ServerSessionMessage[] = [];
    const scheduled: Array<() => void> = [];
    const connection = hub.open(name, (message) => toClient.push(message));
    const client = new CollaborationClient({
      boardId,
      name,
      schedule: (callback) => scheduled.push(callback),
    });
    client.connect({ send: (message) => toServer.push(message), close: () => {} });

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
      get outgoing() {
        return toServer.map((raw) => JSON.parse(raw));
      },
      close() {
        connection.close();
      },
    };
    clients.push(testClient);
    return testClient;
  }

  /** Livre tous les messages jusqu'à ce que le réseau soit vide. */
  function settle() {
    for (let round = 0; round < 20; round++) {
      for (const client of clients) {
        client.tick();
        client.upload();
      }
      for (const client of clients) client.download();
    }
  }

  function serverObjects(): BoardObject[] {
    return sorted([...(hub.room(boardId)?.document.all() ?? [])]);
  }

  return { hub, connect, settle, serverObjects };
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
