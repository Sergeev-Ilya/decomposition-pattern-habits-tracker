import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.DEV_PROXY_TARGET || 'http://localhost:8880';
  // Only the local dev proxy rewrites Origin to the configured production origin.
  const proxy: ProxyOptions = { target, changeOrigin: true, configure(server) {
    server.on('proxyReq', (request) => request.setHeader('Origin', new URL(target).origin));
  } };
  return { plugins: [react(), tailwindcss()], server: { port: 5173, proxy: { '/api': proxy, '/health': proxy } } };
});
