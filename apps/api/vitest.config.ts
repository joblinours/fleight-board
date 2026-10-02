import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Migrations appliquées une seule fois, avant les fichiers de test qui tournent en parallèle.
    globalSetup: ['./src/test-global-setup.ts'],
  },
});
