import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
// Hafif modüller statik yüklenir (antd yok): test gövdesinde dinamik import soğuk dönüşümü 5 sn test süresine yazar.
import { VIEW_LABELS, VIEW_MODES } from './shell/contracts';
import { adminGroups, adminLeads, currentAdminLink, settingsLink } from './shell/navigation';
// Barrel adları ui/index.ts kaynak metninden çözülür; antd + Pro + Phosphor grafiğini çalışma zamanında yüklemek bu
// iskelet kapısı için gereksizdi ve tam pakette yük altında zaman aşımına yol açıyordu. Her adın gerçekten bileşen
// (fonksiyon) olduğunu ui/barrel.test.ts çalışma zamanında doğrular.

/** ui/index.ts değer ihracatları (kaynak metinden). Yalnız `export { A } from './A'` ve `export type {…}` kabul edilir.
 *  Aynı çözümleyici ui/barrel.test.ts'te çalışma zamanı ihracatlarıyla birebir karşılaştırılır. */
function barrelValueExports(source: string): string[] {
  const statements = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
  return statements.flatMap((statement) => {
    if (/^export\s+type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]$/.test(statement)) return [];
    const match = /^export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]$/.exec(statement);
    if (!match) throw new Error(`ui/index.ts desteklenmeyen deyim: ${statement}`);
    return match[1].split(',').map((part) => part.trim()).filter((part) => part && !/^type\s/.test(part)).map((part) => part.split(/\s+as\s+/).pop()!);
  });
}

// A3 iskeleti: giriş noktası, Vite çoklu giriş, ui barrel, sözleşmeler ve bilgi mimarisi.
const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('admin scaffold', () => {
  it('admin.html exists with the admin root and entry script', () => {
    expect(existsSync(resolve(root, 'admin.html'))).toBe(true);
    const html = read('admin.html');
    expect(html).toContain('/src/admin/main.tsx');
    expect(html).toContain('<div id="admin-root">');
    expect(html).not.toContain('<!--app-startup-->');
    expect(html).not.toContain('<!--app-startup-failure-->');
    expect(html).toContain('<title>aile · yönetim</title>');
  });

  it('vite config has a second entry, isolated chunks and no admin precache', () => {
    const config = read('vite.config.ts');
    // Vite 8 bundles with rolldown; `rollupOptions` is only a deprecated alias of `rolldownOptions`.
    expect(config).toMatch(/roll(?:up|down)Options:\s*\{[\s\S]*?input:[\s\S]*?'admin\.html'/);
    expect(config).toContain('includeDependenciesRecursively: false');
    expect(config).toContain("'**/admin-*'");
    expect(config).toContain("'**/antd-*'");
    expect(config).toContain("'**/pro-*'");
    expect(config).toContain("'**/icons-*'");
    expect(config).toContain('navigateFallbackDenylist');
    expect(config).toContain("endsWith('index.html')");
  });

  it('ui barrel exports exactly the 32 shared wrapper names', () => {
    // A3 iskeletinin 17 sarmalayıcısı + P0b'de eklenen 15 ad (ui/barrel.test.ts ile aynı sözleşme).
    const scaffoldNames = ['Button', 'IconButton', 'TextField', 'Select', 'Table', 'Drawer', 'Dialog', 'Tabs', 'Menu', 'Tag', 'StatusText', 'Disclosure', 'FormFooter', 'LoadingShell', 'EmptyState', 'ErrorState', 'DataStatus'];
    const p0bNames = ['ResponsiveTable', 'AccordionList', 'BottomSheet', 'OverflowActions', 'PivotStack', 'ConflictView', 'FilterArea', 'ListRow', 'DetailPanel', 'Kanban', 'Timeline', 'Overview', 'Chart', 'Money', 'Icon'];
    const names = [...scaffoldNames, ...p0bNames];
    expect(names).toHaveLength(32);
    expect(new Set(names).size).toBe(32);
    expect(barrelValueExports(read('src/admin/ui/index.ts')).sort()).toEqual([...names].sort());
  });

  it('contracts expose six view modes with Turkish labels', () => {
    expect(VIEW_MODES).toEqual(['listing', 'table', 'timeline', 'kanban', 'gantt_chart', 'pivot']);
    expect(VIEW_LABELS).toEqual({ listing: 'Liste', table: 'Tablo', timeline: 'Zaman çizelgesi', kanban: 'Kanban', gantt_chart: 'Gantt', pivot: 'Pivot' });
  });

  it('navigation has 12 groups, a settings link and longest-match lookup', () => {
    expect(adminGroups).toHaveLength(12);
    expect(adminGroups.map(group => group.title)).toEqual(['Genel durum', 'Bütçe ve nakit', 'Ödemeler', 'Hesaplar ve borçlar', 'Emeklilik planı', 'Alımlar ve eşyalar', 'Ev ve odalar', 'Projeler ve görevler', 'Taraflar ve teklifler', 'Raporlar', 'Sözlükler ve iş akışları', 'Veri kalitesi ve içe aktarma']);
    expect(settingsLink).toEqual({ path: '/ayarlar', label: 'Ayarlar' });
    expect(currentAdminLink('/alimlar/123').label).toBe('Alımlar ve eşyalar');
    expect(currentAdminLink('/ayarlar').label).toBe('Ayarlar');
    expect(currentAdminLink('/bilinmeyen')).toBe(adminGroups[0].links[0]);
    for (const group of adminGroups) for (const link of group.links) expect(typeof adminLeads[link.path]).toBe('string');
    expect(typeof adminLeads['/ayarlar']).toBe('string');
  });
});
