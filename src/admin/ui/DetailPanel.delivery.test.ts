import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { importsOf } from '../adaptive/sourceRules';

// Telefon teslimi (W0 › antd GATE, check-delivery): a11-detail bileşenleri (DetailPanel, ListRow, Disclosure, FormFooter,
// ConflictView) telefon profilinde antd, @ant-design/*, echarts ve geniş-özel (*.wide) kodu istemez. Kaynak düzeyinde iki
// kapı: (1) bu beş dosyanın kendi statik importları; (2) bu dosyalardan başlayan statik import kapanışı (tür-yalnız ve
// dinamik import() hariç). İkinci kapı ihlalin zincirini yazar; zincirdeki dosyanın sahibi düzeltir (ör. ui/Button → a01).

const UI_DIR = __dirname;
const OWN = ['DetailPanel.tsx', 'ListRow.tsx', 'Disclosure.tsx', 'FormFooter.tsx', 'ConflictView.tsx'];

/** Telefon profilinde yasak paket ya da modül: antd ailesi, ECharts, ui/antd yüzeyi, antd teması ve *.wide. */
function forbidden(specifier: string): boolean {
  if (/^(antd|@ant-design|@rc-component|echarts|zrender)(\/|$)/.test(specifier)) return true;
  if (/(^|\/)(ui\/)?antd(\.ts)?$/.test(specifier) && specifier.startsWith('.')) return true;
  if (/(^|\/)theme\/antdTheme(\.ts)?$/.test(specifier)) return true;
  return /\.wide(\.tsx?)?$/.test(specifier) || /(^|\/)wide\//.test(specifier);
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

const runtimeImports = (file: string) => importsOf(readFileSync(file, 'utf8')).filter(ref => ref.kind === 'static' && !ref.typeOnly);
const short = (file: string) => file.replace(`${resolve(UI_DIR, '..', '..', '..')}/`, '');

/** Kapanıştaki ihlaller: "giriş > ... > modül → yasak belirteç". */
function closureViolations(entries: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = entries.map(file => ({ file, chain: [short(file)] }));
  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const ref of runtimeImports(file)) {
      if (forbidden(ref.specifier)) {
        out.push(`${chain.join(' > ')} → ${ref.specifier}`);
        continue;
      }
      if (!ref.specifier.startsWith('.')) continue;
      const next = resolveRelative(file, ref.specifier);
      if (next && !seen.has(next)) queue.push({ file: next, chain: [...chain, short(next)] });
    }
  }
  return out;
}

describe('a11-detail telefon teslimi (kaynak düzeyi)', () => {
  it('yasak belirteç denetimi kendini sınar: antd, @ant-design, ./antd, echarts, *.wide yakalanır; ./Button yakalanmaz', () => {
    for (const bad of ['antd', 'antd/locale/tr_TR', '@ant-design/pro-components', './antd', '../ui/antd', 'echarts/core', './wide/Select.wide', '../theme/antdTheme']) {
      expect(forbidden(bad), bad).toBe(true);
    }
    for (const ok of ['./Button', './icons', '@phosphor-icons/react', 'react', '../device', './FormFooter.viewport']) {
      expect(forbidden(ok), ok).toBe(false);
    }
  });

  it.each(OWN)('%s statik olarak antd/echarts/*.wide import etmez ve antd tabanlı Drawer sarmalayıcısını kullanmaz', name => {
    const file = resolve(UI_DIR, name);
    const specifiers = runtimeImports(file).map(ref => ref.specifier);
    expect(specifiers.filter(forbidden)).toEqual([]);
    // Drawer bugün antd Drawer'dır; ayrıntı paneli kendi yerel yan panelini kullanır (a05-sheet'e bağımlı değil).
    expect(specifiers).not.toContain('./Drawer');
  });

  // Bu kapı a11-detail dışındaki ortak bileşenlere de bakar (Button a01, Select a03, BottomSheet a05, Tag a08). Onlar
  // telefon sunumunu antd'siz yapınca yeşile döner; o zamana kadar kırmızı kalır ve zincir sahibini gösterir.
  it('statik import kapanışı telefon profilinde yasak modül içermez', () => {
    expect(closureViolations(OWN.map(name => resolve(UI_DIR, name)))).toEqual([]);
  });
});
