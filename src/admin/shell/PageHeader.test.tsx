import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { DeviceContext } from '../device';
import { importsOf } from '../adaptive/sourceRules';
import type { Device, PageHeaderAction, PageHeaderSummary } from './contracts';
import { adminGroupTitle, currentAdminLink } from './navigation';
import { PageHeader } from './PageHeader';

// Tasarım: README.md "Sayfa iskeleti (sıra sabit)" 1–2, components/PageHeader/README.md, index.d.ts PageHeaderProps,
// bundle.js PageHeader. Sıra: bölüm (kucuk-orta, ikincil) → h1 (menü etiketi) → amaç → eylemler → DataStatus → özet (≤3,
// kutusuz tek satır) → children. Telefonda `more` "Diğer" düğmesine iner; tablet/masaüstünde ikincil düğmelerdir.
// document.title'a dokunmaz (kabuk yapar). Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok.

// Telefonda OverflowActions listeyi BottomSheet içinde açar; burada yalnız sözleşmesi taklit edilir (OverflowActions.test gibi).
vi.mock('../ui/BottomSheet', () => ({
  BottomSheet: (p: { title: string; children?: ReactNode; onClose?: () => void; open?: boolean }) =>
    p.open === false ? null : (
      <div role="dialog" aria-modal="true" aria-label={p.title}>
        <button type="button" onClick={p.onClose}>Kapat</button>
        {p.children}
      </div>
    ),
}));

const onDevice = (device: Device) => ({ children }: { children: ReactNode }) =>
  <DeviceContext.Provider value={device}>{children}</DeviceContext.Provider>;

const OKUMA = '2026-10-28T11:32:00Z';
const NESIL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function makeMore() {
  const disaAktar = vi.fn();
  const yazdir = vi.fn();
  const more: readonly PageHeaderAction[] = [
    { label: 'Dışa aktar', icon: 'download', onClick: disaAktar },
    { label: 'Yazdır', onClick: yazdir },
  ];
  return { more, disaAktar, yazdir };
}

const ucOzet: readonly PageHeaderSummary[] = [
  { label: 'Planlanan', value: '₺8.500,00', note: '12 kayıt' },
  { label: 'Gerçekleşen', value: '₺6.120,00' },
  { label: 'Fiyat yok', value: '3' },
];

