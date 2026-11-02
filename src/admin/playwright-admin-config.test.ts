// Yönetim Playwright kapısının paralel çalışma sözleşmesi (W0 altyapı). Aynı makinede ~50 worktree birbirini bozmadan
// koşar: spec seçimi yalnız DOSYA ADINA bakar (Playwright testMatch'i tam yola uygular; 'aw-admin-x' gibi bir
// worktree adı bütün e2e/*.spec.ts dosyalarını seçmemeli), her koşu AILE_PORT'ta kendi Vite sunucusunu başlatır ve
// başka worktree'nin sunucusunu asla yeniden kullanmaz, sunucu yalnız sentetik nesil + sentetik Sheet kimliği görür,
// projeler 320 mobil öncelikli Chrome/Safari ailesidir ve matris projeleri yalnız @matrix testlerini koşar.
// openAdmin: sabit bekleme yerine gerçek hazır sinyali (main görünür, main içinde görünür h1, aria-busy kalmadı).
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Page, PlaywrightTestConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, ADMIN_MAIN, adminNotReadyReasons, openAdmin } from '../../e2e/admin-helpers';

const root = resolve(__dirname, '../..');
const SYNTHETIC_DIR = join(root, 'fixtures', 'generation-synthetic');
const SYNTHETIC_EMEKLILIK = join(root, 'fixtures', 'emeklilik', 'profil-sentetik.json');
const specs = readdirSync(join(root, 'e2e')).filter((name) => name.endsWith('.spec.ts'));

type Env = { AILE_PORT?: string; CI?: string };
type Which = 'dev' | 'production';
type WebServer = { command: string; url: string; cwd?: string; reuseExistingServer?: boolean; env?: Record<string, string> };

