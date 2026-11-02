import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import IconBase from '@phosphor-icons/react/dist/lib/IconBase';
import type { IconWeight } from '@phosphor-icons/react/dist/lib/types';
import { Icon, ICON_NAMES, preloadIcons, type IconName } from './icons';
import { REGULAR_QUERY, phosphorRegularOnly, regularIconModule, regularWeight } from './icons.build';

// Derleme eklentisi (icons.build.ts) yönetim simgelerini Phosphor tanımının yalnız regular ağırlığıyla paketler. Bu
// testler çıktının paketin kendi bileşeniyle birebir aynı SVG olduğunu (23 simge), üretilen modülün tek ağırlık
// taşıdığını ve eklentinin yalnız ui/icons(.extra).tsx importlarına dokunduğunu sınar. Vitest ve geliştirme sunucusu
// paketin kendisini kullanır (eklenti apply: 'build'); karşılaştırma bu yüzden doğrudan paket çıktısıyladır.

/** Tasarım adı → Phosphor simge adı (icons.tsx ve icons.extra.tsx eşlemesi). */
const PHOSPHOR: Record<IconName, string> = {
  menu: 'List', close: 'X', search: 'MagnifyingGlass', filter: 'Funnel', refresh: 'ArrowsClockwise', chevronDown: 'CaretDown',
  chevronRight: 'CaretRight', back: 'ArrowLeft', check: 'Check', plus: 'Plus', download: 'DownloadSimple', more: 'DotsThree',
  alert: 'Warning', info: 'Info', imageOff: 'ImageBroken', sheet: 'Table', settings: 'Gear', external: 'ArrowSquareOut',
  sort: 'SortAscending', edit: 'PencilSimple', calendar: 'CalendarBlank', undo: 'ArrowCounterClockwise', compare: 'Columns',
};
const WEIGHTS = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'];

// Paket dışa aktarım haritası dist/defs'i açmaz; require koşulu dist/index.cjs.js'e çözülür, tanımlar onun yanındadır.
const DIST = dirname(createRequire(import.meta.url).resolve('@phosphor-icons/react/dist/csr/Gear'));
const defsOf = (name: string) => readFileSync(join(DIST, 'defs', `${name}.es.js`), 'utf8');

/** Üretilen modülün weights Map'i: regular ifadesi paketin React ad alanıyla değerlendirilir. */
function regularMap(name: string): Map<IconWeight, React.ReactElement> {
  const { react, expression } = regularWeight(defsOf(name));
  const element = new Function(react, `return (${expression});`)(React) as React.ReactElement;
  return new Map<IconWeight, React.ReactElement>([['regular', element]]);
}

describe('Phosphor regular-only derleme eklentisi', () => {
  beforeAll(async () => { await preloadIcons(); });

  it.each([...ICON_NAMES])('%s: regular-only modül paket bileşeniyle aynı SVG’yi çizer', name => {
    const props = { className: 'aile-sinama', 'data-icon': name, 'aria-hidden': true as const };
    const fromPackage = renderToStaticMarkup(<Icon name={name} className="aile-sinama" />);
    const regularOnly = renderToStaticMarkup(
      React.createElement(IconBase, { size: 20, weight: 'regular', color: 'currentColor', ...props, weights: regularMap(PHOSPHOR[name]) }),
    );
    expect(fromPackage).toMatch(/<path /);
    expect(regularOnly).toBe(fromPackage);
  });

  it('üretilen modül yalnız regular ağırlığını taşır; IconBase ve iki ad dışa verilir', () => {
    const code = regularIconModule('Gear', defsOf('Gear'), '/dist/lib/IconBase.es.js');
    const source = defsOf('Gear');
    for (const weight of WEIGHTS) expect(source).toContain(`"${weight}"`);
    expect(code.match(/"(?:thin|light|regular|bold|fill|duotone)"/g)).toEqual(['"regular"']);
    expect(code).toContain('import __aileIconBase from "/dist/lib/IconBase.es.js";');
    expect(code).toMatch(/export \{ __aileIcon as Gear, __aileIcon as GearIcon \};$/);
    expect(code.length).toBeLessThan(source.length / 3);
  });

  it('regular girdisi yoksa ya da kapanmıyorsa açık hata verir (paket biçimi değişirse derleme durur)', () => {
    expect(() => regularWeight('import * as a from "react"; const l = new Map([["bold", a.createElement("path")]]);')).toThrow(/regular/);
    expect(() => regularWeight('const l = new Map([["regular", 1]]);')).toThrow(/react/);
    expect(() => regularWeight('import * as a from "react"; const l = new Map([["regular", a.createElement("path", { d: "M0" })')).toThrow(/kapanmıyor/);
  });

  it('yalnız derlemede ve yalnız ui/icons(.extra).tsx içindeki dist/csr importlarına dokunur', async () => {
    const plugin = phosphorRegularOnly();
    expect(plugin.apply).toBe('build');
    const csr = join(DIST, 'csr', 'Gear.es.js');
    const context = { resolve: async () => ({ id: csr, external: false }) };
    const resolveId = plugin.resolveId as unknown as (this: typeof context, source: string, importer: string | undefined, options: object) => Promise<string | null>;
    const icons = '/depo/src/admin/ui/icons.tsx';
    expect(await resolveId.call(context, '@phosphor-icons/react/dist/csr/Gear', icons, {})).toBe(`${csr}${REGULAR_QUERY}`);
    expect(await resolveId.call(context, '@phosphor-icons/react/dist/csr/Gear', '/depo/src/admin/ui/icons.extra.tsx', {})).toBe(`${csr}${REGULAR_QUERY}`);
    expect(await resolveId.call(context, '@phosphor-icons/react/dist/csr/Gear', '/depo/src/app/shell/Fab.tsx', {})).toBeNull();
    expect(await resolveId.call(context, '@phosphor-icons/react', icons, {})).toBeNull();
    expect(await resolveId.call(context, './Button', icons, {})).toBeNull();
    const load = plugin.load as unknown as (id: string) => string | null;
    expect(load(csr)).toBeNull();
    const code = load(`${csr}${REGULAR_QUERY}`)!;
    expect(code).toContain(JSON.stringify(join(DIST, 'lib', 'IconBase.es.js')));
    expect(code.match(/"(?:thin|light|regular|bold|fill|duotone)"/g)).toEqual(['"regular"']);
  });
});
