import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  root: 'src/renderer',
  // In dev: '/' so Vite's module server uses absolute paths.
  // In build: './' so packaged Electron can load assets from relative paths.
  base: command === 'serve' ? '/' : './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src/renderer') },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Allow all hosts — Electron's internal browser may use different host representations.
    allowedHosts: 'all',
    cors: true,
    proxy: {
      '/api': { target: 'http://localhost:3737', changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
}));
