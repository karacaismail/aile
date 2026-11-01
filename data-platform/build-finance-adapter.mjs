import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Reuse the existing producer/consumer contract; this is a CLI dependency, never a browser entry.
const result = await build({
 stdin: { contents: "export { decodeFinanceWire } from './src/finance/wire.ts'; export { buildFinance } from './src/finance/data.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
 bundle: true, platform: 'node', target: 'node22.12', format: 'esm', write: false,
 plugins: [{ name: 'offline-finance-bindings', setup(builder) {
  builder.onResolve({ filter: /^\.\.\/dashboard\/data$/ }, args => args.importer.endsWith('/src/finance/data.ts') ? { path: 'offline-sheet', namespace: 'offline-finance' } : null);
  builder.onLoad({ filter: /.*/, namespace: 'offline-finance' }, () => ({ contents: "export const sheetId=''; export const sheetUrl=''; export function parseTable(){throw new Error('Network parsing is unavailable in the offline validator')}" }));
 } }],
});
const output = '// Generated from the existing finance validators. Run node data-platform/build-finance-adapter.mjs.\n' + result.outputFiles[0].text;
const destination = new URL('./generated-finance-wire.mjs', import.meta.url);
if (process.argv.includes('--check')) {
 if (await readFile(destination, 'utf8') !== output) throw new Error('Finance adapter is stale; rebuild it.');
} else await writeFile(destination, output);
