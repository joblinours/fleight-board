import { describe, expect, it } from 'vitest';
import { readImageInfo } from './image-info';
import { gifHeader, jpegHeader, pngHeader, webpHeader } from './test-images';

describe('readImageInfo', () => {
  it('reconnaît PNG, GIF, JPEG et WebP et lit leurs dimensions', () => {
    expect(readImageInfo(pngHeader(640, 480))).toEqual({
      mimeType: 'image/png',
      width: 640,
      height: 480,
    });
    expect(readImageInfo(gifHeader(32, 16))).toEqual({
      mimeType: 'image/gif',
      width: 32,
      height: 16,
    });
    expect(readImageInfo(jpegHeader(1920, 1080))).toEqual({
      mimeType: 'image/jpeg',
      width: 1920,
      height: 1080,
    });
    expect(readImageInfo(webpHeader(300, 200))).toEqual({
      mimeType: 'image/webp',
      width: 300,
      height: 200,
    });
  });

  it('refuse ce qui n’est pas une image reconnue (SVG, texte, fichier tronqué)', () => {
    expect(
      readImageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
    ).toBeUndefined();
    expect(readImageInfo(Buffer.from('bonjour, je ne suis pas une image'))).toBeUndefined();
    expect(readImageInfo(pngHeader(10, 10).subarray(0, 12))).toBeUndefined();
  });
});
