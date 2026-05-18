import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { loadEnv } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const workspaceRootDir = resolve(rootDir, '../..');
const workspaceAliases = {
  '@renderer': resolve(rootDir, 'src/renderer/src'),
  '@toph/desktop-contracts': resolve(rootDir, '../../packages/desktop-contracts/src/index.ts'),
  '@toph/desktop-ui': resolve(rootDir, '../../packages/desktop-ui/src/index.ts'),
};
const bundledWorkspacePackages = ['@toph/desktop-contracts', '@toph/desktop-ui'];

function bakedAntigravityOAuthDefines() {
  const env = loadEnv('production', workspaceRootDir, '');
  const clientId =
    process.env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_ID ?? env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_SECRET;
  const shouldRequireLocalEnv = process.env.TOPH_BAKE_LOCAL_ENV === '1';

  if (!clientId || !clientSecret) {
    if (shouldRequireLocalEnv) {
      throw new Error(
        'TOPH_BAKE_LOCAL_ENV=1 requires TOPH_ANTIGRAVITY_OAUTH_CLIENT_ID and TOPH_ANTIGRAVITY_OAUTH_CLIENT_SECRET in the root .env file.',
      );
    }

    return {};
  }

  return {
    'process.env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_ID': JSON.stringify(clientId),
    'process.env.TOPH_ANTIGRAVITY_OAUTH_CLIENT_SECRET': JSON.stringify(clientSecret),
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    define: bakedAntigravityOAuthDefines(),
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
