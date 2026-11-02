// Kaynak kuralı: model katmanı saf alan kodudur. Yalnız kendi dosyalarını ve sözleşmeyi içe aktarır; React, antd,
// görünüm katmanı, DOM API'si, ağ, zamanlayıcı ya da kalıcı depolama kullanmaz.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { importsOf, stripComments } from '../../adaptive/sourceRules';

const KOK = __dirname;

function dosyalar(yol: string, out: string[] = []): string[] {
  for (const ad of readdirSync(yol)) {
    const tam = join(yol, ad);
    if (statSync(tam).isDirectory()) dosyalar(tam, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(ad) && !/\.test\.ts$/.test(ad)) out.push(tam);
  }
  return out;
}

/** İzinli içe aktarımlar: model içi göreli dosyalar ve sözleşme. testDestek yalnız sentetik fikstürü de okur. */
function izinli(dosya: string, belirtec: string): boolean {
  if (/^\.\/[\w.-]+$/.test(belirtec) || belirtec === '../contract') return true;
  return basename(dosya) === 'testDestek.ts' && belirtec.endsWith('fixtures/emeklilik/profil-sentetik.json');
}

const YASAK: Array<[string, RegExp]> = [
  ['DOM API', /\b(document|window|globalThis\.document|navigator|HTMLElement|Element|localStorage|sessionStorage|indexedDB)\b/],
  ['ağ çağrısı', /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/],
  ['zamanlayıcı', /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/],
  ['kayan nokta para toplamı', /\bparseFloat\s*\(/],
];

describe('emeklilik modeli kaynak kuralı', () => {
  const liste = dosyalar(KOK);

  it('taranacak model dosyaları var ve hiçbiri tsx/jsx değil', () => {
    expect(liste.length).toBeGreaterThanOrEqual(10);
    expect(liste.filter((f) => /\.(tsx|jsx)$/.test(f))).toEqual([]);
  });

  it('yalnız model içi dosyaları ve sözleşmeyi içe aktarır (react, antd, görünüm yok)', () => {
    const ihlal = liste.flatMap((f) => importsOf(readFileSync(f, 'utf8'))
      .filter((ref) => !izinli(f, ref.specifier))
      .map((ref) => `${basename(f)} → ${ref.specifier}`));
    expect(ihlal).toEqual([]);
  });

  for (const [ad, desen] of YASAK) {
    it(`yasaklı kullanım yok: ${ad}`, () => {
      expect(liste.filter((f) => desen.test(stripComments(readFileSync(f, 'utf8')))).map((f) => basename(f))).toEqual([]);
    });
  }

  it('kural ihlalli örnekleri yakalar', () => {
    expect(importsOf("import { useState } from 'react';").some((r) => !izinli('x.ts', r.specifier))).toBe(true);
    expect(importsOf("import { Button } from 'antd';").some((r) => !izinli('x.ts', r.specifier))).toBe(true);
    expect(importsOf("import { Tag } from '../../ui';").some((r) => !izinli('x.ts', r.specifier))).toBe(true);
    expect(importsOf("import type { Secim } from '../contract';").every((r) => izinli('x.ts', r.specifier))).toBe(true);
    const bul = (ad: string) => YASAK.find(([a]) => a === ad)![1];
    expect(bul('DOM API').test('document.title = "x"')).toBe(true);
    expect(bul('ağ çağrısı').test('await fetch(url)')).toBe(true);
    expect(bul('DOM API').test('belgeler ve pencereler')).toBe(false);
  });
});
