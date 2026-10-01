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
