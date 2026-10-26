// Depo politikası: kod, test ve fixture dosyalarında aileye özgü veri ve emoji bulunmaz (public repo).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'e2e', 'shared', 'gas', 'seed/templates', 'scripts'];
const EXT = /\.(ts|tsx|js|mjs|json|css|md)$/;
const SKIP = /node_modules|__screenshots__|policy\.test\.ts$/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['emoji', /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
  ['gebelik/hamile', /\b(gebe|gebelik|hamile)\b/iu],
  ['taşınma tarihi sabiti', /2027-02-19/],
  ['çocuk adı', /(^|[^\p{L}])İnci(?![\p{L}])/u],
  ['eş adı', /(^|[^\p{L}])Gül(?![\p{L}])/u],
];

describe('depo politikası', () => {
  const files = ROOTS.flatMap((r) => walk(r));
  it('taranan dosya var', () => { expect(files.length).toBeGreaterThan(10); });
  for (const [label, re] of FORBIDDEN) {
    it(`yasaklı içerik yok: ${label}`, () => {
      const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
      expect(hits, `${label} şu dosyalarda geçiyor`).toEqual([]);
    });
  }
});
