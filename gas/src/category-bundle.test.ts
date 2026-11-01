import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

it('ships category validation to Apps Script without the browser filter tree', () => {
  const code = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { build } from 'esbuild';
    const result = await build({ entryPoints: ['gas/src/main.ts'], bundle: true, write: false, format: 'iife', platform: 'neutral', target: 'es2020' });
    process.stdout.write(result.outputFiles[0].text);
  `], { encoding: 'utf8' });
  expect(code.includes('banyo_wc')).toBe(true);
  expect(code.includes('mutfak_kahve')).toBe(true);
  expect(code.includes('group:mutfak'), 'UI-only category tree must not run on each Apps Script request').toBe(false);
  expect(code.includes('valuesByNode')).toBe(false);
});
