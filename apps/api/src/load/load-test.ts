import {
  CollaborationClient,
  createRandom,
  SimulatedUser,
  type SimulationStep,
} from '@fleight/collaboration';
import type { BoardObject, RejectMessage } from '@fleight/protocol';
import WebSocket from 'ws';

export type LoadOptions = {
  /** URL du WebSocket de l'API (ws://hôte:port/ws). */
  url: string;
  boardId: string;
  users: number;
  /** Durée de l'activité, en ms. */
  durationMs: number;
  /** Pause moyenne entre deux actions d'un utilisateur, en ms. */
  thinkMs?: number;
  /** Probabilité, par action, que l'utilisateur perde sa connexion. */
  disconnectRate?: number;
  seed?: number;
  /** Délai maximal de convergence après l'activité, en ms. */
  convergenceTimeoutMs?: number;
  /** En-têtes de la connexion WebSocket (cookie de session). */
  headers?: Record<string, string>;
};

export type Percentiles = { count: number; p50: number; p95: number; p99: number; max: number };

export type LoadReport = {
  users: number;
  durationMs: number;
  /** Lots envoyés et accusés reçus. */
  batches: number;
  /** Lots confirmés par seconde (tous utilisateurs). */
  batchesPerSecond: number;
  /** Envoi d'un lot → accusé de réception. */
  ack: Percentiles;
  /** Envoi d'un lot → réception par chacun des autres participants. */
  broadcast: Percentiles;
  /** Lots refusés, par code (conflits et verrous attendus en concurrence). */
  rejected: Partial<Record<RejectMessage['code'], number>>;
  reconnections: number;
  actions: Record<string, number>;
  /** Tous les clients ont l'état du serveur, sans attente ni verrou résiduel. */
  converged: boolean;
  /** Clients dont l'état diffère de celui du serveur. */
  divergent: number;
  /** Temps entre la fin de l'activité et la convergence, en ms. */
  convergenceMs: number;
  objects: number;
  seq: number;
};

/** Mesures partagées entre les connexions (même processus, même horloge). */
type Probe = {
  sentAt: Map<string, number>;
  seqSentAt: Map<number, number>;
  ack: number[];
  receipts: Array<{ seq: number; at: number }>;
};

type LoadClient = {
  client: CollaborationClient;
  user: SimulatedUser;
  stop(): void;
};

/**
 * Test de charge : `users` clients headless rejoignent un board à travers le vrai
 * WebSocket de l'API et agissent en même temps (utilisateurs simulés), puis on
 * vérifie que tous convergent vers l'état du serveur.
 */
export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const {
    url,
    boardId,
    users,
    durationMs,
    thinkMs = 400,
    disconnectRate = 0,
    seed = 1,
    convergenceTimeoutMs = 20_000,
    headers = {},
  } = options;
  const random = createRandom(seed);
  const probe: Probe = { sentAt: new Map(), seqSentAt: new Map(), ack: [], receipts: [] };
  const rejected: LoadReport['rejected'] = {};
  let reconnections = 0;

  const clients: LoadClient[] = [];
  for (let index = 0; index < users; index++) {
    clients.push(
      openClient(url, headers, boardId, `load-${index}`, createRandom(random() * 2 ** 32), probe, {
        onRejected: (code, count) => {
          rejected[code] = (rejected[code] ?? 0) + count;
        },
        onReconnect: () => {
          reconnections += 1;
        },
      }),
    );
  }
  await waitFor(() => clients.every(({ client }) => client.status === 'joined'), 10_000);

  // Contenu de départ : quelques objets à déplacer, renommer, supprimer.
  const first = clients[0];
  if (first && first.client.document.size === 0) {
    first.client.applyLocal(
      Array.from({ length: 20 }, (_, index) => ({
        kind: 'create' as const,
        object: rectangle(
          `${boardId}-seed-${index}`,
          (index % 5) * 200,
          Math.floor(index / 5) * 120,
        ),
      })),
    );
  }
  await waitFor(() => clients.every(({ client }) => client.document.size >= 20), 10_000);

  // Activité : chaque utilisateur enchaîne ses actions, un geste à ~30 Hz.
  const start = Date.now();
  const end = start + durationMs;
  await Promise.all(
    clients.map(async ({ client, user }, index) => {
      const own = createRandom(seed * 7919 + index);
      await sleep(own() * thinkMs);
      while (Date.now() < end) {
        if (client.status === 'joined' && own() < disconnectRate) client.disconnect();
        const steps: SimulationStep[] = user.nextAction();
        for (const step of steps) {
          step();
          await sleep(33);
        }
        await sleep(thinkMs * (0.5 + own()));
      }
    }),
  );
  const activityEnd = Date.now();

  // Convergence : plus rien en attente, plus de verrou tenu par un client simulé
  // (un humain peut observer le board en même temps), même séquence partout.
  const settled = () => {
    const simulated = new Set(clients.map(({ client }) => client.connectionId));
    return (
      clients.every(
        ({ client }) =>
          client.status === 'joined' &&
          client.pendingCount === 0 &&
          [...client.locks.values()].every((holder) => !simulated.has(holder)),
      ) && new Set(clients.map(({ client }) => client.seq)).size === 1
    );
  };
  await waitFor(settled, convergenceTimeoutMs).catch(() => undefined);
  const convergenceMs = Date.now() - activityEnd;

  // État du serveur, vu par un nouveau participant.
  const observer = openClient(url, headers, boardId, 'observateur', random, undefined, {});
  await waitFor(() => observer.client.status === 'joined', 10_000);
  const server = serialize(observer.client.document.all());
  const divergent = clients.filter(({ client }) => serialize(client.document.all()) !== server);
  const converged = settled() && divergent.length === 0;
  const seq = observer.client.seq;
  const objects = observer.client.document.size;
  observer.stop();
  for (const { stop } of clients) stop();

  const broadcast: number[] = [];
  for (const { seq: receivedSeq, at } of probe.receipts) {
    const sentAt = probe.seqSentAt.get(receivedSeq);
    if (sentAt !== undefined) broadcast.push(at - sentAt);
  }
  const actions: Record<string, number> = {};
  for (const { user } of clients) {
    for (const [kind, count] of Object.entries(user.counts)) {
      actions[kind] = (actions[kind] ?? 0) + count;
    }
  }

  return {
    users,
    durationMs,
    batches: probe.ack.length,
    batchesPerSecond: Math.round((probe.ack.length / (activityEnd - start)) * 1000),
    ack: percentiles(probe.ack),
    broadcast: percentiles(broadcast),
    rejected,
    reconnections,
    actions,
    converged,
    divergent: divergent.length,
    convergenceMs: converged ? convergenceMs : Number.NaN,
    objects,
    seq,
  };
}

