// Tarayıcı kapsamı politikası (kullanıcı kararı 2026-10-31): otomatik test ve CI matrisi Firefox çalıştırmaz.
// Chrome/Safari ailesi (izole Chromium ve WebKit) korunur; Firefox yalnız açık kullanıcı talimatıyla, elle eklenir.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from this file, not from the process working directory.
const root = resolve(__dirname, '..');
const configs = readdirSync(root).filter(name => /^playwright.*\.config\.ts$/.test(name)).map(name => join(root, name));
const workflowDir = join(root, '.github/workflows');
const workflows = readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name)).map(name => join(workflowDir, name));

describe('tarayıcı test matrisi', () => {
  it('Playwright konfigürasyonları bulundu', () => { expect(configs.length).toBeGreaterThanOrEqual(5); expect(workflows.length).toBeGreaterThanOrEqual(2); });
  for (const file of configs) {
    it(`${file.slice(root.length)} Firefox projesi, kanalı veya motoru tanımlamaz`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/firefox/i);
      expect(source).toMatch(/Desktop Chrome/);
    });
  }
  for (const file of workflows) {
    it(`${file.slice(root.length)} Firefox kurmaz veya çalıştırmaz`, () => {
      expect(readFileSync(file, 'utf8')).not.toMatch(/firefox/i);
    });
  }
});

// Yönetim kapısı (playwright.admin.config.ts): Chrome/Safari ailesi, yalnız admin- önekli spec'ler, Firefox yok.
// Kaynağa bakıp ihlal listesi döndürür; boş liste = kapı geçer.
function adminGate(source: string): string[] {
  const violations: string[] = [];
  if (/firefox/i.test(source)) violations.push('firefox var');
  if (!/Desktop Chrome/.test(source)) violations.push('Desktop Chrome yok');
  if (!/Desktop Safari/.test(source)) violations.push('Desktop Safari yok');
  if (!/testMatch\s*:\s*\/admin-/.test(source)) violations.push('testMatch admin- değil');
  return violations;
}

describe('yönetim tarayıcı kapısı', () => {
  it('playwright.admin.config.ts Desktop Chrome + Desktop Safari ile yalnız admin- spec koşar, Firefox yok', () => {
    expect(adminGate(readFileSync(join(root, 'playwright.admin.config.ts'), 'utf8'))).toEqual([]);
  });
  it('kapı Firefox içeren, Safari eksik veya admin- dışı testMatch kullanan konfigürasyonu reddeder', () => {
    const base = "testMatch:/admin-.*\\.spec\\.ts$/,projects:[{use:{...devices['Desktop Chrome']}},{use:{...devices['Desktop Safari']}}]";
    expect(adminGate(base)).toEqual([]);
    expect(adminGate(base.replace('Desktop Safari', 'Desktop Firefox'))).toEqual(['firefox var', 'Desktop Safari yok']);
    expect(adminGate(base.replace("{use:{...devices['Desktop Chrome']}},", ''))).toEqual(['Desktop Chrome yok']);
    expect(adminGate(base.replace('/admin-.*', '/.*'))).toEqual(['testMatch admin- değil']);
    expect(adminGate(base.replace('testMatch:/admin-.*\\.spec\\.ts$/,', ''))).toEqual(['testMatch admin- değil']);
  });
});

// Pages yayını (deploy.yml, main): planner kayıt yolculuğu (flows, budget) ve senkron/önbellek regresyonları aynı hedefli
// tarayıcı kapısında Chromium 320 + WebKit ile koşar; tam altı projeli legacy matrisi yalnız PR/CI'da kalır.
describe('Pages yayın kapısı', () => {
  it('deploy.yml planner kayıt yolculuğunu (flows, budget) senkron/önbellek testleriyle birlikte Chromium 320 ve WebKit ile koşar', () => {
    const deploy = readFileSync(join(workflowDir, 'deploy.yml'), 'utf8');
    const gate = deploy.split('\n').find((line) => /^\s*- run: pnpm exec playwright test .*e2e\/settings-cache\.spec\.ts/.test(line));
    expect(gate, 'hedefli tarayıcı kapısı satırı').toBeDefined();
    for (const needle of ['e2e/purchase-hierarchy.spec.ts', 'e2e/flows.spec.ts', 'e2e/budget.spec.ts', 'e2e/settings-cache.spec.ts', 'e2e/sync-recovery.spec.ts', '--project=iphone4', '--project=iphone12-webkit']) expect(gate).toContain(needle);
    expect(gate).not.toMatch(/--project=(tablet|laptop|desktop)/);
  });
});

