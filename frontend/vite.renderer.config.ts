// Standalone Vite config for running the renderer in a plain browser
// (useful when Electron cannot launch — e.g., in sandboxed CI envs).
// Use: `npm run dev:renderer` and open http://localhost:5173.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    port: 5173,
    // The shared brand assets live in the repository assets directory so the
    // Electron packager and landing page can consume the same files. Allow
    // only that directory in Vite's renderer asset graph during development.
    fs: { allow: [resolve(__dirname), resolve(__dirname, '../assets')] },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
});
