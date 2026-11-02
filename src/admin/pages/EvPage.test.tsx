// Ev ve odalar sayfası: sentetik nesil (fixtures/generation-synthetic) GenerationProvider + FixtureGenerationSource ile
// belleğe okunur; depo, kaynak, indeks ve hook katmanları gerçektir. Değişiklik kümesi kapalıdır (changeSet={null}):
// IndexedDB yok. Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Beklenen tutarlar fixture'dan
// bağımsız aritmetikle (kuruş tam sayı) hesaplanır; plan ve gerçek ayrı sütun ve ayrı özet olarak doğrulanır.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GenerationProvider } from '../data';
import { FixtureGenerationSource, type GenerationSource } from '../data/sources';
import type { Manifest, PurchaseNeedRecord, Relation, Room } from '../data/types';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { EvPage } from './EvPage';

// --- Sentetik nesil → bellek -------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const GENERATION_DIR = join(FIXTURE_ROOT, GENERATION_ID);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const FILES: Record<string, string> = Object.fromEntries(
  walk(GENERATION_DIR)
    .map((full) => relative(GENERATION_DIR, full))
    .filter((rel) => rel === 'manifest.json' || rel.startsWith('data/'))
    .map((rel) => [rel, readFileSync(join(GENERATION_DIR, rel), 'utf8')]),
);

const records = <R,>(path: string): R[] => (JSON.parse(FILES[path]!) as { records: R[] }).records;
const ROOMS = records<Room>('data/rooms/household/00000.json');
const NEEDS = records<PurchaseNeedRecord>('data/purchase_needs/household/00000.json');
const LAYOUT = records<PurchaseNeedRecord>('data/layout_items/household/00000.json');
const LIGHTING = records<PurchaseNeedRecord>('data/lighting_specs/household/00000.json');
const RELATIONS = records<Relation>('data/relations/household/00000.json');

const ODA_3 = ROOMS.find((room) => room.code === 'oda_3')!;
const ODA_3_ESYA = LAYOUT.find((item) => item.room_id === ODA_3.id)!;
const ODA_3_ARMATUR = LIGHTING.find((item) => item.room_id === ODA_3.id)!;
const ODA_3_BAGLI_ALIM = RELATIONS.filter((rel) => rel.kind === 'located_in' && rel.target_id === ODA_3.id).length;
const ODASIZ_ALIM = NEEDS.filter((need) => !need.room_id).length;

/** Kuruş tam sayı toplamı → tr-TR para metni; panelin Money bileşeninden bağımsız hesap. */
function toplamTl(values: readonly ({ amount: string; currency: string } | null | undefined)[]): string {
  let kurus = 0n;
  for (const value of values) {
    if (!value) continue;
    const [lira, ondalik = ''] = value.amount.split('.');
    kurus += BigInt(lira) * 100n + BigInt(`${ondalik}00`.slice(0, 2));
  }
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    `${kurus / 100n}.${String(kurus % 100n).padStart(2, '0')}` as `${number}`,
  );
}
const PLANLANAN_TOPLAM = toplamTl(NEEDS.map((need) => need.amounts.planned));
const GERCEK_TOPLAM = toplamTl(NEEDS.map((need) => need.amounts.actual));

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** rooms koleksiyonu nesilde hiç yok: manifest parçaları ve sayımı silinir (depo boş ve hatasız döner). */
function odasizManifest(): string {
  const manifest = JSON.parse(FILES['manifest.json']!) as Manifest;
  const counts = { ...manifest.counts };
  delete counts.rooms;
  return JSON.stringify({ ...manifest, counts, files: manifest.files.filter((file) => file.collection !== 'rooms') });
}

const bozukKaynak: GenerationSource = {
  kind: 'fixture',
  label: 'bozuk',
  readText: async (path) => {
    throw new Error(`Nesil okunamadı: ${path}`);
  },
};

function renderPage(device: Device = 'desktop', source: GenerationSource = fixtureSource()) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source} cache={null} changeSet={null}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<EvPage />, { wrapper: Wrapper });
}