/** a, DOM'da b'den önce mi? */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('PageHeader', () => {
  it('renders section → h1 → purpose → actions → status → summary → children in that order', () => {
    const { more } = makeMore();
    render(
      <PageHeader
        location="/alimlar"
        section="Alımlar ve eşyalar"
        title="Alımlar ve eşyalar"
        purpose="Alım kayıtlarını ve ev eşyalarını ara, filtrele ve güncelle."
        primary={<button type="button">Alım ekle</button>}
        more={more}
        status={{ state: 'fresh', lastReadAt: OKUMA, generationId: NESIL }}
        summary={ucOzet}
      >
        <p>Çocuk içerik</p>
      </PageHeader>,
      { wrapper: onDevice('desktop') },
    );
    const header = screen.getByRole('banner');
    const h1 = within(header).getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' });
    const section = within(header).getByText('Alımlar ve eşyalar', { selector: 'p' });
    const purpose = within(header).getByText('Alım kayıtlarını ve ev eşyalarını ara, filtrele ve güncelle.');
    const primary = within(header).getByRole('button', { name: 'Alım ekle' });
    const status = within(header).getByRole('status');
    const summary = within(header).getByRole('list', { name: 'Özet' });
    const child = within(header).getByText('Çocuk içerik');

    expect(before(section, h1)).toBe(true);
    expect(before(h1, purpose)).toBe(true);
    expect(before(purpose, primary)).toBe(true);
    expect(before(primary, status)).toBe(true);
    expect(before(status, summary)).toBe(true);
    expect(before(summary, child)).toBe(true);
    expect(status).toHaveTextContent('Son okuma');
    expect(status).toHaveTextContent('Nesil a1b2c3');
  });

  it('derives section and h1 from the navigation when not given, and keeps the legacy lead as purpose', () => {
    // Grup adı navigation.ts'ten türetilir (komşu görev metni değiştirebilir); beklenti aynı kaynaktan okunur.
    const link = currentAdminLink('/alimlar/abc');
    render(<PageHeader location="/alimlar/abc" lead="Eski amaç cümlesi" />, { wrapper: onDevice('desktop') });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(link.label);
    expect(screen.getByText(adminGroupTitle(link.path), { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Eski amaç cümlesi')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Özet' })).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows at most three summary measures; the fourth is cut, plan and actual stay separate entries', () => {
    const dort: readonly PageHeaderSummary[] = [...ucOzet, { label: 'Dördüncü', value: '99' }];
    render(<PageHeader location="/alimlar" summary={dort} />, { wrapper: onDevice('desktop') });
    const list = screen.getByRole('list', { name: 'Özet' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Planlanan');
    expect(items[0]).toHaveTextContent('₺8.500,00');
    expect(items[0]).toHaveTextContent('12 kayıt');
    expect(items[1]).toHaveTextContent('Gerçekleşen');
    expect(items[1]).toHaveTextContent('₺6.120,00');
    expect(items[2]).toHaveTextContent('Fiyat yok');
    expect(screen.queryByText('Dördüncü')).toBeNull();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('renders no summary list for an empty summary', () => {
    render(<PageHeader location="/alimlar" summary={[]} />, { wrapper: onDevice('desktop') });
    expect(screen.queryByRole('list', { name: 'Özet' })).toBeNull();
  });

  it.each<Device>(['desktop', 'tablet'])('%s: more actions are secondary buttons before the primary; no "Diğer"', async device => {
    const user = userEvent.setup();
    const { more, disaAktar } = makeMore();
    render(<PageHeader location="/alimlar" primary={<button type="button">Alım ekle</button>} more={more} />, { wrapper: onDevice(device) });
    const header = screen.getByRole('banner');
    const buttons = within(header).getAllByRole('button');
    expect(buttons.map(b => b.textContent?.trim())).toEqual(['Dışa aktar', 'Yazdır', 'Alım ekle']);
    expect(within(header).queryByRole('button', { name: 'Diğer' })).toBeNull();
    const disa = within(header).getByRole('button', { name: 'Dışa aktar' });
    expect(disa).toHaveAttribute('type', 'button');
    expect(disa.querySelector('svg[data-icon="download"]')).toHaveAttribute('aria-hidden', 'true');
    await user.click(disa);
    expect(disaAktar).toHaveBeenCalledTimes(1);
  });

  it('phone: header shows only the primary and a "Diğer" button; the more actions open from it', async () => {
    const user = userEvent.setup();
    const { more, yazdir } = makeMore();
    render(<PageHeader location="/alimlar" primary={<button type="button">Alım ekle</button>} more={more} />, { wrapper: onDevice('phone') });
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: 'Alım ekle' })).toBeInTheDocument();
    const diger = within(header).getByRole('button', { name: 'Diğer' });
    expect(within(header).queryByRole('button', { name: 'Yazdır' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Dışa aktar' })).toBeNull();
    const primaryEl = within(header).getByRole('button', { name: 'Alım ekle' });
    expect(before(primaryEl, diger)).toBe(true);

    await user.click(diger);
    const sheet = screen.getByRole('dialog', { name: 'Diğer eylemler' });
    await user.click(within(sheet).getByRole('menuitem', { name: 'Yazdır' }));
    expect(yazdir).toHaveBeenCalledTimes(1);
  });

  it('phone with only a primary and no more: no "Diğer" button', () => {
    render(<PageHeader location="/alimlar" primary={<button type="button">Alım ekle</button>} more={[]} />, { wrapper: onDevice('phone') });
    expect(screen.getByRole('button', { name: 'Alım ekle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diğer' })).toBeNull();
  });

  it('explicit actions replace the primary/more composition', () => {
    const { more } = makeMore();
    render(
      <PageHeader location="/alimlar" actions={<button type="button">Özel eylem</button>} primary={<button type="button">Alım ekle</button>} more={more} />,
      { wrapper: onDevice('desktop') },
    );
    expect(screen.getByRole('button', { name: 'Özel eylem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alım ekle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dışa aktar' })).toBeNull();
  });

  it('marks the narrow layout on phone and tablet, not on desktop', () => {
    const { rerender } = render(<PageHeader location="/alimlar" />, { wrapper: onDevice('desktop') });
    expect(screen.getByRole('banner')).toHaveAttribute('data-narrow', 'false');
    rerender(<PageHeader location="/alimlar" />);
    const { unmount } = render(<PageHeader location="/butce" />, { wrapper: onDevice('tablet') });
    expect(screen.getByRole('heading', { level: 1, name: 'Bütçe ve nakit' }).closest('header')).toHaveAttribute('data-narrow', 'true');
    unmount();
  });

  it('320 order: title block → actions → one context region (status, summary, page notes) in its own full row', () => {
    const { more } = makeMore();
    render(
      <PageHeader
        location="/veri"
        primary={<button type="button">İçe aktar</button>}
        more={more}
        status={{ state: 'fresh', lastReadAt: OKUMA, generationId: NESIL }}
        summary={ucOzet}
      >
        <p>Birinci not</p>
        <p>İkinci not</p>
      </PageHeader>,
      { wrapper: onDevice('phone') },
    );
    const header = screen.getByRole('banner');
    const regions = Array.from(header.children).map(child => (child.querySelector('h1') ? 'title' : (child as HTMLElement).dataset.part));
    expect(regions).toEqual(['title', 'actions', 'context']);
    const actions = header.querySelector<HTMLElement>(':scope > [data-part="actions"]')!;
    expect(within(actions).getAllByRole('button').map(button => button.textContent?.trim())).toEqual(['İçe aktar', 'Diğer']);
    const context = header.querySelector<HTMLElement>(':scope > [data-part="context"]')!;
    expect(within(context).getByRole('status')).toHaveTextContent('Son okuma');
    expect(within(context).getByRole('list', { name: 'Özet' })).toBeInTheDocument();
    expect(within(context).getByText('Birinci not')).toBeInTheDocument();
    expect(within(context).getByText('İkinci not')).toBeInTheDocument();
    expect(before(within(context).getByRole('status'), within(context).getByText('Birinci not'))).toBe(true);
  });

  it('desktop: page notes stay in the full-width context row, never in the actions column', () => {
    render(
      <PageHeader location="/veri" primary={<button type="button">İçe aktar</button>}>
        <p>Birinci not</p>
        <p>İkinci not</p>
      </PageHeader>,
      { wrapper: onDevice('desktop') },
    );
    const header = screen.getByRole('banner');
    expect(Array.from(header.children).map(child => (child.querySelector('h1') ? 'title' : (child as HTMLElement).dataset.part)))
      .toEqual(['title', 'actions', 'context']);
    expect(screen.getByText('İkinci not').closest('[data-part]')).toHaveAttribute('data-part', 'context');
  });

  it('renders no empty actions or context region', () => {
    render(<PageHeader location="/genel" />, { wrapper: onDevice('phone') });
    const header = screen.getByRole('banner');
    expect(header.querySelector('[data-part="actions"]')).toBeNull();
    expect(header.querySelector('[data-part="context"]')).toBeNull();
    expect(header.children).toHaveLength(1);
  });

  it('imports only the ui modules it renders: no ui barrel, no antd, ECharts or wide module (phone delivery)', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PageHeader.tsx'), 'utf8');
    const specifiers = importsOf(source).filter(ref => !ref.typeOnly).map(ref => ref.specifier);
    expect(specifiers.filter(specifier => /^\.\.\/ui(?:\/index)?$/.test(specifier)), 'ui barrel').toEqual([]);
    expect(specifiers.filter(specifier => /(^|\/)(antd|@ant-design|echarts|zrender)(\/|$)|ui\/antd|\.wide$/.test(specifier))).toEqual([]);
    expect(specifiers.filter(specifier => specifier.startsWith('../ui/')).sort()).toEqual(['../ui/Button', '../ui/DataStatus', '../ui/OverflowActions']);
  });

  it('does not touch document.title (the shell owns it)', () => {
    document.title = 'önceki';
    render(<PageHeader location="/alimlar" title="Alımlar ve eşyalar" />, { wrapper: onDevice('desktop') });
    expect(document.title).toBe('önceki');
  });
});
