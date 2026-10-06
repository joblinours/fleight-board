import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Préfixe sous lequel le frontend appelle l'API (comme le proxy de Vite en développement). */
export const API_PREFIX = '/api';

/**
 * URL vue par les routes : en production, le frontend appelle l'API sous `/api`,
 * comme en développement derrière Vite ; le préfixe est retiré avant le routage.
 */
export function stripApiPrefix(url: string): string {
  if (url === API_PREFIX || url.startsWith(`${API_PREFIX}?`)) {
    return `/${url.slice(API_PREFIX.length)}`;
  }
  return url.startsWith(`${API_PREFIX}/`) ? url.slice(API_PREFIX.length) : url;
}

/**
 * Sert le frontend construit (`apps/web/dist`) : une seule origine pour les pages,
 * l'API et le WebSocket, donc ni CORS ni configuration du navigateur.
 * Les fichiers à empreinte (`/static/…`) sont mis en cache un an ; `index.html` jamais.
 */
export async function registerWeb(app: FastifyInstance, dir: string): Promise<void> {
  const webDir = resolve(dir);
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(`Frontend introuvable : ${join(webDir, 'index.html')}`);
  }
  await app.register(fastifyStatic, {
    root: webDir,
    // Une route par fichier, enregistrée au démarrage : aucune ne masque une route de l'API.
    wildcard: false,
    cacheControl: false,
    setHeaders(response, path) {
      response.header(
        'cache-control',
        path.startsWith(join(webDir, 'static'))
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });
}
