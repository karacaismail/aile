// Ayarlar sayfası: PageHeader (Uygulama › Ayarlar) → tasarım satır düzeni (başlık solda, alanlar sağda; telefonda alt
// alta) → veri kaynağı ayarları. Sentetik nesil FixtureGenerationSource ile belleğe okunur; GenerationProvider gerçektir.
// Seçiciler role/label ile; antd iç sınıflarına bağlı seçici yok. Gerçek Sheet kimliği, gerçek aile verisi yok.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import { ChangeSet, createMemoryStorage } from '../data/changeSet';
import { FixtureGenerationSource } from '../data/sources';
import { GenerationProvider, type GenerationProviderProps } from '../data/useGeneration';
import type { Manifest, PurchaseNeedRecord } from '../data/types';
import { AyarlarPage } from './AyarlarPage';

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
const MANIFEST = JSON.parse(FILES['manifest.json']!) as Manifest;
const NEEDS = (JSON.parse(FILES['data/purchase_needs/household/00000.json']!) as { records: PurchaseNeedRecord[] }).records;
const LAMBADER = NEEDS.find((record) => record.source_record_id === 'kalem-027')!;

function fixtureSource(overrides: Record<string, string | null> = {}): FixtureGenerationSource {
  const files = { ...FILES };
  for (const [path, text] of Object.entries(overrides)) {
    if (text === null) delete files[path];
    else files[path] = text;
  }
  return new FixtureGenerationSource(files, 'sentetik');
}

/** Tam paketteki yükü taklit eder: manifest okuması bir makro görev sonra biter (okuma "Okunuyor…" durumunda kalır). */
class SlowFixtureSource extends FixtureGenerationSource {
  override async readText(path: string): Promise<string> {
    if (path === 'manifest.json') await new Promise((resolve) => setTimeout(resolve, 50));
    return super.readText(path);
  }
}

/** Ayar koleksiyonu nesilde hiç yokmuş gibi: manifest files/counts'tan çıkar (generation_id biçimi korunur). */
function manifestWithoutSettings(): string {
  const counts = { ...MANIFEST.counts };
  delete counts.settings;
  const files = MANIFEST.files.filter((file) => file.collection !== 'settings');
  return JSON.stringify({ ...MANIFEST, counts, files });
}

interface RenderOptions extends Partial<GenerationProviderProps> {
  device?: Device;
  budgetSheetId?: string;
}

function renderPage({ device = 'desktop', budgetSheetId = '', source, ...props }: RenderOptions = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DeviceContext.Provider value={device}>
      <GenerationProvider source={source ?? fixtureSource()} cache={null} changeSet={props.changeSet ?? null} {...props}>
        {children}
      </GenerationProvider>
    </DeviceContext.Provider>
  );
  return render(<AyarlarPage budgetSheetId={budgetSheetId} />, { wrapper: Wrapper });
}

/** Başlıktaki tazelik satırı (DataStatus): <header> banner içindeki tek role="status". */
const headerStatus = () => within(screen.getByRole('banner')).getByRole('status');
/** Okuma sonuçlandı (checking değil). "Okunuyor…" satırı da "Son okuma henüz yok / 14:32" içerir; o yüzden /Son okuma/
 *  hazır işareti değildir. Sonuç (fresh "Nesil …", stale "yenilenemedi", error "Hata:") testin kendisinde doğrulanır. */
const waitReady = () => waitFor(() => expect(headerStatus()).not.toHaveTextContent('Okunuyor…'));

beforeEach(() => {
  localStorage.clear();
});

