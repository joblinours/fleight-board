import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  build: {
    // Servi par l'API en production : `/assets/:id` y désigne les images importées.
    assetsDir: 'static',
  },
  server: {
    // Accessible depuis l'iPad sur le réseau local.
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: apiUrl,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': { target: apiUrl, ws: true },
    },
  },
});
