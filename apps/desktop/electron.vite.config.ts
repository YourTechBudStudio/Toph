import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceAliases = {
  '@renderer': resolve(rootDir, 'src/renderer/src'),
  '@toph/desktop-contracts': resolve(rootDir, '../../packages/desktop-contracts/src/index.ts'),
  '@toph/desktop-ui': resolve(rootDir, '../../packages/desktop-ui/src/index.ts'),
};
const bundledWorkspacePackages = ['@toph/desktop-contracts', '@toph/desktop-ui'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    resolve: {
      alias: workspaceAliases,
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    resolve: {
      alias: workspaceAliases,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/preload/index.ts'),
          capture: resolve(rootDir, 'src/preload/capture.ts'),
        },
      },
    },
  },
  renderer: {
    // The renderer owns CSS compilation for @toph/desktop-ui, including its Tailwind entry stylesheet.
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: workspaceAliases,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/renderer/index.html'),
          overlay: resolve(rootDir, 'src/renderer/overlay.html'),
          capture: resolve(rootDir, 'src/renderer/capture.html'),
        },
      },
    },
  },
});
