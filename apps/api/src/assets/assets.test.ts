import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@fleight/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { AuthService } from '../auth/auth-service';
import { hashPassword } from '../auth/passwords';
import { SESSION_COOKIE } from '../auth/routes';
import { BoardService } from '../boards/board-service';
import { connectDatabase, type Database } from '../database';
import { users } from '../db/schema';
import { AssetService } from './asset-service';
import { FilesystemBlobStorage } from './blob-storage';
import { pngHeader } from './test-images';

/** Tests sur un vrai PostgreSQL, ignorés sans TEST_DATABASE_URL (voir board-store.test.ts). */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('images importées', () => {
  let database: Database;
  let root: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookies: Record<string, string>;
  let boardId: string;

  beforeAll(async () => {
    database = connectDatabase(url as string);
    root = await mkdtemp(join(tmpdir(), 'fleight-blobs-'));
    app = await buildApp({
      database: { ping: async () => true },
      auth: new AuthService(database.db),
      boards: new BoardService(database.db),
      assets: new AssetService(database.db, new FilesystemBlobStorage(root)),
      maxUploadBytes: 1024,
    });
    await app.ready();
    const username = `images-${createId().slice(-10).toLowerCase()}`;
    await database.db.insert(users).values({
      id: createId(),
      username,
      displayName: 'Images',
      passwordHash: await hashPassword('mot-de-passe-images'),
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: username, password: 'mot-de-passe-images' },
    });
    cookies = { [SESSION_COOKIE]: login.cookies[0]?.value as string };
    const board = await app.inject({
      method: 'POST',
      url: '/boards',
      cookies,
      payload: { name: 'Avec images' },
    });
    boardId = board.json().board.id;
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
    await rm(root, { recursive: true, force: true });
  });

  const upload = (data: Buffer, contentType = 'image/png', board = boardId) =>
    app.inject({
      method: 'POST',
      url: `/boards/${board}/assets`,
      cookies,
      headers: { 'content-type': contentType },
      payload: data,
    });

  it('importe une image, en lit le type et les dimensions, puis la sert', async () => {
    const image = pngHeader(640, 480);
    const response = await upload(image, 'application/octet-stream');
    expect(response.statusCode).toBe(201);
    const asset = response.json().asset;
    expect(asset).toMatchObject({ mimeType: 'image/png', width: 640, height: 480, size: 33 });

    const served = await app.inject({ method: 'GET', url: `/assets/${asset.id}`, cookies });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(image)).toBe(true);
    expect(served.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    });
    expect((await app.inject({ method: 'GET', url: `/assets/${asset.id}` })).statusCode).toBe(401);
  });

  it('ne stocke qu’une fois un contenu importé plusieurs fois', async () => {
    const image = pngHeader(12, 34);
    const first = (await upload(image)).json().asset;
    const second = (await upload(image)).json().asset;
    expect(first.id).not.toBe(second.id);
    const prefixes = await readdir(root);
    const files = (await Promise.all(prefixes.map((prefix) => readdir(join(root, prefix))))).flat();
    expect(new Set(files).size).toBe(files.length);
  });

  it('refuse un SVG, un fichier trop volumineux, un board inexistant, un anonyme', async () => {
    const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png');
    expect(svg.statusCode).toBe(415);
    expect(svg.json().error).toBe('UNSUPPORTED_IMAGE');

    const large = await upload(Buffer.concat([pngHeader(10, 10), Buffer.alloc(2048)]));
    expect(large.statusCode).toBe(413);

    expect((await upload(pngHeader(10, 10), 'image/png', `absent-${createId()}`)).statusCode).toBe(
      404,
    );
    const anonymous = await app.inject({
      method: 'POST',
      url: `/boards/${boardId}/assets`,
      headers: { 'content-type': 'image/png' },
      payload: pngHeader(10, 10),
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
