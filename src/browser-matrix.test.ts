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
  it('Playwright konfigürasyonları bulundu', () => { expect(configs.length).toBeGreaterThanOrEqual(4); expect(workflows.length).toBeGreaterThanOrEqual(2); });
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
