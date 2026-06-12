import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'demo',
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
  },
});
