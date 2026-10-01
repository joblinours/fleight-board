import { createId } from '@fleight/shared';
import { type StrokeItem, type StrokeStyle, strokeBounds } from './stroke';

/**
 * Construit un trait point par point pendant le dessin.
 * Chaque appel à `item()` retourne un nouvel objet (le cache de rendu se base sur l'identité).
 */
export class StrokeBuilder {
  readonly id = createId();
  readonly #style: StrokeStyle;
  readonly #zIndex: number;
  /** Distance minimale entre deux points, en unités monde. */
  readonly #minDistance: number;
  readonly #points: number[] = [];

  constructor(style: StrokeStyle, zIndex: number, minDistance: number) {
    this.#style = style;
    this.#zIndex = zIndex;
    this.#minDistance = minDistance;
  }

  get pointCount(): number {
    return this.#points.length / 3;
  }

  /** Ajoute un point ; retourne `false` s'il est trop proche du précédent. */
  add(x: number, y: number, pressure: number): boolean {
    const length = this.#points.length;
    if (length >= 3) {
      const dx = x - (this.#points[length - 3] ?? 0);
      const dy = y - (this.#points[length - 2] ?? 0);
      if (dx * dx + dy * dy < this.#minDistance * this.#minDistance) return false;
    }
    this.#points.push(round(x), round(y), round(pressure));
    return true;
  }

  item(complete = false): StrokeItem {
    const points = [...this.#points];
    return {
      id: this.id,
      kind: 'stroke',
      zIndex: this.#zIndex,
      bounds: strokeBounds(points, this.#style.size),
      points,
      complete,
      ...this.#style,
    };
  }
}

/** Arrondi à 1/100 : réduit la taille des données sans perte visible. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
