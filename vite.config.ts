import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

/** The commit this bundle was built from, for the label in Settings. */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

// /version.json: the commit this bundle was built from, so DevHub can tell
// whether production serves the last deploy. A 'post' hook, and the last
// plugin, so it runs after anything that lists the bundle (a service
// worker's precache): the file must never be served from a cache.
function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler() {
        let sha = process.env.GITHUB_SHA ?? '';
        if (!sha) {
          try {
            sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
          } catch {
            sha = 'unknown';
          }
        }
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ sha, builtAt: new Date().toISOString() }),
        });
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), versionJson()],
  define: { __BUILD__: JSON.stringify(commit()) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // `npm run dev` (wrangler, :8787) serves the API and websockets;
    // `npm run dev:web` (vite, :5173) serves the client with HMR against it.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
});
