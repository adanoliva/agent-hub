import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const RENDERER = path.resolve(__dirname, 'src/renderer');

export default defineConfig(({ command }) => ({
  root: RENDERER,
  base: command === 'serve' ? '/' : './',
  plugins: [react()],
  resolve: {
    alias: { '@': RENDERER },
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '^/api(?:/|$)': { target: 'http://localhost:3737', changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(RENDERER, 'index.html'),
    },
  },
}));