function openClient(
  url: string,
  headers: Record<string, string>,
  boardId: string,
  name: string,
  random: () => number,
  probe: Probe | undefined,
  events: {
    onRejected?: (code: RejectMessage['code'], count: number) => void;
    onReconnect?: () => void;
  },
): LoadClient {
  const client = new CollaborationClient({
    boardId,
    name,
    ...(events.onRejected ? { onRejected: events.onRejected } : {}),
  });
  let stopped = false;
  let opened = 0;

  const open = () => {
    if (stopped) return;
    const socket = new WebSocket(url, { headers });
    socket.on('open', () => {
      if (opened++ > 0) events.onReconnect?.();
      client.connect({
        send: (message) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (probe && message.startsWith('{"type":"OPS"')) {
            const { batchId } = JSON.parse(message) as { batchId: string };
            probe.sentAt.set(batchId, performance.now());
          }
          socket.send(message);
        },
        close: () => socket.close(),
      });
    });
    socket.on('message', (data) => {
      const raw = data.toString();
      if (probe) record(probe, raw);
      client.handleMessage(raw);
    });
    socket.on('close', () => {
      client.handleClose();
      setTimeout(open, 200);
    });
    socket.on('error', () => {});
  };
  open();

  return {
    client,
    user: new SimulatedUser(client, random, name),
    stop: () => {
      stopped = true;
      client.disconnect();
    },
  };
}

function record(probe: Probe, raw: string): void {
  const now = performance.now();
  if (raw.startsWith('{"type":"ACK"')) {
    const { batchId, seq, duplicate } = JSON.parse(raw) as {
      batchId: string;
      seq: number;
      duplicate?: boolean;
    };
    const sentAt = probe.sentAt.get(batchId);
    if (sentAt === undefined || duplicate) return;
    probe.ack.push(now - sentAt);
    probe.seqSentAt.set(seq, sentAt);
  } else if (raw.startsWith('{"type":"OPS"')) {
    const { seq } = JSON.parse(raw) as { seq: number };
    probe.receipts.push({ seq, at: now });
  }
}

export function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: round(sorted.at(-1) ?? 0),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function serialize(objects: Iterable<BoardObject>): string {
  return JSON.stringify([...objects].sort((a, b) => a.id.localeCompare(b.id)));
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Délai dépassé');
    await sleep(20);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rectangle(id: string, x: number, y: number): BoardObject {
  return {
    type: 'rectangle',
    id,
    zIndex: 0,
    x,
    y,
    width: 160,
    height: 80,
    fill: '#ffffff',
    stroke: '#1f2937',
    strokeWidth: 2,
    label: '',
  };
}
