import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env['VITE_API_TARGET'] ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/healthz': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the framework/runtime libraries in stable, cacheable vendor chunks and let each route
        // ship its own small chunk (routes are lazy-loaded in `app/router.tsx`).
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) {
            return null;
          }
          if (/node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'react';
          }
          if (id.includes('@tanstack')) {
            return 'query';
          }
          if (/node_modules[\\/]zod[\\/]/.test(id)) {
            return 'zod';
          }
          return null;
        },
      },
    },
  },
});
