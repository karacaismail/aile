import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PivotStack } from './PivotStack';

// Tasarım › components/PivotStack/README.md: pivotun telefondaki biçimi; satır boyutu dış katman, sütun değerleri
// açılınca alt alta. Üstte genel toplam; her satırın kapalı başlığında satır toplamı (Planlanan / Gerçekleşen ayrı).
// Boş hücre "Kayıt yok"; eksik plan "Fiyat yok", eksik gerçek "Henüz yok". Plan ve gerçek asla tek sayıda birleşmez.
// Para ₺8.500,00 (tr-TR, 2 ondalık). İlk satır açık gelir (AccordionList kuralı); birden çok satır açık kalabilir.
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

// Sentetik örnek (tasarım bundle.js PIVOT fixture'ının alt kümesi); gerçek aile verisi değildir.
const COLUMNS = ['Önce', 'Yerleşme', 'Sonra', 'Bilinmiyor'];
const ROWS: [string, [number | null, number | null][]][] = [
  ['Bebek odası', [[24500, 16820], [12000, 8400], [3500, 2160], [2000, null]]], // plan 42.000 · gerçek 27.380
  ['Mutfak', [[30000, 4120], [12000, null], [4000, null], [null, null]]], // plan 46.000 · gerçek 4.120
  ['Çalışma odası', [[null, null], [6800, 6400], [3000, 2525.9], [null, null]]], // plan 9.800 · gerçek 8.925,90
];

const rowButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const regionOf = (button: HTMLElement) => {
  const id = button.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const region = document.getElementById(id!);
  expect(region).not.toBeNull();
  return region!;
};

