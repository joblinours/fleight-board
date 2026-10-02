import { UndoHistory } from '@fleight/document';
import type { BoardObject, Operation } from '@fleight/protocol';
import type { CollaborationClient } from './client';

/** Une étape d'action ; les étapes d'un geste sont espacées d'une trame (~33 ms). */
export type SimulationStep = () => void;

/** Répartition des actions d'un utilisateur simulé (probabilités cumulées). */
const ACTIONS: Array<[number, keyof SimulatedUserActions]> = [
  [0.35, 'drag'],
  [0.5, 'stroke'],
  [0.62, 'rename'],
  [0.72, 'create'],
  [0.79, 'remove'],
  [0.92, 'undo'],
  [1, 'redo'],
];

type SimulatedUserActions = Record<
  'drag' | 'stroke' | 'rename' | 'create' | 'remove' | 'undo' | 'redo',
  () => SimulationStep[]
>;

/**
 * Utilisateur simulé : produit des actions réalistes (déplacements verrouillés en
 * plusieurs trames, tracés, renommages, créations, suppressions, annulations)
 * à travers un `CollaborationClient`, avec son historique individuel.
 * Utilisé par les tests de convergence et par le test de charge.
 */
export class SimulatedUser {
  readonly client: CollaborationClient;
  readonly history = new UndoHistory();
  readonly #random: () => number;
  readonly #prefix: string;
  #counter = 0;
  /** Nombre d'actions lancées, par type. */
  readonly counts: Record<keyof SimulatedUserActions, number> = {
    drag: 0,
    stroke: 0,
    rename: 0,
    create: 0,
    remove: 0,
    undo: 0,
    redo: 0,
  };

  /** `prefix` rend les identifiants créés uniques et reproductibles d'une exécution à l'autre. */
  constructor(client: CollaborationClient, random: () => number, prefix: string) {
    this.client = client;
    this.#random = random;
    this.#prefix = prefix;
  }

  /** Étapes de la prochaine action, à exécuter dans l'ordre. */
  nextAction(): SimulationStep[] {
    const roll = this.#random();
    const kind = ACTIONS.find(([threshold]) => roll < threshold)?.[1] ?? 'create';
    this.counts[kind] += 1;
    return this.#actions[kind]();
  }

  readonly #actions: SimulatedUserActions = {
    drag: () => {
      const target = this.#pick((object) => object.type !== 'connector');
      if (!target || target.type === 'connector') return [];
      const id = target.id;
      const gesture = this.#id();
      const frames = 3 + Math.floor(this.#random() * 6);
      const dx = Math.round((this.#random() - 0.5) * 40);
      const dy = Math.round((this.#random() - 0.5) * 40);
      const steps: SimulationStep[] = [() => this.client.lock([id])];
      for (let frame = 0; frame < frames; frame++) {
        steps.push(() => {
          const current = this.client.document.get(id);
          if (!current || current.type === 'connector') return;
          this.#apply(
            [{ kind: 'update', id, patch: { x: current.x + dx, y: current.y + dy } }],
            gesture,
          );
        });
      }
      steps.push(() => this.#end(gesture, [id]));
      return steps;
    },

    stroke: () => {
      const id = this.#id();
      const gesture = this.#id();
      const points: number[] = [0, 0, 0.5];
      const steps: SimulationStep[] = [
        () =>
          this.#apply(
            [
              {
                kind: 'create',
                object: stroke(id, this.#coordinate(), this.#coordinate(), points),
              },
            ],
            gesture,
          ),
      ];
      const frames = 2 + Math.floor(this.#random() * 6);
      for (let frame = 1; frame <= frames; frame++) {
        steps.push(() => {
          if (!this.client.document.get(id) || this.client.lockedByOther(id)) return;
          points.push(frame * 6, Math.round(this.#random() * 20), 0.5);
          this.#apply(
            [{ kind: 'update', id, patch: { points: [...points], width: frame * 6 } }],
            gesture,
          );
        });
      }
      steps.push(() => this.#end(gesture, []));
      return steps;
    },

    rename: () => {
      const target = this.#pick((object) => object.type === 'rectangle');
      if (!target) return [];
      return [
        () => {
          if (!this.client.document.get(target.id)) return;
          this.#apply([
            {
              kind: 'update',
              id: target.id,
              patch: { label: `L${Math.floor(this.#random() * 1e6)}` },
            },
          ]);
        },
      ];
    },

    create: () => [
      () =>
        this.#apply([
          { kind: 'create', object: rectangle(this.#id(), this.#coordinate(), this.#coordinate()) },
        ]),
    ],

    remove: () => {
      const target = this.#pick(() => true);
      if (!target) return [];
      return [
        () => {
          if (!this.client.document.get(target.id)) return;
          this.#apply([{ kind: 'delete', id: target.id }]);
        },
      ];
    },

    undo: () => [
      () =>
        this.history.undo(
          this.client.document,
          (operations) => this.client.applyLocal(operations, undefined, 'undo'),
          { blocked: (id) => this.client.lockedByOther(id) !== undefined },
        ),
    ],

    redo: () => [
      () =>
        this.history.redo(
          this.client.document,
          (operations) => this.client.applyLocal(operations, undefined, 'redo'),
          { blocked: (id) => this.client.lockedByOther(id) !== undefined },
        ),
    ],
  };

  /** Applique une action locale en la mémorisant pour l'annulation. */
  #apply(operations: Operation[], gesture?: string): void {
    this.history.track(
      this.client.document,
      operations,
      () => this.client.applyLocal(operations, gesture ? { id: gesture, final: false } : undefined),
      gesture,
    );
  }

  #end(gesture: string, locked: string[]): void {
    this.client.endGesture(gesture);
    this.history.endGroup(gesture);
    if (locked.length) this.client.unlock(locked);
  }

  /** Objet au hasard, libre (pas verrouillé par un autre participant). */
  #pick(filter: (object: BoardObject) => boolean): BoardObject | undefined {
    const candidates = [...this.client.document.all()].filter(
      (object) => filter(object) && this.client.lockedByOther(object.id) === undefined,
    );
    return candidates[Math.floor(this.#random() * candidates.length)];
  }

  #id(): string {
    this.#counter += 1;
    return `${this.#prefix}-${this.#counter}`;
  }

  #coordinate(): number {
    return Math.round(this.#random() * 2000);
  }
}

function rectangle(id: string, x: number, y: number): BoardObject {
  return {
    type: 'rectangle',
    id,
    zIndex: 0,
    x,
    y,
    width: 120,
    height: 60,
    fill: '#ffffff',
    stroke: '#1f2937',
    strokeWidth: 2,
    label: '',
  };
}

function stroke(id: string, x: number, y: number, points: number[]): BoardObject {
  return {
    type: 'stroke',
    id,
    zIndex: 1,
    x,
    y,
    width: 1,
    height: 20,
    points: [...points],
    color: '#2563eb',
    size: 3,
    opacity: 1,
    simulatePressure: false,
  };
}
