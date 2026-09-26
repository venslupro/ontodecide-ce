/**
 * @fileoverview Vite build for the OntoDecide CE cockpit SPA (Cloudflare
 * Pages project `ontodecide-ce`). Pages are lazily imported per route, so
 * each route becomes its own chunk; heavy libraries get stable chunks.
 */

import {readFileSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {version: string};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {'@': fileURLToPath(new URL('./src', import.meta.url))},
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {target: 'http://127.0.0.1:8787', changeOrigin: true, ws: true},
    },
  },
  worker: {format: 'es'},
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    reportCompressedSize: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {name: 'echarts', test: /node_modules[\\/](echarts|zrender)[\\/]/},
            {
              name: 'cytoscape',
              test: /node_modules[\\/](cytoscape|cytoscape-fcose|cose-base|layout-base)[\\/]/,
            },
            {name: 'xlsx', test: /node_modules[\\/]xlsx[\\/]/},
          ],
        },
      },
    },
  },
});
