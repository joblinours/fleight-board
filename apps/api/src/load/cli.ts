import { parseArgs } from 'node:util';
import { type LoadReport, runLoad } from './load-test';

/**
 * Test de charge contre une API lancée (`pnpm dev` ou `./scripts/dev.sh`) :
 *   pnpm load --users 2,5,20,50 --duration 30
 * `--board <nom>` fait agir les utilisateurs simulés sur ce board, à regarder
 * (et utiliser) en même temps dans un navigateur.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:3000/ws' },
    users: { type: 'string', default: '2,5,20,50' },
    duration: { type: 'string', default: '30' },
    think: { type: 'string', default: '400' },
    disconnect: { type: 'string', default: '0.01' },
    board: { type: 'string' },
  },
});

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
