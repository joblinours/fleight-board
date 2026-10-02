import type { Bounds, Point } from './geometry';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;

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

  /** Zone du monde visible dans un viewport de `width` × `height` pixels CSS. */
  visibleBounds(width: number, height: number): Bounds {
    return {
      minX: this.offset.x,
      minY: this.offset.y,
      maxX: this.offset.x + width / this.zoom,
      maxY: this.offset.y + height / this.zoom,
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

  /** Cadre `bounds` au centre d'un viewport, avec une marge en pixels écran. */
  fitBounds(bounds: Bounds, width: number, height: number, padding = 32): void {
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const availableWidth = Math.max(width - padding * 2, 1);
    const availableHeight = Math.max(height - padding * 2, 1);
    const zoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.offset = {
      x: (bounds.minX + bounds.maxX) / 2 - width / 2 / this.zoom,
      y: (bounds.minY + bounds.maxY) / 2 - height / 2 / this.zoom,
    };
  }
}