const odalarTablosu = () => screen.getByRole('table', { name: 'Odalar' });
/** antd başlığı ayrı bir <table> içinde çizer; sütun başlıkları ResponsiveTable kökünden (kendi sınıfımız) okunur. */
const sutunlar = (table: HTMLElement) =>
  within(table.closest<HTMLElement>('.aile-rtable')!).getAllByRole('columnheader').map((cell) => cell.textContent?.trim());

describe('EvPage › başlık ve veri durumları', () => {
  it('yüklenirken aynı yerleşimde iskelet gösterir, veri gelince odalar tablosu çizilir', async () => {
    renderPage();
    // DataStatus da role="status" taşır; iskelet metniyle ayrılır.
    expect(screen.getByText('Yükleniyor').closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    expect(screen.queryByText('Yükleniyor')).not.toBeInTheDocument();
  });

  it('bölüm → h1 → amaç sırası ve ≤3 özet: Oda, Planlanan ve Gerçekleşen ayrı ölçülerdir', async () => {
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    expect(screen.getByText('Ev')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ev ve odalar' })).toBeInTheDocument();
    expect(screen.getByText('Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.')).toBeInTheDocument();

    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Oda');
    expect(olculer[0]).toHaveTextContent(String(ROOMS.length));
    expect(olculer[0]).toHaveTextContent(`+${ODASIZ_ALIM} alım odasız`);
    expect(olculer[1]).toHaveTextContent('Planlanan');
    expect(olculer[1]).toHaveTextContent(PLANLANAN_TOPLAM);
    expect(olculer[2]).toHaveTextContent('Gerçekleşen');
    expect(olculer[2]).toHaveTextContent(GERCEK_TOPLAM);
    expect(PLANLANAN_TOPLAM).not.toBe(GERCEK_TOPLAM);
  });

  it('tazelik satırı nesil kimliğini ve son okumayı yazar', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(`Nesil ${GENERATION_ID.slice(0, 6)}`)).toBeInTheDocument());
    expect(screen.getByText(/^Son okuma /)).toBeInTheDocument();
  });

  it('rooms koleksiyonu nesilde yoksa dürüst metin: "Kaynakta oda kaydı yok"', async () => {
    renderPage('desktop', fixtureSource({ 'manifest.json': odasizManifest() }));
    const baslik = await screen.findByRole('heading', { level: 2, name: 'Kaynakta oda kaydı yok' });
    expect(baslik.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('nesil okunamazsa ErrorState: "Hata: …" + Yeniden dene; tutar gösterilmez', async () => {
    renderPage('desktop', bozukKaynak);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^Hata: /);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(screen.queryByText(PLANLANAN_TOPLAM)).not.toBeInTheDocument();
  });
});

describe('EvPage › oda listesi', () => {
  it('her oda bir satırdır, odasız alımlar "Oda bilinmiyor" satırında; Planlanan ve Gerçekleşen ayrı sütunlardır', async () => {
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    const table = odalarTablosu();
    const basliklar = sutunlar(table);
    expect(basliklar).toContain('Planlanan');
    expect(basliklar).toContain('Gerçekleşen');
    // Gövde tablosu yalnız veri satırlarını taşır (başlık ayrı tabloda).
    const satirlar = within(table).getAllByRole('row');
    expect(satirlar).toHaveLength(ROOMS.length + 1);
    for (const room of ROOMS) expect(within(table).getByText(room.label!)).toBeInTheDocument();
    expect(within(table).getByText('Oda bilinmiyor')).toBeInTheDocument();
  });

  it('bağlı alım sayısı relations (located_in) ile sayılır; gerçekleşen yoksa "Henüz yok" yazar', async () => {
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    const satir = within(odalarTablosu()).getByText(ODA_3.label!).closest('tr')!;
    expect(satir).toHaveTextContent(`${ODA_3_BAGLI_ALIM} alım`);
    const odaGercek = NEEDS.filter((need) => need.room_id === ODA_3.id && need.amounts.actual);
    if (odaGercek.length === 0) expect(satir).toHaveTextContent('Henüz yok');
    else expect(satir).toHaveTextContent(toplamTl(odaGercek.map((need) => need.amounts.actual)));
    expect(satir).toHaveTextContent(toplamTl(NEEDS.filter((need) => need.room_id === ODA_3.id).map((need) => need.amounts.planned)));
  });

  it('planlanan ya da gerçekleşen tutar ₺ ve iki ondalıkla, eksik tutar adıyla yazılır', async () => {
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    const hucreler = within(odalarTablosu()).getAllByRole('cell').map((cell) => cell.textContent ?? '');
    expect(hucreler.some((text) => /^₺\d{1,3}(\.\d{3})*,\d{2}$/.test(text))).toBe(true);
    expect(hucreler.some((text) => text === '0' || text === '₺0,00')).toBe(false);
  });
});

describe('EvPage › oda ayrıntısı: eşyalar ve aydınlatma sekmeleri', () => {
  it('oda seçince Eşyalar sekmesi açılır; zamanlı yerleşim yoksa "Henüz yok"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    await user.click(within(odalarTablosu()).getByText(ODA_3.label!));

    expect(screen.getByRole('heading', { level: 2, name: ODA_3.label! })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Eşyalar' })).toHaveAttribute('aria-selected', 'true');
    const esyalar = screen.getByRole('table', { name: 'Eşyalar' });
    expect(within(esyalar).getByText(ODA_3_ESYA.label!)).toBeInTheDocument();
    expect(sutunlar(esyalar)).toContain('Yerleşim tarihi');
    const satir = within(esyalar).getByText(ODA_3_ESYA.label!).closest('tr')!;
    expect(satir).toHaveTextContent('Henüz yok');
  });

  it('Aydınlatma sekmesi odanın armatürlerini lümen ve renk sıcaklığıyla listeler', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    await user.click(within(odalarTablosu()).getByText(ODA_3.label!));
    await user.click(screen.getByRole('tab', { name: 'Aydınlatma' }));

    expect(screen.getByRole('tab', { name: 'Aydınlatma' })).toHaveAttribute('aria-selected', 'true');
    const aydinlatma = screen.getByRole('table', { name: 'Aydınlatma' });
    const satir = within(aydinlatma).getByText(ODA_3_ARMATUR.label!).closest('tr')!;
    expect(satir).toHaveTextContent(`${String(ODA_3_ARMATUR.attributes!.lumen)} lm`);
    expect(satir).toHaveTextContent(`${String(ODA_3_ARMATUR.attributes!.renk_sicakligi_k)} K`);
    expect(screen.queryByRole('table', { name: 'Eşyalar' })).not.toBeInTheDocument();
  });

  it('odada eşya kaydı yoksa sekme dürüst metin yazar', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(odalarTablosu()).toBeInTheDocument());
    const esyasiz = ROOMS.find((room) => !LAYOUT.some((item) => item.room_id === room.id))!;
    await user.click(within(odalarTablosu()).getByText(esyasiz.label!));
    expect(screen.getByRole('heading', { level: 2, name: 'Kaynakta bu oda için eşya kaydı yok' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Eşyalar' })).not.toBeInTheDocument();
  });

  it('telefonda ayrıntı listenin yerini alır ve "Listeye dön" geri getirir', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    // Akordeon grubu caption ile adlandırılmış bölgedir (AccordionList: section[aria-label]); ilk satır açık gelir.
    const liste = await screen.findByRole('region', { name: 'Odalar' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(within(liste).getAllByRole('button', { name: 'Ayrıntıyı aç' })[0]!);
    expect(screen.queryByRole('region', { name: 'Odalar' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Eşyalar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Listeye dön' }));
    expect(screen.getByRole('region', { name: 'Odalar' })).toBeInTheDocument();
  });
});