describe('AyarlarPage › başlık ve özet', () => {
  it('bölüm → h1 → amaç; özet en çok 3 ölçü: Nesil, Bekleyen değişiklik, Canlı bağlantı', async () => {
    renderPage();
    expect(screen.getByText('Uygulama')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ayarlar' })).toBeInTheDocument();
    expect(screen.getByText('Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.')).toBeInTheDocument();
    await waitReady();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const olculer = within(ozet).getAllByRole('listitem');
    expect(olculer).toHaveLength(3);
    expect(olculer[0]).toHaveTextContent('Nesil');
    expect(olculer[0]).toHaveTextContent(GENERATION_ID.slice(0, 6));
    expect(olculer[1]).toHaveTextContent('Bekleyen değişiklik');
    expect(olculer[2]).toHaveTextContent('Canlı bağlantı');
    expect(olculer[2]).toHaveTextContent('Adres yok');
  });

  it('nesil okunurken DataStatus "Okunuyor…", sonra "Son okuma … Nesil …"', async () => {
    renderPage({ source: new SlowFixtureSource(FILES, 'sentetik') });
    expect(headerStatus()).toHaveTextContent('Okunuyor…');
    await waitReady();
    expect(headerStatus()).toHaveTextContent(`Nesil ${GENERATION_ID.slice(0, 6)}`);
  });

  it('bozuk manifest: tazelik satırı "Hata:" der, özet nesil "Henüz yok"', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': '{bozuk' }) });
    await waitFor(() => expect(headerStatus()).toHaveTextContent(/^Hata: /));
    const ozet = screen.getByRole('list', { name: 'Özet' });
    expect(within(ozet).getAllByRole('listitem')[0]).toHaveTextContent('Henüz yok');
  });
});

describe('AyarlarPage › Aile ve Biçimler (ayar koleksiyonu, salt okunur)', () => {
  it('fixture: para birimi TRY → "Türk lirası (₺)", aile adı ve ay başlangıcı "Henüz yok", tarih biçimi sabit', async () => {
    renderPage();
    await waitReady();
    const aile = screen.getByRole('region', { name: 'Aile' });
    await waitFor(() => expect(within(aile).getByText('Aile adı').nextElementSibling).toHaveTextContent('Henüz yok'));
    expect(within(aile).getByText('Ay başlangıç günü').nextElementSibling).toHaveTextContent('Henüz yok');
    expect(within(aile).getByText(/panel bu alanları yazmaz/i)).toBeInTheDocument();
    const bicimler = screen.getByRole('region', { name: 'Biçimler' });
    expect(within(bicimler).getByText('Para birimi').nextElementSibling).toHaveTextContent('Türk lirası (₺)');
    expect(within(bicimler).getByText('Tarih biçimi').nextElementSibling).toHaveTextContent('gg.aa.yyyy (28.10.2026)');
  });

  it('ayar koleksiyonu nesilde yoksa dürüst metin: "Kaynakta ayar kaydı yok"', async () => {
    renderPage({ source: fixtureSource({ 'manifest.json': manifestWithoutSettings() }) });
    await waitReady();
    const aile = screen.getByRole('region', { name: 'Aile' });
    await waitFor(() => expect(within(aile).getByText('Kaynakta ayar kaydı yok.')).toBeInTheDocument());
    const bicimler = screen.getByRole('region', { name: 'Biçimler' });
    expect(within(bicimler).getByText('Kaynakta ayar kaydı yok.')).toBeInTheDocument();
  });

  it('ayar parçası okunamazsa ErrorState "Hata: …" + "Yeniden dene"; eski değer gösterilmez', async () => {
    renderPage({ source: fixtureSource({ 'data/settings/household/00000.json': null }) });
    await waitReady();
    const aile = screen.getByRole('region', { name: 'Aile' });
    await waitFor(() => expect(within(aile).getAllByText(/^Hata: /).length).toBeGreaterThan(0));
    expect(within(aile).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    expect(within(aile).queryByText('Türk lirası (₺)')).not.toBeInTheDocument();
  });
});

describe('AyarlarPage › Nesil kaynağı', () => {
  it('kaynak etiketi, koleksiyon/kayıt sayısı; klasör seçimi desteklenmiyorsa düğme yok, nedeni yazılı', async () => {
    renderPage();
    await waitReady();
    const nesil = screen.getByRole('region', { name: 'Nesil kaynağı' });
    expect(within(nesil).getByText('Sentetik nesil (sentetik)')).toBeInTheDocument();
    const toplam = Object.values(MANIFEST.counts).reduce((sum, count) => sum + count, 0);
    expect(within(nesil).getByText(`${Object.keys(MANIFEST.counts).length} koleksiyon · ${toplam} kayıt`)).toBeInTheDocument();
    expect(within(nesil).queryByRole('button', { name: 'Klasör seç' })).not.toBeInTheDocument();
    expect(within(nesil).getByText(/klasör seçmeyi desteklemiyor/i)).toBeInTheDocument();
    expect(within(nesil).getByRole('button', { name: 'Yenile' })).toBeInTheDocument();
  });
});

describe('AyarlarPage › Canlı bağlantı (Apps Script, yalnız bu tarayıcıda)', () => {
  it('adres ve anahtar alanları; anahtar maskeli; saklama notu; başta "Adres yok" ve Kaydet devre dışı', async () => {
    renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const adres = within(canli).getByLabelText('Apps Script adresi');
    const anahtar = within(canli).getByLabelText('Uygulama anahtarı');
    expect(adres).toHaveValue('');
    expect(anahtar).toHaveAttribute('type', 'password');
    expect(within(canli).getAllByText(/yalnız bu tarayıcıda saklanır/i).length).toBeGreaterThan(0);
    expect(within(canli).getByText('Adres yok')).toBeInTheDocument();
    expect(within(canli).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    expect(within(canli).getByText('Değişiklik yok')).toBeInTheDocument();
  });

  it('geçersiz adres: alan hatası "Hata: …", altlık "Hata: 1 alan düzeltilmeli"; geçerli adres kaydedilir', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const adres = within(canli).getByLabelText('Apps Script adresi');
    await user.type(adres, 'https://ornek.invalid/x');
    expect(adres).toHaveAccessibleDescription(/^Hata: /);
    expect(within(canli).getByText(/^Hata: 1 alan düzeltilmeli/)).toBeInTheDocument();
    expect(within(canli).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

    await user.clear(adres);
    await user.type(adres, 'https://script.google.com/macros/s/ORNEK/exec');
    expect(within(canli).getByText('Kaydedilmemiş değişiklik var')).toBeInTheDocument();
    const anahtar = within(canli).getByLabelText('Uygulama anahtarı');
    await user.type(anahtar, 'test-anahtar');
    await user.click(within(canli).getByRole('button', { name: 'Kaydet' }));
    expect(localStorage.getItem('aile:apiUrl')).toBe('https://script.google.com/macros/s/ORNEK/exec');
    expect(localStorage.getItem('aile:appKey')).toBe('test-anahtar');
    expect(within(canli).getByText('Hazır')).toBeInTheDocument();
    expect(within(canli).getByText('Değişiklik yok')).toBeInTheDocument();
    // Anahtar değeri sayfada düz metin olarak görünmez.
    expect(canli.textContent).not.toContain('test-anahtar');
  });

  it('Vazgeç taslağı kayıtlı değere döndürür', async () => {
    const user = userEvent.setup();
    localStorage.setItem('aile:apiUrl', 'https://script.google.com/macros/s/KAYITLI/exec');
    renderPage();
    await waitReady();
    const canli = screen.getByRole('region', { name: 'Canlı bağlantı' });
    const adres = within(canli).getByLabelText('Apps Script adresi');
    expect(adres).toHaveValue('https://script.google.com/macros/s/KAYITLI/exec');
    await user.type(adres, 'x');
    await user.click(within(canli).getByRole('button', { name: 'Vazgeç' }));
    expect(adres).toHaveValue('https://script.google.com/macros/s/KAYITLI/exec');
    expect(within(canli).getByText('Değişiklik yok')).toBeInTheDocument();
  });
});

describe('AyarlarPage › Bütçe e-tablosu (ortam)', () => {
  it('kimlik yoksa "tanımlı değil"; varsa "tanımlı" ve kimlik sayfada yazılmaz', async () => {
    const { unmount } = renderPage({ budgetSheetId: '' });
    await waitReady();
    let butce = screen.getByRole('region', { name: 'Bütçe e-tablosu' });
    expect(within(butce).getByText(/tanımlı değil/i)).toBeInTheDocument();
    unmount();

    renderPage({ budgetSheetId: 'SENTETIK-KIMLIK-123' });
    await waitReady();
    butce = screen.getByRole('region', { name: 'Bütçe e-tablosu' });
    expect(within(butce).getByText(/kimlik tanımlı \(VITE_BUDGET_SHEET_ID\)/i)).toBeInTheDocument();
    expect(butce.textContent).not.toContain('SENTETIK-KIMLIK-123');
  });
});

describe('AyarlarPage › Değişiklik kümesi', () => {
  it('küme kapalıyken bekleyen sayısı "Bilinmiyor" ve önizleme kapalı', async () => {
    renderPage({ changeSet: null });
    await waitReady();
    const kume = screen.getByRole('region', { name: 'Değişiklik kümesi' });
    expect(within(kume).getByText('Bekleyen değişiklik: Bilinmiyor')).toBeInTheDocument();
    expect(within(kume).getByRole('button', { name: /Dışa aktarma önizlemesi/ })).toBeDisabled();
  });

  it('bekleyen op sayısı ve dışa aktarma önizlemesi (toBatch JSON; gönderme yok)', async () => {
    const user = userEvent.setup();
    const changeSet = await ChangeSet.load({ storage: createMemoryStorage(), now: () => '2026-10-28T14:05:00.000Z', newId: () => 'OP001' });
    await changeSet.add({ recordId: LAMBADER.id, kind: 'note', before: { note: null }, after: { note: 'Sentetik not' } });
    renderPage({ changeSet: () => Promise.resolve(changeSet) });
    await waitReady();
    const kume = screen.getByRole('region', { name: 'Değişiklik kümesi' });
    await waitFor(() => expect(within(kume).getByText('1 bekleyen değişiklik')).toBeInTheDocument());
    const ozet = screen.getByRole('list', { name: 'Özet' });
    expect(within(ozet).getAllByRole('listitem')[1]).toHaveTextContent('1');
    expect(within(kume).getByText(/e-tabloya gönderme bu sürümde yok/i)).toBeInTheDocument();

    await user.click(within(kume).getByRole('button', { name: /Dışa aktarma önizlemesi/ }));
    const json = await within(kume).findByLabelText('Dışa aktarma JSON');
    await waitFor(() => expect(json).toHaveTextContent('"op": "upsert"'));
    expect(json).toHaveTextContent('"id": "kalem-027"');
    expect(json).toHaveTextContent('"opId": "OP001"');
    expect(json).toHaveTextContent('"not": "Sentetik not"');
    expect(within(kume).getByText(/1 işlem gönderilebilir · 0 atlandı · gönderme yok/)).toBeInTheDocument();
    expect(within(kume).queryByRole('button', { name: /Gönder/ })).not.toBeInTheDocument();
  });
});

describe('AyarlarPage › Üyeler ve yerleşim', () => {
  it('üye koleksiyonu yok: "Kaynakta üye kaydı yok" ve işlevsiz davet düğmesi yok', async () => {
    renderPage();
    await waitReady();
    const uyeler = screen.getByRole('region', { name: 'Üyeler' });
    expect(within(uyeler).getByText('Kaynakta üye kaydı yok.')).toBeInTheDocument();
    expect(within(uyeler).queryByRole('button', { name: /davet/i })).not.toBeInTheDocument();
  });

  it('masaüstünde geniş düzen, telefonda dar düzen (alt alta) ve yapışkan altlık', async () => {
    const wide = renderPage({ device: 'desktop' });
    await waitReady();
    expect(wide.container.querySelector('.aile-ayarlar')).toHaveAttribute('data-narrow', 'false');
    wide.unmount();

    const phone = renderPage({ device: 'phone' });
    await waitReady();
    expect(phone.container.querySelector('.aile-ayarlar')).toHaveAttribute('data-narrow', 'true');
    // Satır başlıkları hâlâ sırayla ve kesilmeden var.
    for (const name of ['Aile', 'Biçimler', 'Nesil kaynağı', 'Canlı bağlantı', 'Bütçe e-tablosu', 'Değişiklik kümesi', 'Üyeler']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });
});
