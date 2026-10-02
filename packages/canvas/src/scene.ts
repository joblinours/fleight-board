import { type Bounds, containsPoint, expand, type Point } from './geometry';
import { SpatialIndex } from './spatial-index';

/**
 * Élément affichable. Le modèle d'objets complet (M0.4) étend ce contrat :
 * le moteur n'a besoin que d'un identifiant, d'une emprise et d'un ordre d'affichage.
 */
export type SceneItem = {
  id: string;
  /** Type d'élément, utilisé pour choisir la fonction de dessin. */
  kind: string;
  bounds: Bounds;
  /** Ordre d'affichage : les valeurs hautes sont dessinées au-dessus. */
  zIndex: number;
};

export type SceneListener = () => void;

/** Ensemble des éléments d'un document, indexés spatialement. */
export class Scene<T extends SceneItem = SceneItem> {
  readonly #items = new Map<string, T>();
  readonly #index = new SpatialIndex();
  readonly #listeners = new Set<SceneListener>();

  get size(): number {
    return this.#items.size;
  }

  get(id: string): T | undefined {
    return this.#items.get(id);
  }

  upsert(item: T): void {
    this.#items.set(item.id, item);
    this.#index.upsert(item.id, item.bounds);
    this.#notify();
  }

  remove(id: string): void {
    if (!this.#items.delete(id)) return;
    this.#index.remove(id);
    this.#notify();
  }

  /** Remplace tout le contenu de la scène. */
  load(items: Iterable<T>): void {
    this.#items.clear();
    for (const item of items) this.#items.set(item.id, item);
    this.#index.load(this.#items.values());
    this.#notify();
  }

  /** Éléments intersectant la zone, triés du dessous vers le dessus. */
  query(bounds: Bounds): T[] {
    const result: T[] = [];
    for (const id of this.#index.search(bounds)) {
      const item = this.#items.get(id);
      if (item) result.push(item);
    }
    return result.sort(byZIndex);
  }

  /**
   * Éléments sous un point, du dessus vers le dessous.
   * `tolerance` (unités monde) élargit la zone de capture, utile au doigt et au stylet.
   */
  hitTest(point: Point, tolerance = 0): T[] {
    const area = expand({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }, tolerance);
    return this.query(area)
      .filter((item) => containsPoint(expand(item.bounds, tolerance), point))
      .reverse();
  }

  /** Emprise de l'ensemble des éléments, ou `undefined` si la scène est vide. */
  contentBounds(): Bounds | undefined {
    let result: Bounds | undefined;
    for (const { bounds } of this.#items.values()) {
      result = result
        ? {
            minX: Math.min(result.minX, bounds.minX),
            minY: Math.min(result.minY, bounds.minY),
            maxX: Math.max(result.maxX, bounds.maxX),
            maxY: Math.max(result.maxY, bounds.maxY),
          }
        : { ...bounds };
    }
    return result;
  }

  /** Abonnement aux modifications ; retourne la fonction de désabonnement. */
  subscribe(listener: SceneListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

function byZIndex(a: SceneItem, b: SceneItem): number {
  return a.zIndex - b.zIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
