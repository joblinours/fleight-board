export type Point = { x: number; y: number };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

/**
 * Caméra 2D : conversion entre coordonnées écran (pixels CSS) et monde (document).
 *
 * screen = (world - offset) * zoom
 */
export class Camera {
  offset: Point = { x: 0, y: 0 };
  zoom = 1;

  screenToWorld(point: Point): Point {
    return {
      x: point.x / this.zoom + this.offset.x,
      y: point.y / this.zoom + this.offset.y,
    };
  }

  worldToScreen(point: Point): Point {
    return {
      x: (point.x - this.offset.x) * this.zoom,
      y: (point.y - this.offset.y) * this.zoom,
    };
  }

  /** Déplace la vue d'un delta exprimé en pixels écran. */
  panBy(dx: number, dy: number): void {
    this.offset = {
      x: this.offset.x - dx / this.zoom,
      y: this.offset.y - dy / this.zoom,
    };
  }

  /** Zoome en gardant fixe le point du monde situé sous `anchor` (pixels écran). */
  zoomAt(anchor: Point, factor: number): void {
    const before = this.screenToWorld(anchor);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.offset = {
      x: before.x - anchor.x / this.zoom,
      y: before.y - anchor.y / this.zoom,
    };
  }
}
