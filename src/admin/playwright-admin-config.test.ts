// Yönetim Playwright kapısının spec seçimi: Playwright testMatch'i dosyanın TAM YOLUNA uygular.
// Çalışma klasörü 'admin-panel-plan' gibi admin- içerdiğinde yalnız yol parçasına bakmayan bir desen
// bütün e2e/*.spec.ts dosyalarını (üretim kapıları dâhil) seçer; seçim dosya adına bağlı kalmalıdır.
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.admin.config';

const root = resolve(__dirname, '../..');
const specs = readdirSync(join(root, 'e2e')).filter((name) => name.endsWith('.spec.ts'));
const prefixes = [
  '/Users/dev/Developer/aile/ux-worktrees/admin-panel-plan/e2e/',
  '/home/runner/work/aile/admin-tools/e2e/',
  'C:\\work\\admin-panel-plan\\e2e\\',
  join(root, 'e2e') + '/',
];

function selects(path: string): boolean {
  const match = config.testMatch;
  expect(match, 'testMatch tek RegExp olmalı').toBeInstanceOf(RegExp);
  return (match as RegExp).test(path);
}

describe('playwright.admin.config.ts spec seçimi', () => {
  it('e2e klasöründe admin- olan ve olmayan spec dosyaları vardır', () => {
    expect(specs.some((name) => name.startsWith('admin-'))).toBe(true);
    expect(specs.some((name) => !name.startsWith('admin-'))).toBe(true);
  });

  for (const prefix of prefixes) {
    it(`${prefix} altında yalnız dosya adı admin- ile başlayan spec seçilir`, () => {
      const wrong = specs.filter((name) => selects(prefix + name) !== basename(name).startsWith('admin-'));
      expect(wrong).toEqual([]);
    });
  }

  it('yardımcı dosyalar ve admin- ile başlamayan adlar seçilmez', () => {
    const base = '/x/admin-panel-plan/e2e/';
    expect(selects(base + 'admin-helpers.ts')).toBe(false);
    expect(selects(base + 'admin-detectors.ts')).toBe(false);
    expect(selects(base + 'startup-production.spec.ts')).toBe(false);
    expect(selects(base + 'timeline-production.spec.ts')).toBe(false);
    expect(selects(base + 'admin-smoke.spec.ts')).toBe(true);
  });
});
