import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { wideManifest } from '../adaptive';
import { wideRuleViolations } from '../adaptive/sourceRules';
import { DeviceContext } from '../device';
import type { Device, QueryBarProps, SavedView } from './contracts';
import { QueryBar } from './QueryBar';

// Uyarlamalı teslim (W0 sözleşmesi): telefon profili geniş-özel kodu indirmez. QueryBar'ın tek geniş-özel parçası
// masaüstündeki "Kayıtlı görünüm" seçimidir; ./QueryBar.wide modülünde durur ve lazyWide ile yalnız geniş profilde
// yüklenir. Bu dosya ayrı tutulur: lazyWide kaynağı modül düzeyinde önbelleklenir, "telefonda indirilmedi" gözlemi
// başka testlerin masaüstü yüklemesinden etkilenmemelidir.

const KEY = 'querybar-kayitli-gorunum';
const durum = () => wideManifest().find(entry => entry.key === KEY)?.status;

function props(views: readonly SavedView[], search = ''): QueryBarProps {
  return {
    mode: 'listing', onModeChange: vi.fn(), supported: ['listing', 'table'], search, onSearchChange: vi.fn(),
    activeFilters: [], onOpenFilters: vi.fn(), resultCount: 3, savedViews: views,
  };
}

const on = (device: Device, children: ReactNode) => <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;

describe('QueryBar › geniş-özel parça (lazyWide)', () => {
  it('telefon ve tablet geniş modülü istemez; masaüstünde "Kayıtlı görünüm" geniş modülden gelir, seçim onSelect çağırır; telefona dönüşte arama korunur', async () => {
    const user = userEvent.setup();
    const views: readonly SavedView[] = [
      { id: 'tum', label: 'Tüm alımlar', onSelect: vi.fn(), active: true },
      { id: 'bebek', label: 'Bebek odası hazırlığı', onSelect: vi.fn() },
    ];
    const { rerender } = render(on('phone', <QueryBar {...props(views, 'kase')} />));
    await act(async () => { await Promise.resolve(); });
    expect(durum(), 'geniş kaynak tanımlı değil ya da telefonda yüklendi').toBe('idle');
    expect(screen.queryByRole('combobox', { name: 'Kayıtlı görünüm' })).toBeNull();

    rerender(on('tablet', <QueryBar {...props(views, 'kase')} />));
    await act(async () => { await Promise.resolve(); });
    expect(durum(), 'tablet dar düzendedir; kayıtlı görünüm modülü istenmemeli').toBe('idle');

    rerender(on('desktop', <QueryBar {...props(views, 'kase')} />));
    const gorunum = await screen.findByRole('combobox', { name: 'Kayıtlı görünüm' });
    expect(durum()).toBe('ready');
    expect(screen.getByText('Tüm alımlar')).toBeInTheDocument();
    await user.click(gorunum);
    await user.click(await screen.findByRole('option', { name: 'Bebek odası hazırlığı' }));
    expect(views[1].onSelect).toHaveBeenCalledTimes(1);
    expect(views[0].onSelect).not.toHaveBeenCalled();

    rerender(on('phone', <QueryBar {...props(views, 'kase')} />));
    expect(screen.queryByRole('combobox', { name: 'Kayıtlı görünüm' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('kase');
  });

  it('kaynak: geniş modül yalnız lazyWide ile (statik import yok), *.wide kuralına uyar ve antd importu yok', () => {
    const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');
    const bar = read('QueryBar.tsx');
    const wide = read('QueryBar.wide.tsx');
    expect(bar).toMatch(/lazyWide<[^>]+>\(\s*'querybar-kayitli-gorunum',\s*\(\)\s*=>\s*import\('\.\/QueryBar\.wide'\)\s*\)/);
    expect(wideRuleViolations('src/admin/shell/QueryBar.tsx', bar)).toEqual([]);
    expect(wideRuleViolations('src/admin/shell/QueryBar.wide.tsx', wide)).toEqual([]);
    for (const source of [bar, wide]) {
      expect(source).not.toMatch(/from\s+['"](antd|@ant-design)/);
      expect(source).not.toMatch(/from\s+['"]\.\.\/ui\/antd['"]/);
    }
  });
});
