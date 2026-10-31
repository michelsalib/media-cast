import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // remote.html is the phone remote, served on the LAN by RemoteServer.
        input: {
          index: resolve('src/renderer/index.html'),
          remote: resolve('src/renderer/remote.html'),
        },
      },
    },
  },
});
