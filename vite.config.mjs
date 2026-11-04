import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => ({
  root: resolve(projectRoot, 'src'),
  input: resolve(projectRoot, 'src/vaughanator.html'),
  base: './',
  plugins: command === 'serve' ? [{
      name: 'dev-csp-websocket',
      transformIndexHtml(html) {
        return html.replace('connect-src https:', 'connect-src https: ws://127.0.0.1:*');
      },
    }] : [],
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
  build: {
    outDir: resolve(projectRoot, 'web-dist'),
    emptyOutDir: true,
  },
}));