describe('PivotStack', () => {
  it('üstte genel toplam: varsayılan "Genel toplam", Planlanan ve Gerçekleşen ayrı, ₺ tr-TR iki ondalık', () => {
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const total = screen.getByRole('group', { name: 'Genel toplam' });
    expect(within(total).getByText('Planlanan')).toBeVisible();
    expect(within(total).getByText('₺97.800,00')).toBeVisible();
    expect(within(total).getByText('Gerçekleşen')).toBeVisible();
    expect(within(total).getByText('₺40.425,90')).toBeVisible();
    // Tek sayıya indirgenmez: toplam metninde iki tutar ayrı düğümdedir, "/" ya da toplam farkı yoktur.
    expect(total.textContent).not.toMatch(/₺[^₺]*\/\s*₺/);
    expect(total.textContent).not.toContain('₺138.225,90');
  });

  it('totalLabel ve caption dışarıdan gelir', () => {
    render(<PivotStack columns={COLUMNS} rows={ROWS} caption="3 oda · 4 aşama" totalLabel="Toplam" />);
    expect(screen.getByRole('group', { name: 'Toplam' })).toBeInTheDocument();
    expect(screen.queryByText('Genel toplam')).toBeNull();
    expect(screen.getByText('3 oda · 4 aşama')).toBeVisible();
  });

  it('satırlar açılır başlıklardır: ilk satır açık, diğerleri hidden+inert bölge', () => {
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const first = rowButton('Bebek odası');
    expect(first).toHaveAttribute('type', 'button');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('data-focus-line');
    const firstRegion = regionOf(first);
    expect(firstRegion).toHaveAttribute('role', 'region');
    expect(firstRegion).toHaveAttribute('aria-labelledby', first.id);
    expect(firstRegion).not.toHaveAttribute('hidden');
    expect(firstRegion).not.toHaveAttribute('inert');

    const second = rowButton('Mutfak');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    const secondRegion = regionOf(second);
    expect(secondRegion).toHaveAttribute('hidden');
    expect(secondRegion).toHaveAttribute('inert');
    expect(rowButton('Çalışma odası')).toHaveAttribute('aria-expanded', 'false');
  });

  it('firstOpen=false ile hiçbir satır açık başlamaz', () => {
    render(<PivotStack columns={COLUMNS} rows={ROWS} firstOpen={false} />);
    for (const [label] of ROWS) expect(rowButton(label)).toHaveAttribute('aria-expanded', 'false');
  });

  it('kapalı başlıkta satır toplamı Planlanan / Gerçekleşen ayrı yazılır', () => {
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const mutfak = rowButton('Mutfak');
    expect(within(mutfak).getByText('Planlanan')).toBeInTheDocument();
    expect(within(mutfak).getByText('₺46.000,00')).toBeInTheDocument();
    expect(within(mutfak).getByText('Gerçekleşen')).toBeInTheDocument();
    expect(within(mutfak).getByText('₺4.120,00')).toBeInTheDocument();

    const calisma = rowButton('Çalışma odası');
    expect(within(calisma).getByText('₺9.800,00')).toBeInTheDocument();
    expect(within(calisma).getByText('₺8.925,90')).toBeInTheDocument();
  });

  it('açık satırda her sütun ayrı: Planlanan/Gerçekleşen; eksik plan "Fiyat yok", eksik gerçek "Henüz yok", boş hücre "Kayıt yok"', async () => {
    const user = userEvent.setup();
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const mutfak = rowButton('Mutfak');
    await user.click(mutfak);
    const region = regionOf(mutfak);
    expect(region).not.toHaveAttribute('hidden');

    // Dört sütun adı görünür; boş hücre (Bilinmiyor) Planlanan/Gerçekleşen çifti yerine "Kayıt yok" der.
    for (const column of COLUMNS) expect(within(region).getByText(column)).toBeVisible();
    expect(within(region).getAllByText('Planlanan')).toHaveLength(3);
    expect(within(region).getAllByText('Gerçekleşen')).toHaveLength(3);
    expect(within(region).getByText('Kayıt yok')).toBeVisible();
    expect(within(region).getAllByText('Henüz yok')).toHaveLength(2); // Yerleşme, Sonra
    expect(within(region).queryByText('Fiyat yok')).toBeNull();
    expect(within(region).getByText('₺30.000,00')).toBeVisible();
    expect(within(region).getByText('₺4.120,00')).toBeVisible();

    const calisma = rowButton('Çalışma odası');
    await user.click(calisma);
    const calismaRegion = regionOf(calisma);
    expect(within(calismaRegion).getAllByText('Kayıt yok')).toHaveLength(2); // Önce, Bilinmiyor
    expect(within(calismaRegion).getByText('₺2.525,90')).toBeVisible();
  });

  it('planı hiç olmayan satırın toplamı ₺0,00 değil "Fiyat yok"; gerçeği olmayan "Henüz yok"', () => {
    const rows: [string, [number | null, number | null][]][] = [
      ['Depo', [[null, null], [null, null]]],
      ['Balkon', [[null, 500], [null, 250]]],
    ];
    render(<PivotStack columns={['Önce', 'Sonra']} rows={rows} />);
    const depo = rowButton('Depo');
    expect(within(depo).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(depo).getByText('Henüz yok')).toBeInTheDocument();
    expect(within(depo).queryByText('₺0,00')).toBeNull();

    const balkon = rowButton('Balkon');
    expect(within(balkon).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(balkon).getByText('₺750,00')).toBeInTheDocument();

    const total = screen.getByRole('group', { name: 'Genel toplam' });
    expect(within(total).getByText('Fiyat yok')).toBeInTheDocument();
    expect(within(total).getByText('₺750,00')).toBeInTheDocument();
  });

  it('tıklama açar/kapar; birden çok satır aynı anda açık kalabilir', async () => {
    const user = userEvent.setup();
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const first = rowButton('Bebek odası');
    const second = rowButton('Mutfak');
    await user.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(regionOf(second)).not.toHaveAttribute('inert');

    await user.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(regionOf(second)).toHaveAttribute('hidden');
    expect(regionOf(second)).toHaveAttribute('inert');
    expect(first).toHaveAttribute('aria-expanded', 'true');
  });

  it('klavyede Enter açar, Space kapatır', async () => {
    const user = userEvent.setup();
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const second = rowButton('Mutfak');
    second.focus();
    await user.keyboard('{Enter}');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('[Space]');
    expect(second).toHaveAttribute('aria-expanded', 'false');
  });

  it('"Tümünü aç" bütün satırları açar, sonra "Tümünü kapat" olur ve hepsini kapatır', async () => {
    const user = userEvent.setup();
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    await user.click(screen.getByRole('button', { name: 'Tümünü aç' }));
    for (const [label] of ROWS) expect(rowButton(label)).toHaveAttribute('aria-expanded', 'true');

    const closeAll = screen.getByRole('button', { name: 'Tümünü kapat' });
    expect(screen.queryByRole('button', { name: 'Tümünü aç' })).toBeNull();
    await user.click(closeAll);
    for (const [label] of ROWS) expect(rowButton(label)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Tümünü aç' })).toBeInTheDocument();
  });

  it('satır yoksa dürüst boş durum: "Kayıt yok", toplam yok', () => {
    render(<PivotStack columns={COLUMNS} rows={[]} />);
    expect(screen.getByText('Kayıt yok')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Genel toplam' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tümünü aç' })).toBeNull();
  });

  it('ok simgesi süsleyicidir; tutarlar tabular; antd Collapse yok; CSS tokenlardan, halka/outline yok', () => {
    render(<PivotStack columns={COLUMNS} rows={ROWS} />);
    const first = rowButton('Bebek odası');
    const chevron = first.querySelector('svg[data-icon="chevronDown"]');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(within(first).getByText('₺42.000,00')).toHaveClass('aile-tutar');

    const tsx = read('PivotStack.tsx');
    expect(tsx).not.toMatch(/import[^;]*\bCollapse\b|<Collapse\b/);
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design|@phosphor-icons|echarts)/);
    expect(tsx).toContain("import './PivotStack.css'");

    const css = read('PivotStack.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/^\s*(outline|box-shadow)\s*:/m);
    expect(css).toMatch(/var\(--aile-sure\)/);
    expect(css).toMatch(/var\(--aile-egri\)/);
    expect(css).toMatch(/var\(--aile-hedef-asgari\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/tabular-nums/);
    // Sabit px yok; tek istisna 1 px ayırıcı çizgi (cizgi). Metin boyutu 14 px altına inmez.
    const fixedPx = (css.match(/\b\d+px\b/g) ?? []).filter(value => value !== '1px');
    expect(fixedPx).toEqual([]);
    expect(css).not.toMatch(/font-size:\s*(1[0-3]|[0-9])px/);
  });
});