// The complete 716-step journey keeps its own resource budget without competing with other browsers.
describe('uzun dashboard yolculuğunun CI kaynak ayrımı', () => {
  const journey = 'all-period view bounds rendering and preserves balances through 716 chronological steps';
  for (const workflow of ['deploy.yml', 'ci.yml']) {
    it(`${workflow} aynı tam yolculuğu ayrık seçimle bir kez, tek worker ile koşar`, () => {
      const source = readFileSync(join(workflowDir, workflow), 'utf8');
      const gates = source.split('\n').filter(line => /run: pnpm e2e:dashboard\b/.test(line));
      expect(gates).toHaveLength(2);
      expect(gates[0]).toContain(`--grep-invert '${journey}'`);
      expect(gates[1]).toContain(`--grep '${journey}'`);
      expect(gates[1]).toContain('--workers=1');
      expect(gates.join('\n')).not.toMatch(/--(?:project|timeout|retries|max-failures)(?:=|\s)/);
      expect(readFileSync(join(root, 'e2e/timeline-dashboard.spec.ts'), 'utf8')).toContain(`test('${journey}'`);
    });
    it(`${workflow} önceki hata sonucunu ve iki geçişin kanıtlarını korur`, () => {
      const source = readFileSync(join(workflowDir, workflow), 'utf8');
      expect(source).toContain('- id: dashboard');
      expect(source).toContain("if: ${{ !cancelled() && (steps.dashboard.outcome == 'success' || steps.dashboard.outcome == 'failure') }}");
      const steps = source.split(/(?=^      - )/m).filter(step => /run: pnpm e2e:dashboard\b/.test(step));
      const paths = steps.flatMap(step => [step.match(/--output=(\S+)/)?.[1], step.match(/PLAYWRIGHT_HTML_OUTPUT_DIR: (\S+)/)?.[1]]);
      expect(paths).toEqual(['test-results-dashboard', 'playwright-report-dashboard', 'test-results-dashboard-long', 'playwright-report-dashboard-long']);
      // Later legacy/production runners clean their root output folders. Dashboard
      // evidence must be sibling directories, never children of either root.
      for (const path of paths) expect(path).not.toMatch(/^(?:test-results|playwright-report)(?:\/|$)/);
      expect(source).not.toContain('continue-on-error: true');
      const upload = source.slice(source.indexOf('- uses: actions/upload-artifact@'));
      expect(upload).toContain('if: failure()');
      const uploadedPaths = upload.split('\n').map(line => line.trim());
      for (const path of [...paths, 'playwright-report', 'test-results']) expect(uploadedPaths).toContain(path);
    });
  }
});

// Yönetim paneli yayın kapısı (docs/ADMIN-DEPLOY-PROPOSAL.md): admin E2E ayrı işte ve telefon projeleri önce koşar;
// gizlilik + teslim kapıları sentetik build'den sonra gelir; build kanıtı (.vite, delivery-report.json) Pages'e çıkmaz.
describe('yönetim paneli CI ve yayın kapısı', () => {
  const read = (name: string) => readFileSync(join(workflowDir, name), 'utf8');
  const lines = (source: string) => source.split('\n');
  const adminRuns = (source: string) => lines(source).filter(line => /run: pnpm e2e:admin\b/.test(line));
  const at = (source: string, needle: string) => lines(source).findIndex(line => line.includes(needle));
  for (const workflow of ['ci.yml', 'deploy.yml']) {
    it(`${workflow} sentetik build'den sonra gizlilik, teslim ve yönetim üretim kapısını koşar`, () => {
      const source = read(workflow);
      const build = lines(source).findIndex((line, i, all) => /- run: pnpm build$/.test(line) && (all[i + 2] ?? '').includes('synthetic-budget-sheet-2098'));
      expect(build, 'sentetik pnpm build adımı').toBeGreaterThanOrEqual(0);
      for (const needle of ['- run: node scripts/check-dist-privacy.mjs dist', 'node scripts/check-delivery.mjs dist', 'node scripts/check-budgets.mjs dist', '--config playwright.admin-production.config.ts']) {
        expect(at(source, needle), needle).toBeGreaterThan(build);
      }
    });
    it(`${workflow} teslim kapısını yalnız --strict ile, bütçe kapısını teslim raporundan sonra koşar`, () => {
      const source = read(workflow);
      const delivery = lines(source).filter(line => line.includes('node scripts/check-delivery.mjs dist'));
      expect(delivery.length).toBeGreaterThanOrEqual(1);
      for (const line of delivery) expect(line, line).toContain('--strict');
      expect(at(source, 'node scripts/check-budgets.mjs dist')).toBeGreaterThan(at(source, 'node scripts/check-delivery.mjs dist'));
    });
    it(`${workflow} yönetim E2E'sini ayrı işte, önce telefon projeleriyle koşar`, () => {
      const source = read(workflow);
      expect(source).toMatch(/^ {2}admin:\n(?: {4}#.*\n)? {4}runs-on: macos-latest$/m);
      const runs = adminRuns(source);
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0]).toContain('--project=chromium --project=webkit');
      expect(runs[0]).not.toMatch(/--project=\S*(?:tablet|desktop|short|landscape|360|375)/);
    });
  }
  it('ci.yml telefon → @matrix telefon → geniş sırasını korur', () => {
    const runs = adminRuns(read('ci.yml'));
    expect(runs).toHaveLength(3);
    expect(runs[1]).toMatch(/--project=chromium-short .*--project=chromium-landscape/);
    expect(runs[2]).toMatch(/--project=webkit-tablet .*--project=chromium-desktop/);
  });
  it('deploy.yml yalnız telefon projelerini koşar, yayını admin işine bağlar ve kanıtı artefakttan çıkarır', () => {
    const source = read('deploy.yml');
    expect(adminRuns(source)).toHaveLength(1);
    expect(source).toContain('needs: [build, admin]');
    const lastBuild = lines(source).findLastIndex(line => /- run: pnpm build$/.test(line));
    const removal = at(source, 'rm -rf dist/.vite');
    expect(removal).toBeGreaterThan(lastBuild);
    expect(at(source, 'rm -f dist/delivery-report.json dist/budget-report.json')).toBeGreaterThan(lastBuild);
    expect(at(source, '- uses: actions/upload-pages-artifact@')).toBeGreaterThan(removal);
    expect(source).not.toMatch(/include-hidden-files:\s*true/);
  });
});
