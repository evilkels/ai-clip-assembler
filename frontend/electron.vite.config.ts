import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const appVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
    server: {
      port: 5173,
      // Keep the dev renderer's imported brand assets on the same Vite
      // pipeline as production builds, limited to the shared assets folder.
      fs: { allow: [resolve(__dirname), resolve(__dirname, '../assets')] },
    },
  },
});
