import { PROTOCOL_VERSION } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

const database = (up: boolean) => ({ ping: async () => up });

describe('healthchecks', () => {
  it('/health répond ok', async () => {
    const app = await buildApp({ database: database(false) });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', protocolVersion: PROTOCOL_VERSION });
  });

  it('/ready répond 200 quand la base est joignable', async () => {
    const app = await buildApp({ database: database(true) });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('/ready répond 503 quand la base est injoignable', async () => {
    const app = await buildApp({ database: database(false) });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('unavailable');
  });
});
