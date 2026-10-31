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
