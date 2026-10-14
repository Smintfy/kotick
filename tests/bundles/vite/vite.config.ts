import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// check.mjs sets ENTRY to index.html or baseline.html, and gives each build its own --outDir.
export default defineConfig({
  plugins: [react()],
  build: { manifest: true, rollupOptions: { input: process.env.ENTRY ?? 'index.html' } },
});
