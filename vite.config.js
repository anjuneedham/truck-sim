import { defineConfig } from 'vite';

// Relative base so the build works from any static host / file wrapper (e.g. Capacitor later).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
});
