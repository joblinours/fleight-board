import type { ImageSource } from '@fleight/canvas';

/**
 * Images des objets `image`, chargées depuis l'API à la première demande ;
 * `onLoad` est appelé à chaque image prête (pour redessiner le board).
 */
export function createImageCache(onLoad: () => void): ImageSource {
  const images = new Map<string, HTMLImageElement>();
  const ready = new Set<string>();
  return {
    get(assetId) {
      if (ready.has(assetId)) return images.get(assetId);
      if (!images.has(assetId)) {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
          ready.add(assetId);
          onLoad();
        };
        image.src = `/api/assets/${encodeURIComponent(assetId)}`;
        images.set(assetId, image);
      }
      return undefined;
    },
  };
}
