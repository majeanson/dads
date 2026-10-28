import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

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

export default defineConfig({
  plugins: [react(), tailwind()],
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
