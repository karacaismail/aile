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
    for (const needle of ['e2e/flows.spec.ts', 'e2e/budget.spec.ts', 'e2e/settings-cache.spec.ts', 'e2e/sync-recovery.spec.ts', '--project=iphone4', '--project=iphone12-webkit']) expect(gate).toContain(needle);
    expect(gate).not.toMatch(/--project=(tablet|laptop|desktop)/);
  });
});
