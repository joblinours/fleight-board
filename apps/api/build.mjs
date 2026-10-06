// Bundle de production de l'API : un seul fichier `dist/server.js`.
// Les packages internes (@fleight/*) sont consommés en TypeScript : ils sont
// intégrés au bundle, comme les dépendances npm. Seul Argon2 (module natif,
// binaire propre à la plateforme) reste externe et est copié dans l'image.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'linked',
  external: [
    '@node-rs/argon2',
    // Accélérateurs facultatifs de `ws`, chargés seulement s'ils sont installés.
    'bufferutil',
    'utf-8-validate',
  ],
  // Les dépendances CommonJS appellent `require` : on le fournit au bundle ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
