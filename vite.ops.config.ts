import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// `import.meta.dirname` rather than `__dirname`: this config is loaded as an ES
// module and Vite warns on the CJS global.
const here = import.meta.dirname;

// The ops console. A separate app from the renter SPA - different auth surface,
// different deploy cadence - and it must never end up inside the renter bundle,
// which is what a separate root and outDir guarantee rather than promise.
export default defineConfig({
  root: path.resolve(here, 'ops'),
  publicDir: false,
  build: {
    outDir: path.resolve(here, 'dist-ops'),
    emptyOutDir: true,
  },
  server: { port: 5174 },
  plugins: [react()],
});
