// Ev ve odalar sayfası: sentetik nesil (fixtures/generation-synthetic) GenerationProvider + FixtureGenerationSource ile
// belleğe okunur; depo, kaynak, indeks ve hook katmanları gerçektir. Değişiklik kümesi kapalıdır (changeSet={null}):
// IndexedDB yok. Profil DeviceContext.Provider ile zorlanır; geniş (tablet/masaüstü) sunum lazyWide ile ayrı modülden
// gelir, bu yüzden geniş testleri ilk çizimi find* ile bekler. Seçiciler role/label ile; ui iç sınıflarına bağlı seçici
// yok. Beklenen tutarlar fixture'dan bağımsız aritmetikle (kuruş tam sayı) hesaplanır; plan ve gerçek ayrı doğrulanır.
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
const canli = <R extends { deleted_at?: string | null }>(list: readonly R[]) => list.filter((item) => !item.deleted_at);
const ROOMS = canli(records<Room>('data/rooms/household/00000.json'));
const ALL_NEEDS = records<PurchaseNeedRecord>('data/purchase_needs/household/00000.json');
const NEEDS = canli(ALL_NEEDS);
const WORKS = canli(records<PurchaseNeedRecord>('data/work_orders/household/00000.json'));
const LAYOUT = canli(records<PurchaseNeedRecord>('data/layout_items/household/00000.json'));
const LIGHTING = canli(records<PurchaseNeedRecord>('data/lighting_specs/household/00000.json'));
const RELATIONS = records<Relation>('data/relations/household/00000.json');

const ODA_3 = ROOMS.find((room) => room.code === 'oda_3')!;
const ODA_3_ALIM = NEEDS.filter((need) => need.room_id === ODA_3.id);
const ODA_3_IS = WORKS.filter((work) => work.room_id === ODA_3.id);
const ODA_3_ESYA = LAYOUT.find((item) => item.room_id === ODA_3.id)!;
const ODA_3_ARMATUR = LIGHTING.find((item) => item.room_id === ODA_3.id)!;
const ODASIZ_ALIM = NEEDS.filter((need) => !need.room_id).length;
const sirali = (labels: readonly string[]) => [...labels].sort((a, b) => a.localeCompare(b, 'tr-TR'));

/** Kuruş tam sayı toplamı → tr-TR para metni; panelin Money bileşeninden bağımsız hesap. */
function toplamTl(values: readonly ({ amount: string; currency: string } | null | undefined)[]): string {
  let kurus = 0n;
  for (const value of values) {
    if (!value) continue;
    const [lira, ondalik = ''] = value.amount.split('.');
    kurus += BigInt(lira!) * 100n + BigInt(`${ondalik}00`.slice(0, 2));
  }
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    `${kurus / 100n}.${String(kurus % 100n).padStart(2, '0')}` as `${number}`,
  );
}
const PLANLANAN_TOPLAM = toplamTl(NEEDS.map((need) => need.amounts.planned));
const GERCEK_TOPLAM = toplamTl(NEEDS.map((need) => need.amounts.actual));
const SILINMIS_DAHIL_PLAN = toplamTl(ALL_NEEDS.map((need) => need.amounts.planned));

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

/** İlk okumada sağlam, `bozul()` sonrası her okumada hata veren kaynak (eski veri / stale durumu). */
function bozulanKaynak() {
  const saglam = fixtureSource();
  let bozuk = false;
  const source: GenerationSource = {
    kind: 'fixture',
    label: 'bozulan',
    readText: async (path) => {
      if (bozuk) throw new Error(`Nesil okunamadı: ${path}`);
      return saglam.readText(path);
    },
  };
  return { source, bozul: () => { bozuk = true; } };
}

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

const GENIS_BEKLEME = { timeout: 8000 };
const odalarTablosu = () => screen.getByRole('table', { name: 'Odalar' });
const odalarTablosunuBekle = () => screen.findByRole('table', { name: 'Odalar' }, GENIS_BEKLEME);
/** antd başlığı ayrı bir <table> içinde çizebilir; sütun başlıkları tablonun en yakın bölge kökünden okunur. */
const sutunlar = (table: HTMLElement) => {
  const kok = table.closest<HTMLElement>('[data-layout="table"]') ?? table.parentElement!;
  return within(kok).getAllByRole('columnheader').map((cell) => cell.textContent?.trim());
};
const satirBasligi = (kok: HTMLElement, ad: string) => within(kok).getByRole('button', { name: new RegExp(`^${ad}`) });

