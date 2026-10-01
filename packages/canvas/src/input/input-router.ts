import type { Point } from '../geometry';

export type PointerKind = 'mouse' | 'touch' | 'pen';

/**
 * Qui a le droit de dessiner :
 * - `auto` : la souris et le stylet dessinent ; le doigt dessine tant qu'aucun stylet
 *   n'a été détecté, puis il sert uniquement à naviguer (comportement Freeform) ;
 * - `pencil-only` : seul le stylet dessine, le doigt navigue ;
 * - `touch-drawing` : le doigt dessine aussi, même après détection d'un stylet.
 */
export type InputMode = 'auto' | 'pencil-only' | 'touch-drawing';

/** Échantillon d'un pointeur, en pixels CSS relatifs à l'élément. */
export type PointerSample = {
  x: number;
  y: number;
  /** Pression normalisée 0–1 (fiable uniquement pour le stylet). */
  pressure: number;
  /** Horodatage en millisecondes. */
  time: number;
};

export type PointerInput = {
  id: number;
  kind: PointerKind;
  phase: 'down' | 'move' | 'up' | 'cancel';
  /** Au moins un échantillon ; plusieurs pour un `move` avec événements fusionnés. */
  samples: readonly PointerSample[];
  /** Bouton de la souris au `down` (0 gauche, 1 milieu, 2 droit). */
  button?: number;
};

export type DrawingPointer = { id: number; kind: PointerKind };

export type InputHandlers = {
  drawStart(pointer: DrawingPointer, sample: PointerSample): void;
  drawMove(pointer: DrawingPointer, samples: readonly PointerSample[]): void;
  drawEnd(pointer: DrawingPointer): void;
  /** Le trait en cours doit être abandonné (paume détectée, pinch, annulation système). */
  drawCancel(pointer: DrawingPointer): void;
  /** Déplacement de la vue, en pixels écran. */
  pan(dx: number, dy: number): void;
  /** Zoom de facteur `factor` centré sur `anchor` (pixels écran). */
  zoom(anchor: Point, factor: number): void;
  /** Un contact a été ignoré comme paume. */
  palmRejected?(pointerId: number): void;
};

/** Durée pendant laquelle les contacts tactiles restent ignorés après le levé du stylet. */
export const PEN_COOLDOWN_MS = 500;

/**
 * Machine à états des entrées : transforme des pointeurs bruts (souris, doigts, stylet)
 * en gestes de dessin ou de navigation. Indépendante du DOM pour être testable.
 */
export class InputRouter {
  mode: InputMode;

  readonly #handlers: InputHandlers;
  #drawing: DrawingPointer | null = null;
  /** Pointeurs utilisés pour naviguer (doigts, bouton du milieu de la souris). */
  readonly #navigation = new Map<number, Point>();
  /** Pointeurs ignorés jusqu'à leur levé (paume, bouton droit…). */
  readonly #ignored = new Set<number>();
  /** Position courante des contacts tactiles qui dessinent (pour basculer en pinch). */
  readonly #touchPositions = new Map<number, Point>();
  #penDown = false;
  #penReleasedAt = Number.NEGATIVE_INFINITY;
  #penSeen = false;

  constructor(handlers: InputHandlers, mode: InputMode = 'auto') {
    this.#handlers = handlers;
    this.mode = mode;
  }

  /** Un stylet a déjà été utilisé sur cette page. */
  get penDetected(): boolean {
    return this.#penSeen;
  }

  get isDrawing(): boolean {
    return this.#drawing !== null;
  }

  handle(input: PointerInput): void {
    switch (input.phase) {
      case 'down':
        this.#down(input);
        break;
      case 'move':
        this.#move(input);
        break;
      case 'up':
      case 'cancel':
        this.#release(input);
        break;
    }
  }

