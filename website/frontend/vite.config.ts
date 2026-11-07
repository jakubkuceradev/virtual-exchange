import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vite';

// Same-origin routing for live mode: the browser calls /exchange/* (HTTP and the
// /exchange/ws WebSocket) and this dev/preview server forwards it to the exchange.
// EXCHANGE_URL is read here on the Node side and never compiled into the bundle.
const exchange = process.env.EXCHANGE_URL ?? 'http://127.0.0.1:8000';
const proxy: Record<string, ProxyOptions> = {
  '/exchange': {
    target: exchange,
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/exchange/, '') || '/',
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: { outDir: mode === 'mock' ? 'dist-mock' : 'dist' },
  server: { port: 5173, strictPort: true, proxy },
  preview: { strictPort: true, proxy },
}));
