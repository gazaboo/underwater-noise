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
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
