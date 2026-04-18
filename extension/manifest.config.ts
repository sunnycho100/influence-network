import { defineManifest } from '@crxjs/vite-plugin';

import { EXTENSION_DEV_SERVER_PORT } from './dev-server-port';

export default defineManifest({
  manifest_version: 3,
  name: 'AlumniGraph',
  description: 'Personal LinkedIn graph scraper and visualizer.',
  version: '0.1.0',
  permissions: ['storage', 'scripting', 'activeTab', 'tabs', 'sidePanel'],
  host_permissions: [
    'https://www.linkedin.com/*',
    // Dev-only: allows the service worker to import HMR chunks from the Vite server (must match dev-server-port + vite server.port).
    `http://localhost:${EXTENSION_DEV_SERVER_PORT}/*`,
    `http://127.0.0.1:${EXTENSION_DEV_SERVER_PORT}/*`,
  ],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.linkedin.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {
    default_title: 'Open AlumniGraph',
  },
  externally_connectable: {
    matches: [
      'http://localhost:5173/*',
      'http://127.0.0.1:5173/*',
      'https://alumni-graph.vercel.app/*',
    ],
  },
});