  /** Abandonne tout geste en cours (perte de focus, changement d'outil…). */
  reset(): void {
    if (this.#drawing) this.#handlers.drawCancel(this.#drawing);
    this.#drawing = null;
    this.#navigation.clear();
    this.#ignored.clear();
    this.#touchPositions.clear();
    this.#penDown = false;
  }

  #down(input: PointerInput): void {
    const sample = last(input.samples);

    if (input.kind === 'pen') {
      this.#penSeen = true;
      this.#penDown = true;
      // La paume a pu toucher l'écran avant la pointe : on annule le trait tactile
      // et on ignore les doigts posés.
      if (this.#drawing?.kind === 'touch') this.#cancelDrawing();
      for (const id of this.#navigation.keys()) this.#ignored.add(id);
      this.#navigation.clear();
      this.#touchPositions.clear();
      if (this.#drawing) {
        this.#ignored.add(input.id);
        return;
      }
      this.#startDrawing(input, sample);
      return;
    }

    if (input.kind === 'touch') {
      if (this.#penIsActive(sample.time)) {
        this.#ignored.add(input.id);
        this.#handlers.palmRejected?.(input.id);
        return;
      }

      // Second doigt pendant un trait au doigt : c'était le début d'un pinch.
      if (this.#drawing?.kind === 'touch') {
        const firstId = this.#drawing.id;
        const firstPosition = this.#touchPositions.get(firstId);
        this.#cancelDrawing();
        if (firstPosition) this.#navigation.set(firstId, firstPosition);
        this.#navigation.set(input.id, sample);
        return;
      }

      if (this.#touchDraws() && !this.#drawing && this.#navigation.size === 0) {
        this.#touchPositions.set(input.id, sample);
        this.#startDrawing(input, sample);
        return;
      }

      this.#navigation.set(input.id, sample);
      return;
    }

    // Souris : gauche dessine, milieu navigue, le reste est ignoré.
    if (input.button === 1) {
      this.#navigation.set(input.id, sample);
    } else if (input.button === 0 || input.button === undefined) {
      if (this.#drawing) this.#ignored.add(input.id);
      else this.#startDrawing(input, sample);
    } else {
      this.#ignored.add(input.id);
    }
  }

  #move(input: PointerInput): void {
    if (this.#ignored.has(input.id)) return;

    if (this.#drawing?.id === input.id) {
      if (input.kind === 'touch') this.#touchPositions.set(input.id, last(input.samples));
      this.#handlers.drawMove(this.#drawing, input.samples);
      return;
    }

    if (this.#navigation.has(input.id)) this.#navigate(input.id, last(input.samples));
    // Sinon : survol (souris, stylet en hover) — rien à faire.
  }

  #release(input: PointerInput): void {
    if (input.kind === 'pen') {
      this.#penDown = false;
      this.#penReleasedAt = last(input.samples).time;
    }
    this.#touchPositions.delete(input.id);

    if (this.#ignored.delete(input.id)) return;

    if (this.#drawing?.id === input.id) {
      const drawing = this.#drawing;
      this.#drawing = null;
      // L'échantillon du levé n'est pas ajouté : sa pression vaut souvent 0.
      if (input.phase === 'up') this.#handlers.drawEnd(drawing);
      else this.#handlers.drawCancel(drawing);
      return;
    }

    this.#navigation.delete(input.id);
  }

  #navigate(id: number, position: Point): void {
    const before = this.#gesture();
    this.#navigation.set(id, { x: position.x, y: position.y });
    const after = this.#gesture();
    if (!before || !after) return;

    this.#handlers.pan(after.center.x - before.center.x, after.center.y - before.center.y);
    if (before.distance > 0 && after.distance > 0 && after.distance !== before.distance) {
      this.#handlers.zoom(after.center, after.distance / before.distance);
    }
  }

  /** Centre et écartement des deux premiers pointeurs de navigation. */
  #gesture(): { center: Point; distance: number } | undefined {
    const [a, b] = this.#navigation.values();
    if (!a) return undefined;
    if (!b) return { center: { x: a.x, y: a.y }, distance: 0 };
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  #startDrawing(input: PointerInput, sample: PointerSample): void {
    this.#drawing = { id: input.id, kind: input.kind };
    this.#handlers.drawStart(this.#drawing, sample);
  }

  #cancelDrawing(): void {
    if (!this.#drawing) return;
    const drawing = this.#drawing;
    this.#drawing = null;
    this.#handlers.drawCancel(drawing);
  }

  #penIsActive(time: number): boolean {
    return this.#penDown || time - this.#penReleasedAt < PEN_COOLDOWN_MS;
  }

  #touchDraws(): boolean {
    switch (this.mode) {
      case 'touch-drawing':
        return true;
      case 'pencil-only':
        return false;
      case 'auto':
        return !this.#penSeen;
    }
  }
}

function last<T>(items: readonly T[]): T {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error('PointerInput sans échantillon');
  return item;
}
