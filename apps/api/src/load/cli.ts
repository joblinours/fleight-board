import { parseArgs } from 'node:util';
import { type LoadReport, runLoad } from './load-test';

/**
 * Test de charge contre une API lancée (`pnpm dev` ou `./scripts/dev.sh`) :
 *   pnpm load --users 2,5,20,50 --duration 30
 * `--board <nom>` fait agir les utilisateurs simulés sur ce board, à regarder
 * (et utiliser) en même temps dans un navigateur.
 * Les clients simulés se connectent avec `--user`/`--password`, par défaut le
 * premier Admin de `apps/api/.env` (ADMIN_USERNAME / ADMIN_PASSWORD).
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:3000/ws' },
    users: { type: 'string', default: '2,5,20,50' },
    duration: { type: 'string', default: '30' },
    think: { type: 'string', default: '400' },
    disconnect: { type: 'string', default: '0.01' },
    board: { type: 'string' },
    user: { type: 'string', default: process.env.ADMIN_USERNAME },
    password: { type: 'string', default: process.env.ADMIN_PASSWORD },
  },
});

if (!values.user || !values.password) {
  console.error('Identifiants requis : --user et --password (ou ADMIN_USERNAME / ADMIN_PASSWORD).');
  process.exit(1);
}
const headers = { cookie: await login(values.url, values.user, values.password) };

const reports: LoadReport[] = [];
for (const users of values.users.split(',').map(Number)) {
  const boardId = values.board ?? `load-${users}-${Date.now()}`;
  console.log(`→ ${users} utilisateurs, ${values.duration} s, board « ${boardId} »…`);
  const report = await runLoad({
    url: values.url,
    boardId,
    users,
    durationMs: Number(values.duration) * 1000,
    thinkMs: Number(values.think),
    disconnectRate: Number(values.disconnect),
    seed: users,
    headers,
  });
  reports.push(report);
  console.log(`  ${report.converged ? 'convergé' : 'NON CONVERGÉ'} (${report.batches} lots)`);
}

console.log(
  [
    '',
    '| Utilisateurs | Lots/s | ACK p50 / p95 / p99 (ms) | Diffusion p50 / p95 / p99 (ms) | Refus (conflit / verrou) | Reconnexions | Convergence |',
    '|---|---|---|---|---|---|---|',
    ...reports
      .map((report) =>
        [
          report.users,
          report.batchesPerSecond,
          `${report.ack.p50} / ${report.ack.p95} / ${report.ack.p99}`,
          `${report.broadcast.p50} / ${report.broadcast.p95} / ${report.broadcast.p99}`,
          `${report.rejected.CONFLICT ?? 0} / ${report.rejected.LOCKED ?? 0}`,
          report.reconnections,
          report.converged ? `✅ ${report.convergenceMs} ms` : '❌',
        ].join(' | '),
      )
      .map((row) => `| ${row} |`),
  ].join('\n'),
);

process.exit(reports.every(({ converged }) => converged) ? 0 : 1);

/** Ouvre une session sur l'API ; retourne le cookie à présenter au WebSocket. */
async function login(wsUrl: string, identifier: string, password: string): Promise<string> {
  const url = new URL('/auth/login', wsUrl.replace(/^ws/, 'http'));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!response.ok) {
    console.error(`Connexion refusée (${response.status}) : ${await response.text()}`);
    process.exit(1);
  }
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Cookie de session absent');
  return cookie;
}
