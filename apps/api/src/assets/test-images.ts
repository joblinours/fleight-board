/** En-têtes d'images minimaux (suffisants pour la détection du type et des dimensions). */
export function pngHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  data.writeUInt32BE(0x89504e47, 0);
  data.writeUInt32BE(0x0d0a1a0a, 4);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

export function gifHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(32);
  data.write('GIF89a', 0, 'ascii');
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return data;
}

export function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([
    0xff,
    0xe0,
    0x00,
    0x10,
    ...Buffer.from('JFIF\0'),
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

export function webpHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(30);
  data.write('RIFF', 0, 'ascii');
  data.writeUInt32LE(22, 4);
  data.write('WEBP', 8, 'ascii');
  data.write('VP8X', 12, 'ascii');
  data.writeUInt32LE(10, 16);
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}
