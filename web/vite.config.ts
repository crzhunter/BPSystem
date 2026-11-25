import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bp-offline-shell',
      apply: 'build',
      generateBundle(_, bundle) {
        const assets = Object.keys(bundle)
          .filter((name) => /\.(js|css)$/.test(name))
          .map((name) => '/' + name);
        const art = readdirSync(new URL('./public/art/', import.meta.url)).map((name) => '/art/' + name);
        const shell = [
          '/',
          '/manifest.webmanifest',
          '/icon.svg',
          '/icon-192.png',
          '/icon-512.png',
          ...assets,
          ...art,
        ];
        const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
        const version = createHash('sha256').update(shell.join('|')).digest('hex').slice(0, 12);
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: template
            .replace('__BUILD_ID__', version)
            .replace('/*__SHELL_FILES__*/ []', JSON.stringify(shell)),
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:' + (process.env.PORT || '3001') },
  },
});
