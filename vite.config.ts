import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'demo',
  // Dev server and every playwright tool (capture/showcase/lab) stay at '/'. Only the
  // GitHub Pages build sets CG_PAGES_BASE=/cracked-glass/ so assets resolve under the
  // repo subpath. Vite rewrites the entry HTML script srcs with this base automatically.
  base: process.env.CG_PAGES_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      'cracked-glass/react': fileURLToPath(new URL('./src/react/index.ts', import.meta.url)),
      'cracked-glass': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./demo/index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./demo/lab.html', import.meta.url)),
      },
    },
  },
});
