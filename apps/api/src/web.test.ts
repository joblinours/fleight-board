import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { stripApiPrefix } from './web';

describe('préfixe /api', () => {
  it('est retiré avant le routage', () => {
    expect(stripApiPrefix('/api/boards')).toBe('/boards');
    expect(stripApiPrefix('/api/boards?hidden=true')).toBe('/boards?hidden=true');
    expect(stripApiPrefix('/api?x=1')).toBe('/?x=1');
    expect(stripApiPrefix('/api')).toBe('/');
    expect(stripApiPrefix('/apiculture')).toBe('/apiculture');
    expect(stripApiPrefix('/static/index.js')).toBe('/static/index.js');
  });
});

describe('frontend servi par l’API', () => {
  const webDir = mkdtempSync(join(tmpdir(), 'fleight-web-'));
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Fleight Board</title>');
    mkdirSync(join(webDir, 'static'));
    writeFileSync(join(webDir, 'static', 'index-abc.js'), 'console.log(1)');
    app = await buildApp({ database: { ping: async () => true }, webDir });
  });
  afterAll(() => app.close());

  it('sert la page, sans cache', async () => {
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Fleight Board');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('met en cache les fichiers à empreinte', async () => {
    const response = await app.inject('/static/index-abc.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('garde l’API joignable, avec et sans /api', async () => {
    expect((await app.inject('/api/health')).json()).toMatchObject({ status: 'ok' });
    expect((await app.inject('/health')).json()).toMatchObject({ status: 'ok' });
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
  });

  it('répond 404 pour un fichier inconnu', async () => {
    expect((await app.inject('/inconnu.js')).statusCode).toBe(404);
  });

  it('refuse un répertoire sans index.html', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fleight-empty-'));
    await expect(buildApp({ database: { ping: async () => true }, webDir: empty })).rejects.toThrow(
      /Frontend introuvable/,
    );
  });
});
