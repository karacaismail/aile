// Depo politikası: kod, test ve fixture dosyalarında aileye özgü veri ve emoji bulunmaz (public repo).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from this file, not from the process working directory.
const root = resolve(__dirname, '..');
const ROOTS = ['src', 'e2e', 'shared', 'gas', 'seed/templates', 'scripts', 'admin.html', 'fixtures'];
const EXT = /\.(ts|tsx|js|mjs|json|css|md|html)$/;
// Politika tanımlayan kapılar (bu dosya ve dist gizlilik denetimi) yasaklı desenleri adıyla içerir; taranmaz.
const SKIP = /node_modules|__screenshots__|policy\.test\.ts$|check-dist-privacy(?:\.test)?\.mjs$/;

// Kök bir klasör ya da tek dosya olabilir; yoksa sessizce atlanır.
function walk(path: string, out: string[] = []): string[] {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat || SKIP.test(path)) return out;
  if (stat.isFile()) { if (EXT.test(path)) out.push(path); return out; }
  for (const name of readdirSync(path)) walk(join(path, name), out);
  return out;
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['emoji', /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
  ['gebelik/hamile', /\b(gebe|gebelik|hamile)\b/iu],
  ['taşınma tarihi sabiti', /2027-02-19/],
  ['çocuk adı', /(^|[^\p{L}])İnci(?![\p{L}])/u],
  ['eş adı', /(^|[^\p{L}])Gül(?![\p{L}])/u],
  ['kasa-work yolu', /kasa[-_]work/i],
];

describe('depo politikası', () => {
  const files = ROOTS.flatMap((r) => walk(join(root, r)));
  it('taranan dosya var', () => { expect(files.length).toBeGreaterThan(10); });
  for (const [label, re] of FORBIDDEN) {
    it(`yasaklı içerik yok: ${label}`, () => {
      const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
      expect(hits, `${label} şu dosyalarda geçiyor`).toEqual([]);
    });
  }
});

// Kapsam: tek dosya kökleri (admin.html) ve sentetik nesil fixture'ı da taranır; kasa-work özel klasör yolu hiçbir yerde geçmez.
describe('politika tarama kapsamı', () => {
  it('walk tek dosya yolunu da kabul eder', () => {
    expect(walk(join(root, 'admin.html'))).toEqual([join(root, 'admin.html')]);
  });
  it('admin.html ve fixtures/generation-synthetic taranır', () => {
    const files = ROOTS.flatMap((r) => walk(join(root, r)));
    expect(files).toContain(join(root, 'admin.html'));
    expect(files.filter((f) => f.includes('/fixtures/generation-synthetic/') && f.endsWith('.json')).length).toBeGreaterThan(0);
    expect(files.filter((f) => /check-dist-privacy/.test(f))).toEqual([]);
  });
  it('kasa-work yolu yasaklı desen olarak tanımlı ve örneği yakalar', () => {
    const rule = FORBIDDEN.find(([label]) => label === 'kasa-work yolu');
    expect(rule).toBeDefined();
    expect(rule![1].test('/Users/kisi/kasa-work/generations/abc')).toBe(true);
    expect(rule![1].test('KASA_WORK=1')).toBe(true);
    expect(rule![1].test('workbench kasası')).toBe(false);
  });
});
