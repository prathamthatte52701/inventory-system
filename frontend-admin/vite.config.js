import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Separate app, separate dev server: 5174 (the user app is 5173, the API is 5000).
// The proxy keeps the API same-origin in dev, so the httpOnly session cookie needs no CORS at all.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://localhost:5000' } },
  preview: { port: 5174, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/globalSetup.js'],
    fileParallelism: false, // all files share one backend + DB
    testTimeout: 30000,
    env: { VITE_API_URL: 'http://127.0.0.1:5056/api' },
  },
});