describe('EvPage › başlık ve veri durumları', () => {
  it('yüklenirken aynı yerleşimde iskelet gösterir, veri gelince odalar tablosu çizilir', async () => {
    renderPage();
    expect(screen.getByText('Yükleniyor').closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
    await odalarTablosunuBekle();
    expect(screen.queryByText('Yükleniyor')).not.toBeInTheDocument();
  });

  it('bölüm → h1 → amaç sırası ve ≤3 özet: Oda, Planlanan ve Gerçekleşen ayrı ölçülerdir; silinmiş alım toplama girmez', async () => {
    renderPage();
    await odalarTablosunuBekle();
    expect(screen.getByText('Ev')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ev ve odalar' })).toBeInTheDocument();
    expect(screen.getByText('Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.')).toBeInTheDocument();

    const olculer = within(screen.getByRole('list', { name: 'Özet' })).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Oda');
    expect(olculer[0]).toHaveTextContent(String(ROOMS.length));
    expect(olculer[0]).toHaveTextContent(`+${ODASIZ_ALIM} alım odasız`);
    expect(olculer[1]).toHaveTextContent('Planlanan');
    expect(olculer[1]).toHaveTextContent(PLANLANAN_TOPLAM);
    expect(olculer[1]).toHaveTextContent(`${NEEDS.length} alım`);
    expect(olculer[1]).not.toHaveTextContent(SILINMIS_DAHIL_PLAN);
    expect(olculer[2]).toHaveTextContent('Gerçekleşen');
    expect(olculer[2]).toHaveTextContent(GERCEK_TOPLAM);
    expect(PLANLANAN_TOPLAM).not.toBe(GERCEK_TOPLAM);
  });

  it('tazelik satırı nesil kimliğini ve son okumayı yazar', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(`Nesil ${GENERATION_ID.slice(0, 6)}`)).toBeInTheDocument());
    expect(screen.getByText(/^Son okuma /)).toBeInTheDocument();
  });

  it('eski veri: yenileme başarısızsa son başarılı nesil gösterilmeye devam eder, tazelik satırı "yenilenemedi" der', async () => {
    const user = userEvent.setup();
    const { source, bozul } = bozulanKaynak();
    renderPage('desktop', source);
    await odalarTablosunuBekle();
    bozul();
    await user.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByText('yenilenemedi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(within(odalarTablosu()).getByText(ODA_3.label!)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rooms koleksiyonu nesilde yoksa dürüst metin: "Kaynakta oda kaydı yok" ve canlı odasız alım sayısı', async () => {
    renderPage('desktop', fixtureSource({ 'manifest.json': odasizManifest() }));
    const baslik = await screen.findByRole('heading', { level: 2, name: 'Kaynakta oda kaydı yok' });
    const durum = baslik.closest<HTMLElement>('[role="status"]')!;
    expect(durum).toHaveTextContent(`${NEEDS.length} alım`);
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

describe('EvPage › masaüstü: oda tablosu ve iki bölme', () => {
  it('her oda bir satırdır, odasız alımlar "Oda bilinmiyor" satırında; Planlanan ve Gerçekleşen ayrı sütunlardır', async () => {
    renderPage();
    const table = await odalarTablosunuBekle();
    expect(sutunlar(table)).toEqual(['Oda', 'Kod', 'Aşama', 'Alım', 'Açık iş', 'Planlanan', 'Gerçekleşen', 'Eksik bilgi']);
    for (const room of ROOMS) expect(within(table).getByText(room.label!)).toBeInTheDocument();
    expect(within(table).getByText('Oda bilinmiyor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Oda seç' })).not.toBeInTheDocument();
  });

  it('alım sayısı odanın canlı alımlarıdır (aynı odaya bağlı işler, eşyalar, armatürler alım sayılmaz)', async () => {
    renderPage();
    const table = await odalarTablosunuBekle();
    const satir = within(table).getByText(ODA_3.label!).closest('tr')!;
    const tumBaglar = RELATIONS.filter((rel) => rel.kind === 'located_in' && rel.target_id === ODA_3.id).length;
    expect(ODA_3_ALIM.length).not.toBe(tumBaglar);
    const hucreler = within(satir).getAllByRole('cell').map((cell) => cell.textContent?.trim());
    expect(hucreler).toContain(`${ODA_3_ALIM.length} alım`);
    expect(hucreler).not.toContain(`${tumBaglar} alım`);
    expect(satir).toHaveTextContent(toplamTl(ODA_3_ALIM.map((need) => need.amounts.planned)));
    expect(satir).toHaveTextContent(toplamTl(ODA_3_ALIM.map((need) => need.amounts.actual)));
  });

  it('tutar ₺ ve iki ondalıkla, eksik tutar adıyla yazılır; ₺0,00 eksiğin yerine geçmez', async () => {
    renderPage();
    const table = await odalarTablosunuBekle();
    const hucreler = within(table).getAllByRole('cell').map((cell) => cell.textContent ?? '');
    expect(hucreler.some((text) => /^₺\d{1,3}(\.\d{3})*,\d{2}$/.test(text))).toBe(true);
    expect(hucreler).toContain('Henüz yok');
    expect(hucreler.some((text) => text === '0' || text === '₺0,00')).toBe(false);
  });

  it('oda seçilince ayrıntı sağ bölmede açılır, tablo sıkı sütunlara geçer; "Ayrıntıyı kapat" tam tabloya döner', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await odalarTablosunuBekle()).getByText(ODA_3.label!));

    const panel = screen.getByRole('region', { name: ODA_3.label! });
    expect(within(panel).getByRole('heading', { level: 2, name: ODA_3.label! })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Listeye dön' })).not.toBeInTheDocument();
    expect(sutunlar(odalarTablosu())).toEqual(['Oda', 'Planlanan', 'Gerçekleşen']);

    const tutarlar = within(panel).getByRole('group', { name: 'Tutarlar' });
    expect(tutarlar).toHaveTextContent(`Planlanan${toplamTl(ODA_3_ALIM.map((need) => need.amounts.planned))}`);
    expect(tutarlar).toHaveTextContent(`Gerçekleşen${toplamTl(ODA_3_ALIM.map((need) => need.amounts.actual))}`);
    expect(within(panel).getByRole('img', { name: 'Fotoğraf yok' })).toBeInTheDocument();
    expect(within(panel).getByText(`Kaynak: ${ODA_3.provenance!.sheet_title} · satır ${ODA_3.provenance!.row}`)).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Ayrıntıyı kapat' }));
    expect(screen.queryByRole('region', { name: ODA_3.label! })).not.toBeInTheDocument();
    expect(sutunlar(odalarTablosu())).toHaveLength(8);
  });

  it('ayrıntıda Alımlar sekmesi varsayılan: odanın canlı alımları plan ve gerçekleşen ayrı; İşler sekmesi işleri açık/kapalı yazar', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await odalarTablosunuBekle()).getByText(ODA_3.label!));
    const panel = screen.getByRole('region', { name: ODA_3.label! });

    expect(within(panel).getByRole('tab', { name: 'Alımlar' })).toHaveAttribute('aria-selected', 'true');
    const alimlar = within(panel).getByRole('region', { name: 'Alımlar' });
    for (const need of ODA_3_ALIM) expect(satirBasligi(alimlar, need.label!)).toBeInTheDocument();
    const gercekli = ODA_3_ALIM.find((need) => need.amounts.actual)!;
    const gercekBasligi = satirBasligi(alimlar, gercekli.label!);
    if (gercekBasligi.getAttribute('aria-expanded') === 'false') await user.click(gercekBasligi);
    const govde = document.getElementById(gercekBasligi.getAttribute('aria-controls')!)!;
    expect(govde).toHaveTextContent(`Planlanan${toplamTl([gercekli.amounts.planned])}`);
    expect(govde).toHaveTextContent(`Gerçekleşen${toplamTl([gercekli.amounts.actual])}`);

    await user.click(within(panel).getByRole('tab', { name: 'İşler' }));
    expect(within(panel).getByRole('tab', { name: 'İşler' })).toHaveAttribute('aria-selected', 'true');
    const isler = within(panel).getByRole('region', { name: 'İşler' });
    for (const work of ODA_3_IS) expect(satirBasligi(isler, work.label!)).toBeInTheDocument();
    expect(within(panel).queryByRole('region', { name: 'Alımlar' })).not.toBeInTheDocument();
  });

  it('bağlı kayıtlar "Oda bölümleri" sekmelerinin panelindedir: tabpanel seçili sekmeyle adlanır ve ona bağlıdır (APG Tabs)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await odalarTablosunuBekle()).getByText(ODA_3.label!));
    const panel = screen.getByRole('region', { name: ODA_3.label! });
    const sekmeler = within(panel).getByRole('group', { name: 'Oda bölümleri' });
    const alimlar = within(sekmeler).getByRole('tabpanel', { name: 'Alımlar' });
    expect(within(sekmeler).getByRole('tab', { name: 'Alımlar' })).toHaveAttribute('aria-controls', alimlar.id);
    expect(within(alimlar).getByRole('region', { name: 'Alımlar' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('tab', { name: 'İşler' }));
    const isler = within(sekmeler).getByRole('tabpanel', { name: 'İşler' });
    expect(within(sekmeler).getByRole('tab', { name: 'İşler' })).toHaveAttribute('aria-controls', isler.id);
    expect(within(isler).getByRole('region', { name: 'İşler' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('Eşyalar sekmesi zamanlı yerleşim yoksa "Henüz yok", Aydınlatma sekmesi lümen ve renk sıcaklığını yazar', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(await odalarTablosunuBekle()).getByText(ODA_3.label!));
    const panel = screen.getByRole('region', { name: ODA_3.label! });

    await user.click(within(panel).getByRole('tab', { name: 'Eşyalar' }));
    const esya = satirBasligi(within(panel).getByRole('region', { name: 'Eşyalar' }), ODA_3_ESYA.label!);
    expect(document.getElementById(esya.getAttribute('aria-controls')!)).toHaveTextContent('Yerleşim tarihiHenüz yok');

    await user.click(within(panel).getByRole('tab', { name: 'Aydınlatma' }));
    const armatur = satirBasligi(within(panel).getByRole('region', { name: 'Aydınlatma' }), ODA_3_ARMATUR.label!);
    const govde = document.getElementById(armatur.getAttribute('aria-controls')!)!;
    expect(govde).toHaveTextContent(`Lümen${String(ODA_3_ARMATUR.attributes!.lumen)} lm`);
    expect(govde).toHaveTextContent(`Renk sıcaklığı${String(ODA_3_ARMATUR.attributes!.renk_sicakligi_k)} K`);
  });

  it('odada eşya kaydı yoksa sekme dürüst metin yazar', async () => {
    const user = userEvent.setup();
    renderPage();
    const esyasiz = ROOMS.find((room) => !LAYOUT.some((item) => item.room_id === room.id))!;
    await user.click(within(await odalarTablosunuBekle()).getByText(esyasiz.label!));
    const panel = screen.getByRole('region', { name: esyasiz.label! });
    await user.click(within(panel).getByRole('tab', { name: 'Eşyalar' }));
    expect(within(panel).getByRole('heading', { level: 2, name: 'Bu odada eşya kaydı yok' })).toBeInTheDocument();
  });
});

describe('EvPage › tablet: tablo ve tam sayfa ayrıntı', () => {
  it('oda seçilince ayrıntı listenin yerini alır, bağlı kayıtlar tablo; "Listeye dön" tabloya ve satıra döner', async () => {
    const user = userEvent.setup();
    renderPage('tablet');
    await user.click(within(await odalarTablosunuBekle()).getByText(ODA_3.label!));
    const sayfa = screen.getByRole('region', { name: ODA_3.label! });
    expect(screen.queryByRole('table', { name: 'Odalar' })).not.toBeInTheDocument();
    expect(within(sayfa).getByRole('heading', { level: 2, name: ODA_3.label! })).toHaveFocus();
    const alimlar = within(sayfa).getByRole('table', { name: 'Alımlar' });
    for (const need of ODA_3_ALIM) expect(within(alimlar).getByText(need.label!)).toBeInTheDocument();
    expect(sutunlar(alimlar)).toEqual(expect.arrayContaining(['Planlanan', 'Gerçekleşen']));

    await user.click(within(sayfa).getByRole('button', { name: 'Listeye dön' }));
    expect(within(odalarTablosu()).getByText(ODA_3.label!).closest('tr')).toHaveFocus();
  });

  it('tam sayfa ayrıntıda bağlı kayıt tablosu "Oda bölümleri" sekme panelindedir (tabpanel seçili sekmeyle adlı)', async () => {
    const user = userEvent.setup();
    renderPage('tablet');
    await user.click(within(await odalarTablosunuBekle()).getByText(ODA_3.label!));
    const sayfa = screen.getByRole('region', { name: ODA_3.label! });
    const sekmePaneli = within(within(sayfa).getByRole('group', { name: 'Oda bölümleri' })).getByRole('tabpanel', { name: 'Alımlar' });
    expect(within(sekmePaneli).getByRole('table', { name: 'Alımlar' })).toBeInTheDocument();
  });
});

describe('EvPage › telefon: akordeon liste, oda seçimi alt sayfada, tam sayfa ayrıntı', () => {
  it('odalar akordeondur (ilk satır açık, tablo yok); "Odayı aç" ayrıntıya götürür ve odağı başlığa taşır', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    const liste = await screen.findByRole('region', { name: 'Odalar' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const basliklar = within(liste).getAllByRole('button', { expanded: true });
    expect(basliklar).toHaveLength(1);
    expect(basliklar[0]).toHaveAccessibleName(new RegExp(`^${sirali(ROOMS.map((room) => room.label!))[0]}`));

    await user.click(within(liste).getAllByRole('button', { name: 'Odayı aç' })[0]!);
    expect(screen.queryByRole('region', { name: 'Odalar' })).not.toBeInTheDocument();
    const ilk = sirali(ROOMS.map((room) => room.label!))[0]!;
    expect(screen.getByRole('heading', { level: 2, name: ilk })).toHaveFocus();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('"Oda seç" alt sayfası odaları listeler; seçilen odanın ayrıntısı açılır, "Listeye dön" odağı o odanın satırına getirir', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    await screen.findByRole('region', { name: 'Odalar' });
    await user.click(screen.getByRole('button', { name: 'Oda seç' }));

    const sayfa = await screen.findByRole('dialog', { name: 'Oda seç' });
    for (const room of ROOMS) expect(within(sayfa).getByRole('button', { name: room.label! })).toBeInTheDocument();
    expect(within(sayfa).getByRole('button', { name: 'Oda bilinmiyor' })).toBeInTheDocument();
    await user.click(within(sayfa).getByRole('button', { name: ODA_3.label! }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Oda seç' })).not.toBeInTheDocument());
    const oda = screen.getByRole('region', { name: ODA_3.label! });
    await waitFor(() => expect(within(oda).getByRole('heading', { level: 2, name: ODA_3.label! })).toHaveFocus());
    const alimlar = within(oda).getByRole('region', { name: 'Alımlar' });
    for (const need of ODA_3_ALIM) expect(satirBasligi(alimlar, need.label!)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(within(oda).getByRole('button', { name: 'Listeye dön' }));
    const liste = screen.getByRole('region', { name: 'Odalar' });
    const satir = satirBasligi(liste, ODA_3.label!);
    expect(satir).toHaveFocus();
    expect(satir).toHaveAttribute('aria-expanded', 'true');
  });

  it('seçili oda alt sayfada işaretlidir (aria-current); yeniden açınca başka oda seçilebilir', async () => {
    const user = userEvent.setup();
    renderPage('phone');
    await screen.findByRole('region', { name: 'Odalar' });
    await user.click(screen.getByRole('button', { name: 'Oda seç' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Oda seç' })).getByRole('button', { name: ODA_3.label! }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Oda seç' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Oda seç' }));
    const sayfa = await screen.findByRole('dialog', { name: 'Oda seç' });
    expect(within(sayfa).getByRole('button', { name: ODA_3.label! })).toHaveAttribute('aria-current', 'true');
    await user.click(within(sayfa).getByRole('button', { name: 'Oda bilinmiyor' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Oda bilinmiyor' })).toHaveFocus());
  });
});
