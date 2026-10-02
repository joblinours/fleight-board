import type { ImageMimeType } from '@fleight/protocol';

export type ImageInfo = { mimeType: ImageMimeType; width: number; height: number };

/**
 * Type réel et dimensions d'une image, lus dans son en-tête : le type déclaré
 * par le client n'est pas cru sur parole. `undefined` : format non reconnu.
 */
export function readImageInfo(data: Buffer): ImageInfo | undefined {
  if (data.length < 24) return undefined;
  // PNG : signature, puis largeur et hauteur dans le bloc IHDR.
  if (data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) {
    return { mimeType: 'image/png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  // GIF87a / GIF89a : dimensions en petit-boutiste après la signature.
  if (data.toString('ascii', 0, 4) === 'GIF8') {
    return { mimeType: 'image/gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  // WebP : conteneur RIFF, puis l'un des trois formats.
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return readWebp(data);
  }
  // JPEG : on parcourt les segments jusqu'à un marqueur SOF (début de l'image).
  if (data[0] === 0xff && data[1] === 0xd8) return readJpeg(data);
  return undefined;
}

function readWebp(data: Buffer): ImageInfo | undefined {
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && data.length >= 30) {
    return {
      mimeType: 'image/webp',
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ' && data.length >= 30) {
    return {
      mimeType: 'image/webp',
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return {
      mimeType: 'image/webp',
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  return undefined;
}

function readJpeg(data: Buffer): ImageInfo | undefined {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return undefined;
    const marker = data[offset + 1] ?? 0;
    // Marqueurs sans longueur (remplissage, RST).
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    // SOF0 à SOF15, sauf DHT (C4), JPG (C8) et DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        mimeType: 'image/jpeg',
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return undefined;
}
