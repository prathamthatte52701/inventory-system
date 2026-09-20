import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 2000, strictPort: true, proxy: { '/api': 'http://localhost:4000' } },
  preview: { port: 2000, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/globalSetup.js'],
    fileParallelism: false, // all files share one backend + DB
    testTimeout: 30000,
    env: { VITE_API_URL: 'http://127.0.0.1:5055/api' },
  },
});
