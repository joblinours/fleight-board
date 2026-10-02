import { PROTOCOL_VERSION } from '@fleight/protocol';
import { isId } from '@fleight/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { buildApp } from './app';
import { CloseCode } from './websocket';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function connect(): Promise<WebSocket> {
  app = await buildApp({ database: { ping: async () => true } });
  await app.ready();
  return app.injectWS('/ws');
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

describe('handshake WebSocket', () => {
  it('accepte un client à la bonne version', async () => {
    const socket = await connect();
    const reply = nextMessage(socket);

    socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: PROTOCOL_VERSION }));

    const message = await reply;
    expect(message.type).toBe('HELLO');
    expect(message.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(isId(String(message.connectionId))).toBe(true);
    socket.terminate();
  });

  it('refuse une version de protocole différente', async () => {
    const socket = await connect();
    const reply = nextMessage(socket);
    const closed = closeCode(socket);

    socket.send(JSON.stringify({ type: 'HELLO', protocolVersion: PROTOCOL_VERSION + 1 }));

    expect((await reply).code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    expect(await closed).toBe(CloseCode.UnsupportedProtocolVersion);
  });

  it('refuse un message qui n’est pas du JSON', async () => {
    const socket = await connect();
    const reply = nextMessage(socket);
    const closed = closeCode(socket);

    socket.send('pas du json');

    expect((await reply).code).toBe('INVALID_MESSAGE');
    expect(await closed).toBe(CloseCode.InvalidMessage);
  });
});

describe('session collaborative', () => {
  type Message = Record<string, unknown>;

  /** Client de test : mémorise les messages reçus et permet d'attendre un type donné. */
  function collector(socket: WebSocket) {
    const received: Message[] = [];
    const waiters: Array<{ type: string; resolve: (message: Message) => void }> = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Message;
      const index = waiters.findIndex(({ type }) => type === message.type);
      if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
      else received.push(message);
    });
    return {
      next(type: string): Promise<Message> {
        const index = received.findIndex((message) => message.type === type);
        if (index >= 0) return Promise.resolve(received.splice(index, 1)[0] as Message);
        return new Promise((resolve) => waiters.push({ type, resolve }));
      },
      send: (message: Message) => socket.send(JSON.stringify(message)),
    };
  }

  async function join(current: App, name: string) {
    const socket = await current.injectWS('/ws');
    const client = collector(socket);
    client.send({ type: 'HELLO', protocolVersion: PROTOCOL_VERSION });
    await client.next('HELLO');
    client.send({ type: 'JOIN', boardId: 'demo', name, clientId: name });
    const joined = await client.next('JOINED');
    return { socket, client, joined };
  }

  const rectangle = {
    type: 'rectangle',
    id: 'r1',
    zIndex: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: 'Firewall',
  };

  it('diffuse les opérations d’un participant aux autres', async () => {
    app = await buildApp({ database: { ping: async () => true } });
    await app.ready();
    const alice = await join(app, 'Alice');
    const bob = await join(app, 'Bob');

    expect(await alice.client.next('PARTICIPANT_JOINED')).toMatchObject({
      participant: { name: 'Bob' },
    });

    alice.client.send({
      type: 'OPS',
      batchId: 'b1',
      baseSeq: 0,
      operations: [{ kind: 'create', object: rectangle }],
    });

    expect(await alice.client.next('ACK')).toMatchObject({
      batchId: 'b1',
      seq: 1,
      versions: { r1: 1 },
    });
    expect(await bob.client.next('OPS')).toMatchObject({
      seq: 1,
      operations: [{ kind: 'create', object: rectangle }],
    });

    // Un nouveau participant reçoit l'état courant.
    const carol = await join(app, 'Carol');
    expect(carol.joined).toMatchObject({ snapshot: { seq: 1, objects: [rectangle] } });
    expect((carol.joined.participants as unknown[]).length).toBe(3);

    for (const { socket } of [alice, bob, carol]) socket.terminate();
  });

  it('refuse un lot invalide sans modifier le board', async () => {
    app = await buildApp({ database: { ping: async () => true } });
    await app.ready();
    const alice = await join(app, 'Alice');

    alice.client.send({
      type: 'OPS',
      batchId: 'b2',
      baseSeq: 0,
      operations: [{ kind: 'update', id: 'absent', patch: { x: 1 } }],
    });

    expect(await alice.client.next('REJECT')).toMatchObject({
      batchId: 'b2',
      code: 'INVALID_OPERATION',
    });
    alice.socket.terminate();
  });
});
