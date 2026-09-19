import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate app, separate dev server: 5174 (the user app is 5173, the API is 5000).
// The proxy keeps the API same-origin in dev, so the httpOnly session cookie needs no CORS at all.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://localhost:5000' } },
  preview: { port: 5174, strictPort: true },
});
