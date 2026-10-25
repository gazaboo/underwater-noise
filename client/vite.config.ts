import { defineConfig } from 'vite';

// En développement, Vite relaie vers le serveur local (npm run dev lance les deux).
const target = `http://localhost:${process.env.VACARME_PORT ?? 8787}`;

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/data': target,
      '/ws': { target, ws: true },
    },
  },
  // Prévisualisation du build web autonome : tout vient de dist-web, aucun relais vers le serveur Node.
  preview: { proxy: {} },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  // Web autonome : le worker des sources de navires importe des modules (shared/ships).
  worker: { format: 'es' },
});
