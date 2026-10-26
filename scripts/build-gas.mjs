// gas/src/main.ts → apps-script/Code.js (tek dosya, Apps Script V8 uyumlu).
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('apps-script', { recursive: true });
await build({
  entryPoints: ['gas/src/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__aile',
  platform: 'neutral',
  target: ['es2020'],
  outfile: 'apps-script/Code.js',
  legalComments: 'none',
  banner: { js: '// Otomatik üretildi: pnpm gas:build — elle düzenlemeyin.' },
  footer: {
    js: [
      'function doGet(e) { return __aile.doGet(e); }',
      'function doPost(e) { return __aile.doPost(e); }',
      'function setup() { return __aile.setup(); }',
      'function onEditInstallable(e) { return __aile.onEditInstallable(e); }',
      'function health() { return JSON.stringify(__aile.healthCheck()); }',
    ].join('\n'),
  },
});
writeFileSync('apps-script/.gasbuild', new Date().toISOString());
console.log('apps-script/Code.js üretildi');
