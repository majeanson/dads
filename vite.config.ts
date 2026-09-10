import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwind()],
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
