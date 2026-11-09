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
  // Kök paket geliştirme sunucusunda tüm ikon kataloğunu çalıştırır; ikon değerleri tek ikon alt yolundan gelir.
  it('Phosphor kök paketinden değer içe aktarılmaz', () => {
    const rootBarrel = /^\s*(?:import|export)\s+(?!type\b)[^'"]*from\s+['"]@phosphor-icons\/react['"]/m;
    const hits = files.filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && rootBarrel.test(readFileSync(f, 'utf8')));
    expect(hits, 'kök paketten değer alan dosyalar').toEqual([]);
  });
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

// Emeklilik profili (docs/EMEKLILIK-PLANI.md): kişisel profil (doğum tarihi, gün sayıları, kazanç, borç) Git'e girmez.
// Depodaki emeklilik profili biçimli her JSON 'sentetik: true' taşır ve yalnız fixtures/emeklilik/ altında durur; gerçek
// profil Git dışındaki AILE_EMEKLILIK_PROFILE dosyasıdır. Biçim: surum + profilin ayırt edici alanlarından en az ikisi.
const PROFIL_ALANLARI = ['dogumTarihi', 'ilkSigortaGirisi', 'kayitliGun', 'sgkReferansAylik', 'secenekler', 'kazanc'];
const SENTETIK_PROFIL = join(root, 'fixtures', 'emeklilik', 'profil-sentetik.json');
// Depo kökünden taranırken atlanan üretilmiş ya da dış klasörler.
const DEPO_DISI = new Set(['node_modules', '.git', 'dist', 'dist-ssr', 'coverage', 'test-results', 'playwright-report', '.tmp-shots', '.tmp-live']);

function emeklilikProfiliBicimli(veri: unknown): boolean {
  if (veri === null || typeof veri !== 'object' || Array.isArray(veri)) return false;
  const anahtarlar = new Set(Object.keys(veri));
  return anahtarlar.has('surum') && PROFIL_ALANLARI.filter((alan) => anahtarlar.has(alan)).length >= 2;
}

function depoJsonDosyalari(klasor: string, out: string[] = []): string[] {
  for (const girdi of readdirSync(klasor, { withFileTypes: true })) {
    if (DEPO_DISI.has(girdi.name)) continue;
    const tam = join(klasor, girdi.name);
    if (girdi.isDirectory()) depoJsonDosyalari(tam, out);
    else if (girdi.isFile() && girdi.name.endsWith('.json')) out.push(tam);
  }
  return out;
}

function jsonOku(dosya: string): unknown {
  try {
    return JSON.parse(readFileSync(dosya, 'utf8'));
  } catch {
    return null;
  }
}

describe('emeklilik profili gizliliği', () => {
  it('sentetik fikstür sentetik: true taşır ve kaynakları gerçek kişiye ait olmadığını söyler', () => {
    const profil = jsonOku(SENTETIK_PROFIL) as { sentetik?: unknown; kaynaklar?: unknown } | null;
    expect(emeklilikProfiliBicimli(profil)).toBe(true);
    expect(profil?.sentetik).toBe(true);
    expect(Array.isArray(profil?.kaynaklar)).toBe(true);
    expect((profil!.kaynaklar as string[]).join(' ')).toMatch(/sentetik/i);
  });

  it('depoda sentetik dışı emeklilik profili JSON dosyası yok (yalnız fixtures/emeklilik/ altında, sentetik: true)', () => {
    const dosyalar = depoJsonDosyalari(root);
    expect(dosyalar).toContain(SENTETIK_PROFIL);
    const profiller = dosyalar.filter((dosya) => emeklilikProfiliBicimli(jsonOku(dosya)));
    expect(profiller).toContain(SENTETIK_PROFIL);
    const ihlaller = profiller.filter((dosya) => {
      const profil = jsonOku(dosya) as { sentetik?: unknown };
      return profil.sentetik !== true || !dosya.startsWith(join(root, 'fixtures', 'emeklilik') + '/');
    });
    expect(ihlaller.map((dosya) => dosya.slice(root.length + 1)), 'sentetik olmayan ya da yeri yanlış emeklilik profili').toEqual([]);
  });

  it('profil biçimi tanıyıcısı: sentetik profil ve kopyası tanınır; nesil manifesti ve paket dosyası tanınmaz', () => {
    const profil = jsonOku(SENTETIK_PROFIL) as Record<string, unknown>;
    expect(emeklilikProfiliBicimli({ ...profil, sentetik: false })).toBe(true);
    expect(emeklilikProfiliBicimli({ surum: 1, dogumTarihi: 'x', kayitliGun: {} })).toBe(true);
    expect(emeklilikProfiliBicimli({ surum: 1, dogumTarihi: 'x' })).toBe(false);
    expect(emeklilikProfiliBicimli(jsonOku(join(root, 'package.json')))).toBe(false);
    expect(emeklilikProfiliBicimli([profil])).toBe(false);
  });
});
