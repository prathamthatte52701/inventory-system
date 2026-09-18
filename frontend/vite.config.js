import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:5000' } },
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