/** Konfigürasyonu verilen ortamla yeniden değerlendirir (modül önbelleği sıfırlanır); ortam geri yüklenir. */
async function load(which: Which, env: Env = {}): Promise<PlaywrightTestConfig> {
  const saved: Env = { AILE_PORT: process.env.AILE_PORT, CI: process.env.CI };
  for (const key of ['AILE_PORT', 'CI'] as const) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  vi.resetModules();
  try {
    return which === 'dev'
      ? (await import('../../playwright.admin.config')).default
      : (await import('../../playwright.admin-production.config')).default;
  } finally {
    for (const key of ['AILE_PORT', 'CI'] as const) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function webServer(config: PlaywrightTestConfig): WebServer {
  expect(Array.isArray(config.webServer), 'tek webServer').toBe(false);
  return config.webServer as WebServer;
}

function matcher(config: PlaywrightTestConfig): (path: string) => boolean {
  expect(config.testMatch, 'testMatch tek RegExp olmalı').toBeInstanceOf(RegExp);
  const pattern = config.testMatch as RegExp;
  return (path) => {
    pattern.lastIndex = 0;
    return pattern.test(path);
  };
}

describe('spec seçimi: testMatch yalnız dosya adına bakar', () => {
  const prefixes = [
    '/Users/dev/Developer/aile/ux-worktrees/admin-panel-plan/e2e/',
    '/Users/w6x/Developer/aile/ux-worktrees/aw-admin-x/e2e/',
    '/Users/w6x/Developer/aile/ux-worktrees/aw-w0-infra/e2e/',
    '/home/runner/work/aile/admin-tools/e2e/',
    'C:\\work\\aw-admin-x\\e2e\\',
    join(root, 'e2e') + '/',
  ];

  it('e2e klasöründe admin- olan ve olmayan spec dosyaları vardır', () => {
    expect(specs.some((name) => name.startsWith('admin-'))).toBe(true);
    expect(specs.some((name) => !name.startsWith('admin-'))).toBe(true);
  });

  for (const prefix of prefixes) {
    it(`${prefix} altında yalnız dosya adı admin- ile başlayan spec seçilir`, async () => {
      const selects = matcher(await load('dev'));
      const wrong = specs.filter((name) => selects(prefix + name) !== basename(name).startsWith('admin-'));
      expect(wrong).toEqual([]);
    });
  }

  it('yardımcılar, benzer adlar ve admin- içeren klasör adları seçilmez', async () => {
    const selects = matcher(await load('dev'));
    const base = '/x/aw-admin-x/e2e/';
    expect(selects(base + 'admin-smoke.spec.ts')).toBe(true);
    expect(selects('admin-smoke.spec.ts')).toBe(true);
    expect(selects('C:\\w\\aw-admin-x\\e2e\\admin-smoke.spec.ts')).toBe(true);
    expect(selects(base + 'admin-helpers.ts')).toBe(false);
    expect(selects(base + 'admin-detectors.ts')).toBe(false);
    expect(selects(base + 'startup-production.spec.ts')).toBe(false);
    expect(selects(base + 'timeline-production.spec.ts')).toBe(false);
    expect(selects(base + 'superadmin-smoke.spec.ts')).toBe(false);
    expect(selects(base + 'xadmin-smoke.spec.ts')).toBe(false);
    expect(selects('/x/admin-smoke.spec.ts/e2e/flows.spec.ts')).toBe(false);
    expect(selects(base + 'admin-smoke.spec.ts.orig')).toBe(false);
  });

  it('üretim kapısı yalnız dosya adı admin-production.spec.ts olan dosyayı seçer', async () => {
    const selects = matcher(await load('production'));
    expect(selects('/x/aw-admin-x/e2e/admin-production.spec.ts')).toBe(true);
    expect(selects('C:\\w\\aw-admin-x\\e2e\\admin-production.spec.ts')).toBe(true);
    expect(selects('/x/aw-admin-x/e2e/superadmin-production.spec.ts')).toBe(false);
    expect(selects('/x/aw-admin-x/e2e/admin-smoke.spec.ts')).toBe(false);
    expect(selects('/x/aw-admin-x/e2e/startup-production.spec.ts')).toBe(false);
  });
});

describe('port yalıtımı: her koşu kendi sunucusunu kendi portunda başlatır', () => {
  it('AILE_PORT=5300: dev sunucusu 127.0.0.1:5300, strictPort, worktree kökünde, yeniden kullanım yok', async () => {
    for (const CI of [undefined, '1']) {
      const config = await load('dev', { AILE_PORT: '5300', CI });
      const server = webServer(config);
      expect(server.command).toBe('pnpm exec vite --host 127.0.0.1 --port 5300 --strictPort');
      expect(server.url).toBe('http://127.0.0.1:5300/aile/');
      expect(config.use?.baseURL).toBe('http://127.0.0.1:5300/aile/');
      expect(server.reuseExistingServer, `CI=${CI}`).toBe(false);
      expect(server.cwd).toBe(root);
    }
  });

  it('dev sunucusu yalnız sentetik nesil ve sentetik Sheet kimliği görür', async () => {
    const server = webServer(await load('dev', { AILE_PORT: '5300' }));
    expect(server.env).toEqual({ VITE_BUDGET_SHEET_ID: 'synthetic-budget-sheet-2098', AILE_GENERATION_DIR: SYNTHETIC_DIR, AILE_EMEKLILIK_PROFILE: SYNTHETIC_EMEKLILIK });
  });

  it('AILE_PORT yoksa varsayılan 5174 (pnpm dev ile aynı); yine de yeniden kullanım yok', async () => {
    const config = await load('dev');
    const server = webServer(config);
    expect(server.command).toBe('pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort');
    expect(server.url).toBe('http://127.0.0.1:5174/aile/');
    expect(config.use?.baseURL).toBe('http://127.0.0.1:5174/aile/');
    expect(server.reuseExistingServer).toBe(false);
  });

  it('geçersiz AILE_PORT sessizce varsayılana düşmez, açık hata verir', async () => {
    for (const AILE_PORT of ['abc', '5300x', '53.5', '-1', '80', '1023', '65535', '70000']) {
      await expect(load('dev', { AILE_PORT }), AILE_PORT).rejects.toThrow(/AILE_PORT/);
      await expect(load('production', { AILE_PORT }), AILE_PORT).rejects.toThrow(/AILE_PORT/);
    }
  });

  it('üretim kapısı AILE_PORT+1 üzerinde vite preview (strictPort) kullanır; AILE_PORT yoksa 5178', async () => {
    const config = await load('production', { AILE_PORT: '5300' });
    const server = webServer(config);
    expect(server.command).toBe('pnpm exec vite preview --host 127.0.0.1 --port 5301 --strictPort');
    expect(server.url).toBe('http://127.0.0.1:5301/aile/');
    expect(config.use?.baseURL).toBe('http://127.0.0.1:5301/aile/');
    expect(server.reuseExistingServer).toBe(false);
    expect(server.cwd).toBe(root);
    expect(server.env).toEqual({ VITE_BUDGET_SHEET_ID: 'synthetic-budget-sheet-2098', AILE_GENERATION_DIR: SYNTHETIC_DIR, AILE_EMEKLILIK_PROFILE: SYNTHETIC_EMEKLILIK });
    const fallback = webServer(await load('production'));
    expect(fallback.command).toBe('pnpm exec vite preview --host 127.0.0.1 --port 5178 --strictPort');
    expect(fallback.url).toBe('http://127.0.0.1:5178/aile/');
  });

  it('komşu yuvalar (5300, 5302) port, çıktı klasörü ve raporda çakışmaz', async () => {
    // Sırayla: load() süreç ortamını geçici değiştirir.
    const slots: { dev: PlaywrightTestConfig; production: PlaywrightTestConfig }[] = [];
    for (const AILE_PORT of ['5300', '5302']) slots.push({ dev: await load('dev', { AILE_PORT }), production: await load('production', { AILE_PORT }) });
    const ports = slots.flatMap(({ dev, production }) => [webServer(dev).url, webServer(production).url].map((url) => new URL(url).port));
    expect(ports).toEqual(['5300', '5301', '5302', '5303']);
    const folders = slots.flatMap(({ dev, production }) => {
      const html = (dev.reporter as unknown as [string, { outputFolder?: string }?][]).find(([name]) => name === 'html')?.[1]?.outputFolder;
      return [dev.outputDir, html, production.outputDir];
    });
    expect(folders.every((folder) => typeof folder === 'string' && folder.length > 0)).toBe(true);
    expect(new Set(folders).size).toBe(folders.length);
  });
});

describe('projeler: 320 mobil öncelik, Chrome/Safari ailesi, matris yalnız @matrix', () => {
  const expected = [
    { name: 'chromium', browser: 'chromium', width: 320, height: 568, touch: true, matrix: false },
    { name: 'webkit', browser: 'webkit', width: 390, height: 844, touch: true, matrix: false },
    { name: 'chromium-desktop', browser: 'chromium', width: 1440, height: 900, touch: false, matrix: false },
    { name: 'chromium-360', browser: 'chromium', width: 360, height: 640, touch: true, matrix: true },
    { name: 'chromium-375', browser: 'chromium', width: 375, height: 667, touch: true, matrix: true },
    { name: 'chromium-short', browser: 'chromium', width: 320, height: 480, touch: true, matrix: true },
    { name: 'chromium-landscape', browser: 'chromium', width: 568, height: 320, touch: true, matrix: true },
    { name: 'webkit-tablet', browser: 'webkit', width: 820, height: 1180, touch: true, matrix: true },
    { name: 'webkit-desktop', browser: 'webkit', width: 1440, height: 900, touch: false, matrix: true },
  ];

  it('proje adları korunur ve matris projeleri eklenir', async () => {
    const config = await load('dev');
    expect(config.projects?.map((project) => project.name)).toEqual(expected.map((project) => project.name));
  });

  for (const want of expected) {
    it(`${want.name}: ${want.browser} ${want.width}×${want.height}${want.touch ? ' dokunmatik' : ''}${want.matrix ? ', yalnız @matrix' : ''}`, async () => {
      const project = (await load('dev')).projects?.find((candidate) => candidate.name === want.name);
      expect(project, want.name).toBeDefined();
      expect(project!.use?.defaultBrowserType).toBe(want.browser);
      expect(project!.use?.viewport).toEqual({ width: want.width, height: want.height });
      expect(project!.use?.hasTouch ?? false).toBe(want.touch);
      if (want.matrix) {
        const grep = project!.grep;
        expect(grep).toBeInstanceOf(RegExp);
        expect((grep as RegExp).test('admin-smoke.spec.ts kenar durumu @matrix')).toBe(true);
        expect((grep as RegExp).test('admin-smoke.spec.ts admin.html#/alimlar açılır')).toBe(false);
      } else {
        expect(project!.grep).toBeUndefined();
      }
    });
  }

  it('Firefox projesi, kanalı veya motoru yoktur', async () => {
    for (const which of ['dev', 'production'] as const) {
      const config = await load(which);
      expect(JSON.stringify(config.projects)).not.toMatch(/firefox/i);
    }
  });
});

describe('openAdmin: gerçek hazır sinyali', () => {
  type Visible = (this: Element) => boolean;
  const proto = Element.prototype as unknown as { checkVisibility?: Visible };
  const original = proto.checkVisibility;
  // jsdom yerleşim yapmaz: görünürlük test içinde data-hidden ile taklit edilir; tarayıcıda gerçek checkVisibility.
  const fakeVisibility: Visible = function () { return this.closest('[data-hidden]') === null; };
  afterEach(() => {
    if (original) proto.checkVisibility = original;
    else delete proto.checkVisibility;
    document.body.innerHTML = '';
  });

  function mount(html: string) {
    proto.checkVisibility = fakeVisibility;
    document.body.innerHTML = html;
  }

  it('main görünür, main içinde dolu ve görünür h1 var, aria-busy yoksa hazırdır', () => {
    mount('<main id="admin-content"><header><h1>Alımlar ve eşyalar</h1></header><p>İçerik</p></main>');
    expect(adminNotReadyReasons()).toEqual([]);
  });

  it('iskelet (aria-busy) sürdükçe, h1 yokken, h1 main dışındayken veya gizliyken hazır değildir', () => {
    mount('');
    expect(adminNotReadyReasons()).toEqual(['main#admin-content yok']);
    mount('<main id="admin-content"><h1>Alımlar ve eşyalar</h1><div role="status" aria-busy="true">Yükleniyor</div></main>');
    expect(adminNotReadyReasons()).toEqual(['1 öğe aria-busy="true"']);
    mount('<h1>Dışarıda</h1><main id="admin-content"><p>İçerik</p></main>');
    expect(adminNotReadyReasons()).toEqual(['main içinde h1 yok']);
    mount('<main id="admin-content"><h1 data-hidden>Gizli</h1></main>');
    expect(adminNotReadyReasons()).toEqual(['main h1 görünür değil']);
    mount('<main id="admin-content" data-hidden><h1>Alımlar</h1></main>');
    expect(adminNotReadyReasons()).toEqual(['main#admin-content görünür değil', 'main h1 görünür değil']);
    mount('<main id="admin-content"><h1>  </h1></main>');
    expect(adminNotReadyReasons()).toEqual(['main h1 boş']);
  });

  function fakePage(start: string, ready: boolean) {
    let current = start;
    const calls: string[] = [];
    const waits: { expression: string; options: { timeout?: number; polling?: unknown } }[] = [];
    const page = {
      url: () => current,
      goto: vi.fn(async (url: string) => {
        calls.push(`goto ${url}`);
        current = url.startsWith('about:') ? url : `http://127.0.0.1:5300/aile/${url}`;
        return null;
      }),
      waitForFunction: vi.fn(async (expression: string, _arg: unknown, options: { timeout?: number; polling?: unknown }) => {
        calls.push('waitForFunction');
        waits.push({ expression, options });
        if (!ready) throw new Error('page.waitForFunction: Timeout 20000ms exceeded.');
        return {};
      }),
      evaluate: vi.fn(async () => ['1 öğe aria-busy="true"']),
      locator: vi.fn((selector: string) => ({ selector })),
      waitForTimeout: vi.fn(),
    };
    return { page: page as unknown as Page, raw: page, calls, waits };
  }

  it('rotayı normalleştirip açar, sabit bekleme kullanmadan hazır sinyalini bekler ve main locator döndürür', async () => {
    for (const route of ['/alimlar', 'alimlar']) {
      const { page, raw, calls, waits } = fakePage('about:blank', true);
      const main = await openAdmin(page, route);
      expect(calls).toEqual([`goto ${ADMIN}/alimlar`, 'waitForFunction']);
      expect(raw.waitForTimeout).not.toHaveBeenCalled();
      expect(waits[0].options.timeout).toBeGreaterThan(0);
      expect(raw.locator).toHaveBeenCalledWith(ADMIN_MAIN);
      expect(main).toEqual({ selector: ADMIN_MAIN });
    }
  });

  it('aynı admin.html belgesindeyken önce about:blank ile tam yükleme yapar (yalnız hash değişimi eski h1 ile yanıltmaz)', async () => {
    const { page, calls } = fakePage('http://127.0.0.1:5300/aile/admin.html#/genel', true);
    await openAdmin(page, '/alimlar');
    expect(calls).toEqual(['goto about:blank', `goto ${ADMIN}/alimlar`, 'waitForFunction']);
  });

  it('beklenen ifade sayfa bağlamında kendi başına çalışır ve hazır durumu iki ardışık karede doğrular', async () => {
    const { page, waits } = fakePage('about:blank', true);
    await openAdmin(page, '/alimlar', { timeout: 1234 });
    expect(waits[0].options).toEqual({ timeout: 1234, polling: 'raf' });
    const poll = () => (0, eval)(waits[0].expression) as boolean;
    mount('<main id="admin-content"><h1>Alımlar</h1><div aria-busy="true"></div></main>');
    expect(poll()).toBe(false);
    document.querySelector('[aria-busy]')!.remove();
    expect(poll()).toBe(false);
    expect(poll()).toBe(true);
  });

  it('süre dolarsa rota ve eksik sinyallerle açıklayıcı hata verir', async () => {
    const { page } = fakePage('about:blank', false);
    await expect(openAdmin(page, '/alimlar')).rejects.toThrow(/openAdmin\('\/alimlar'\).*aria-busy/s);
  });
});
