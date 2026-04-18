import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

import { EXTENSION_DEV_SERVER_PORT } from './dev-server-port';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  // Vite 6+ tightened dev CORS / WebSocket; crxjs loads SW chunks from localhost (see crxjs#971).
  server: {
    port: EXTENSION_DEV_SERVER_PORT,
    strictPort: true,
    cors: true,
  },
  legacy: {
    skipWebSocketTokenCheck: true,
  },
  resolve: {
    alias: [
      {
        find: '@alumni-graph/shared',
        replacement: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      },
      {
        find: /^@alumni-graph\/shared\/(.*)$/,
        replacement: fileURLToPath(new URL('../shared/src/$1.ts', import.meta.url)),
      },
    ],
  },
});
