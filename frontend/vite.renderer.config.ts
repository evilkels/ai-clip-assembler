// Standalone Vite config for running the renderer in a plain browser
// (useful when Electron cannot launch — e.g., in sandboxed CI envs).
// Use: `npm run dev:renderer` and open http://localhost:5174.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: { port: 5174 },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
});
