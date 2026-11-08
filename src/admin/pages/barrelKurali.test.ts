import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Sayfa kodu ui bileşenlerini kendi modüllerinden içe aktarır ('../ui/Button'), '../ui' barrel'ından değil.
// Barrel Chart'ı (ECharts köprüsü ve stili) ve Overview'u da dışa aktarır; barrel'dan tek bir ad bile almak
// telefonun sayfa parçasına Chart.tsx + Chart.css'i statik olarak bağlar (teslim kapısı ve telefon bütçesi).

// Sayfalar ve kabuk (sayfaların statik olarak çektiği filtre/sorgu modülleri) aynı kurala tabidir.
const KOKLER = [join(process.cwd(), 'src', 'admin', 'pages'), join(process.cwd(), 'src', 'admin', 'shell')];
const BARREL = /from\s+'(?:\.\.\/)+ui'\s*;?/;

function kaynaklar(dizin: string): string[] {
  return readdirSync(dizin).flatMap((ad) => {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) return kaynaklar(yol);
    return /\.(?:ts|tsx)$/.test(ad) && !/\.test\.(?:ts|tsx)$/.test(ad) ? [yol] : [];
  });
}

describe('sayfa kodu ui barrel kuralı', () => {
  it("hiçbir sayfa ya da kabuk modülü '../ui' barrel'ından içe aktarmaz", () => {
    const ihlaller = KOKLER.flatMap(kaynaklar).filter((yol) => BARREL.test(readFileSync(yol, 'utf8'))).map((yol) => relative(process.cwd(), yol));
    expect(ihlaller).toEqual([]);
  });

  it('kural barrel importunu yakalar (öz denetim)', () => {
    expect(BARREL.test("import { Button, Money } from '../ui';")).toBe(true);
    expect(BARREL.test("import { Money } from '../../ui';")).toBe(true);
    expect(BARREL.test("import { Button } from '../ui/Button';")).toBe(false);
  });
});
