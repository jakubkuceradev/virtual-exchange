import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vite';

// Same-origin routing for live mode: the browser calls /exchange/* (HTTP and the
// /exchange/ws WebSocket) and this dev/preview server forwards it to the exchange;
// /website/* goes to the website backend (competition standings).
// EXCHANGE_URL and WEBSITE_BACKEND_URL are read here on the Node side and never
// compiled into the bundle.
const exchange = process.env.EXCHANGE_URL ?? 'http://127.0.0.1:8000';
const website = process.env.WEBSITE_BACKEND_URL ?? 'http://127.0.0.1:8001';
const proxy: Record<string, ProxyOptions> = {
  '/exchange': {
    target: exchange,
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/exchange/, '') || '/',
  },
  '/website': {
    target: website,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/website/, '') || '/',
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: { outDir: mode === 'mock' ? 'dist-mock' : 'dist' },
  server: { port: 5173, strictPort: true, proxy },
  preview: { strictPort: true, proxy },
}));
