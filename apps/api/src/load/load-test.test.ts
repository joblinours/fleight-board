import { CollaborationHub } from '@fleight/collaboration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { connectDatabase, type Database } from '../database';
import { PostgresBoardStore } from '../db/board-store';
import { runLoad } from './load-test';

/**
 * M0.11 — clients headless sur le vrai WebSocket, en concurrence, puis vérification
 * de convergence. Avec TEST_DATABASE_URL, chaque lot est enregistré dans PostgreSQL.
 */
const url = process.env.TEST_DATABASE_URL;

describe('test de charge (WebSocket)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: Database | undefined;
  let wsUrl: string;

  beforeAll(async () => {
    if (url) {
      database = connectDatabase(url);
    }
    const db = database?.db;
    app = await buildApp({
      database: { ping: async () => true },
      createHub: (log) =>
        new CollaborationHub({ log, ...(db ? { store: new PostgresBoardStore(db) } : {}) }),
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    wsUrl = `${address.replace('http', 'ws')}/ws`;
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  for (const users of [2, 5, 20, 50]) {
    it(`${users} utilisateurs convergent`, { timeout: 60_000 }, async () => {
      const report = await runLoad({
        url: wsUrl,
        boardId: `load-${users}-${Date.now()}`,
        users,
        durationMs: 1500,
        thinkMs: 150,
        disconnectRate: 0.03,
        seed: users,
      });

      expect(report.converged).toBe(true);
      expect(report.batches).toBeGreaterThan(users);
      // En concurrence, seuls les conflits et les verrous sont des refus légitimes.
      expect(report.rejected.INVALID_OPERATION ?? 0).toBe(0);
      expect(report.rejected.NOT_JOINED ?? 0).toBe(0);
    });
  }
});
