import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Every process needs its key, even empty, or it isn't built. main and preload
// externalize their dependencies by default (build.externalizeDeps).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rolldownOptions: {
        // remote.html is the phone remote, served on the LAN by RemoteServer.
        input: {
          index: resolve('src/renderer/index.html'),
          remote: resolve('src/renderer/remote.html'),
        },
      },
    },
  },
});
