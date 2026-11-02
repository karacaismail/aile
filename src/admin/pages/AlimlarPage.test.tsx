import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { buildAlimlarHash, durumGecisi, parseAlimlarHash } from './AlimlarPage';
import { AlimlarGenis, AlimlarPivotTablo } from './alimlar/wide';
import {
  ALL_LABELS, GENERATION_ID, KesilebilenKaynak, PIVOT_ACIK, PURCHASES, PURCHASES_PATH, TERMS, WORKFLOWS, byLabel, kayitOgesi, rewritten, roomId, setup, termByLabel,
} from './alimlar/testkit';

// Alımlar ve eşyalar (dikey dilim). Tasarım: README › Sayfa iskeleti, ekranlar.md (EkranListe/Tablo/Kanban/Zaman,
// SayfaAlimlarPivot, EkranAyrinti + Dar biçimler), bundle.js Aile.Pages.Alimlar. Veri sentetik nesilden
// (fixtures/generation-synthetic → alimlar/testkit); seçiciler role/label ile. Geniş modüller (masaüstü yerleşimi,
// pivot tablosu) burada önceden yüklenir; tembel yükleme yolu ve telefonun indirmediği AlimlarPage.render.test'te.

beforeAll(async () => {
  await Promise.all([AlimlarGenis.preload(), AlimlarPivotTablo.preload()]);
}, 30_000);

const sonuclar = () => screen.findByRole('region', { name: 'Sonuçlar' });
/** Segment düğmesinin girdisi pointer-events: none; tıklama etiket metnine yapılır (QueryBar.test ile aynı). */
const modSec = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(screen.getByRole('radiogroup', { name: 'Görünüm modu' })).getByText(name));
const sonucSayisi = (n: number) => screen.findByText(`${n} sonuç`);
/**
 * Düğme aramaları sonuç bölgesinin dışında, ait oldukları alanda yapılır: belge çapında getByRole('button', { name })
 * 28 satır düğmesinin de adını hesaplar (bkz. testkit › kayitOgesi). Başlık alanı h1'in <header>'ıdır (yoksa belge).
 */
const baslikAlani = () => within(screen.getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' }).closest('header') ?? document.body);
const sorguAlani = () => within(screen.getByRole('search', { name: 'Sorgu' }));
/** Masaüstünde solda açık filtre paneli (FilterArea/FilterPanel "Filtreler" bölgesi; sonuçları içermez). */
const filtreAlani = () => within(screen.getAllByRole('region', { name: 'Filtreler' })[0]!);

/** Sonuç bölgesinde hangi alım adları görünür (tam metin eşleşmesi). */
function gorunenAdlar(region: HTMLElement): string[] {
  return ALL_LABELS.filter((label) => within(region).queryAllByText(label).length > 0).sort();
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

// --- Saf yardımcılar -------------------------------------------------------------------------------------
describe('AlimlarPage › URL (hash) durumu', () => {
  it('mod, arama, sıra, filtre ve seçili kayıt hash sorgusuna yazılır ve aynen geri okunur', () => {
    const state = {
      id: 'a1b2c3d4-0000-5000-8000-000000000001',
      mode: 'table' as const,
      search: 'lamba, kase',
      sort: 'planned_desc',
      facets: { room: ['r1', 'unknown'], owner: ['Ali, Veli'], date: ['baslangic=01.01.2027'] },
      dateType: 'order_due_on',
      timelineField: 'ordered',
    };
    const hash = buildAlimlarHash(state);
    expect(hash.startsWith('#/alimlar/a1b2c3d4-0000-5000-8000-000000000001?')).toBe(true);
    expect(parseAlimlarHash(hash)).toEqual(state);
  });

  it('seçim yokken yol "/alimlar/?…" biçimindedir (wouter iç içe rota eşleşmesi korunur); boş durumda yalnız "#/alimlar"', () => {
    const empty = { id: null, mode: null, search: '', sort: null, facets: {}, dateType: null, timelineField: null };
    expect(buildAlimlarHash(empty)).toBe('#/alimlar');
    expect(buildAlimlarHash({ ...empty, mode: 'kanban' })).toBe('#/alimlar/?mod=kanban');
    expect(parseAlimlarHash('#/alimlar/?mod=kanban')).toEqual({ ...empty, mode: 'kanban' });
    // Geçersiz mod yok sayılır; başka sayfanın hash'i bu sayfanın durumu değildir.
    expect(parseAlimlarHash('#/alimlar?mod=uydurma')?.mode ?? null).toBeNull();
    expect(parseAlimlarHash('#/projeler/?mod=table')).toBeNull();
  });
});

describe('AlimlarPage › durum geçişi (iş akışı)', () => {
  it('izinli geçiş (Araştırılıyor → Karar bekliyor) karar ekseninde kabul edilir', () => {
    const kase = byLabel('Örnek kase');
    const hedef = termByLabel('decision', 'Karar bekliyor');
    const sonuc = durumGecisi(kase, hedef.id, WORKFLOWS, TERMS);
    expect(sonuc).toEqual({ ok: true, axis: 'decision', from: { code: 'researching', term_id: kase.state_term_ids.decision }, to: { code: hedef.code, term_id: hedef.id } });
  });

  it('iş akışında olmayan geçiş (Araştırılıyor → Fikir) "Hata: …" ile reddedilir', () => {
    const kase = byLabel('Örnek kase');
    const sonuc = durumGecisi(kase, termByLabel('decision', 'Fikir').id, WORKFLOWS, TERMS);
    expect(sonuc.ok).toBe(false);
    expect(!sonuc.ok && sonuc.reason).toMatch(/^Hata: .*Araştırılıyor.*Fikir/);
  });

  it('tedarik ekseni dolu kayıtta geçiş tedarik iş akışından okunur (Alınacak → Sipariş)', () => {
    const yastik = byLabel('Örnek yastık');
    const ordered = TERMS.find((term) => term.id === WORKFLOWS.find((w) => w.key === 'fulfillment')!.transitions[0]!.to_term_id)!;
    const sonuc = durumGecisi(yastik, ordered.id, WORKFLOWS, TERMS);
    expect(sonuc.ok && sonuc.axis).toBe('fulfillment');
  });
});

// --- Sayfa -----------------------------------------------------------------------------------------------
describe('AlimlarPage › başlık, özet ve veri durumları', () => {
  it('bölüm, h1, amaç; yüklenirken iskelet, sonra liste', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Alımlar ve eşyalar' })).toBeInTheDocument();
    expect(screen.getByText('Alım ve envanter')).toBeInTheDocument();
    expect(screen.getByText('Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.')).toBeInTheDocument();
    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
    await sonuclar();
    await waitFor(() => expect(screen.getByText(/Nesil/)).toHaveTextContent(GENERATION_ID.slice(0, 6)));
  });

  it('özet üç ayrı madde: Planlanan ₺565.500,00 · Gerçekleşen ₺36.600,00 · Fiyatı eksik 4 (plan ve gerçek birleşmez)', async () => {
    setup();
    await sonuclar();
    const ozet = screen.getByRole('list', { name: 'Özet' });
    const maddeler = within(ozet).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(maddeler).toHaveLength(3);
    expect(maddeler[0]).toContain('Planlanan');
    expect(maddeler[0]).toContain('₺565.500,00');
    expect(maddeler[0]).toContain('24 kayıt');
    expect(maddeler[1]).toContain('Gerçekleşen');
    expect(maddeler[1]).toContain('₺36.600,00');
    expect(maddeler[1]).toContain('1 kayıt');
    expect(maddeler[2]).toContain('Fiyatı eksik');
    expect(maddeler[2]).toContain('4');
    // Plan + gerçek toplamı (₺602.100,00) hiçbir yerde yazılmaz.
    expect(screen.queryByText(/602\.100/)).toBeNull();
  });

  it('birincil eylem "Alım ekle" işlevsiz çizilmez: devre dışı ve nedeni yazılı', async () => {
    setup();
    await sonuclar();
    const ekle = baslikAlani().getByRole('button', { name: 'Alım ekle' });
    expect(ekle).toBeDisabled();
    expect(ekle).toHaveAccessibleDescription(/kaynak e-tabloya/);
  });

  it('nesil okunamazsa "Hata: …" ile ErrorState ve "Yeniden dene"', async () => {
    setup({ overrides: { 'manifest.json': null } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nesil okunamadı');
    expect(alert).toHaveTextContent(/Hata:/);
    expect(within(alert).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
  });

  it('purchase_needs boşsa dürüst metin: "Kaynakta alım kaydı yok"; sorgu çubuğu çizilmez', async () => {
    setup({ overrides: rewritten(PURCHASES_PATH, () => []) });
    expect(await screen.findByText('Kaynakta alım kaydı yok')).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
  });
});

describe('AlimlarPage › eski veri ve boş sonuç', () => {
  it('eski veri: yenileme başarısızsa son başarılı liste kalır; tazelik satırı "yenilenemedi" ve "Yeniden dene" der', async () => {
    const kaynak = new KesilebilenKaynak();
    const { user } = setup({ device: 'phone', source: kaynak });
    const region = await sonuclar();
    kaynak.offline = true;
    await user.click(baslikAlani().getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByText('yenilenemedi')).toBeInTheDocument();
    expect(screen.getByText(/Son başarılı nesil/)).toBeInTheDocument();
    expect(baslikAlani().getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
    // Son başarılı liste kalır (hata ekranına düşmez); eski veri tazelik satırında adıyla yazılıdır.
    expect(kayitOgesi(region, 'Örnek kase')).toBeInTheDocument();
    expect(screen.queryByText('Alımlar okunamadı')).toBeNull();
  });

  it('filtre sonucu boşsa etkin filtre yazılır; "Filtreleri temizle" tam kümeye döner', async () => {
    const { user } = setup({ device: 'phone' });
    await sonuclar();
    await user.type(screen.getByRole('searchbox', { name: 'Ara' }), 'zzq');
    await sonucSayisi(0);
    const region = await sonuclar();
    expect(within(region).getByText('Arama: zzq')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Filtreleri temizle' }));
    await sonucSayisi(PURCHASES.length);
    expect(screen.getByRole('searchbox', { name: 'Ara' })).toHaveValue('');
  });
});

describe('AlimlarPage › sorgu çubuğu ve modlar', () => {
  it('altı mod; desteklenmeyenler view_definitions gerekçesiyle devre dışı (Gantt, Pivot)', async () => {
    setup();
    await sonuclar();
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Zaman çizelgesi' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Kanban' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Gantt' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Pivot' })).toBeDisabled();
    const grup = screen.getByRole('radiogroup', { name: 'Görünüm modu' });
    expect(grup).toHaveAccessibleDescription(/Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok\./);
    expect(grup).toHaveAccessibleDescription(/Pivot kullanılamaz: /);
  });

  it('mod değişince aynı kayıt kümesi görünür (filtreli: Oda 1 ∪ Oda 2 → 8 kayıt) ve hash mod/filtreyi taşır', async () => {
    const { user } = setup();
    await sonuclar();
    await user.click(filtreAlani().getByRole('checkbox', { name: 'Örnek oda 1' }));
    await user.click(filtreAlani().getByRole('checkbox', { name: 'Örnek oda 2' }));
    await sonucSayisi(8);
    const beklenen = PURCHASES.filter((r) => r.room_id === roomId('Örnek oda 1') || r.room_id === roomId('Örnek oda 2')).map((r) => r.label!).sort();
    expect(beklenen).toHaveLength(8);
    expect(gorunenAdlar(await sonuclar())).toEqual(beklenen);
    expect(window.location.hash).toContain(`room=`);
    expect(window.location.hash).toContain(roomId('Örnek oda 1'));

    for (const mod of ['Tablo', 'Kanban', 'Zaman çizelgesi']) {
      const radyo = sorguAlani().getByRole('radio', { name: mod });
      await modSec(user, mod);
      await waitFor(() => expect(radyo).toBeChecked());
      expect(gorunenAdlar(await sonuclar())).toEqual(beklenen);
    }
    expect(window.location.hash).toContain('mod=timeline');
    expect(window.location.hash).toContain(roomId('Örnek oda 2'));
  });

  it('filtre: aynı boyutta OR, boyutlar arası AND (Oda 1 ∪ Oda 2) ∩ Ödeme "Planlandı" → 4', async () => {
    const { user } = setup();
    await sonuclar();
    await user.click(filtreAlani().getByRole('checkbox', { name: 'Örnek oda 1' }));
    await sonucSayisi(4);
    await user.click(filtreAlani().getByRole('checkbox', { name: 'Örnek oda 2' }));
    await sonucSayisi(8);
    await user.click(filtreAlani().getByRole('button', { name: /Ödeme durumu/ }));
    await user.click(await filtreAlani().findByRole('checkbox', { name: 'Planlandı' }));
    await sonucSayisi(4);
    const beklenen = ['Örnek askı', 'Örnek lambader', 'Örnek masa', 'Örnek sandalye'];
    expect(gorunenAdlar(await sonuclar())).toEqual(beklenen);
    // Etkin filtreler kaldırılabilir etiketlerdir.
    expect(screen.getByText('Ödeme durumu: Planlandı')).toBeInTheDocument();
  });

  it('hash ile açılış: "#/alimlar/?mod=table" tabloyu açar', async () => {
    window.location.hash = '#/alimlar/?mod=table';
    setup();
    const region = await sonuclar();
    expect(screen.getByRole('radio', { name: 'Tablo' })).toBeChecked();
    expect(within(region).getByRole('table', { name: 'Alımlar ve eşyalar' })).toBeInTheDocument();
    expect(within(region).getByRole('columnheader', { name: 'Planlanan' })).toBeInTheDocument();
    expect(within(region).getByRole('columnheader', { name: 'Gerçekleşen' })).toBeInTheDocument();
  });

  it('Zaman çizelgesinde tarih alanı seçilir (native select yok, combobox)', async () => {
    const { user } = setup();
    await sonuclar();
    await modSec(user, 'Zaman çizelgesi');
    const secim = await screen.findByRole('combobox', { name: 'Tarih alanı' });
    expect(document.querySelector('select')).toBeNull();
    await user.click(secim);
    await user.click(await screen.findByRole('option', { name: 'Sipariş' }));
    await waitFor(() => expect(window.location.hash).toContain('zaman=ordered'));
  });

  it('Pivot (tanım izin verince): oda × durum, Plan ve Gerçek ayrı satırda; satır toplamı ölçü başına', async () => {
    const { user } = setup({ overrides: PIVOT_ACIK });
    await sonuclar();
    await modSec(user, 'Pivot');
    const tablo = await screen.findByRole('table', { name: 'Oda ve duruma göre planlanan ve gerçekleşen tutar' });
    const satir = within(tablo).getByRole('row', { name: /^Örnek oda 3 / });
    // Oda 3: battaniye (İptal, plan 1.900), vazo (Araştırılıyor, 25.000), tencere (Kuruldu, plan 38.600 / gerçek 36.600), perde (Karar bekliyor, 35.900)
    expect(satir).toHaveTextContent('Plan ₺101.400,00');
    expect(satir).toHaveTextContent('Gerçek ₺36.600,00');
    expect(satir).not.toHaveTextContent('₺138.000,00');
    expect(within(tablo).getByRole('row', { name: /^Toplam / })).toHaveTextContent('Plan ₺565.500,00');
  });

  it('Pivot telefonda PivotStack olur (mod hash ile gelir; telefonda mod seçimi combobox)', async () => {
    window.location.hash = '#/alimlar/?mod=pivot';
    setup({ device: 'phone', overrides: PIVOT_ACIK });
    const region = await sonuclar();
    expect(await within(region).findByText('Genel toplam')).toBeInTheDocument();
    expect(within(region).queryByRole('table')).toBeNull();
  });

  it('Pivot tanımda yoksa hash ile istenen pivot uydurulmaz; Liste açılır', async () => {
    window.location.hash = '#/alimlar/?mod=pivot';
    setup();
    await sonuclar();
    expect(screen.getByRole('radio', { name: 'Liste' })).toBeChecked();
  });
});

describe('AlimlarPage › ayrıntı, odak ve durum değişikliği', () => {
  it('masaüstü: satır ayrıntıyı sağda açar (hash #/alimlar/<id>), odak içeri girer; "Kapat" odağı satıra döndürür', async () => {
    const { user } = setup();
    const region = await sonuclar();
    const kase = byLabel('Örnek kase');
    const satir = kayitOgesi(region, 'Örnek kase');
    await user.click(satir);
    const panel = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    expect(window.location.hash).toContain(`/alimlar/${kase.id}`);
    expect(within(panel).getByRole('region', { name: 'Plan ve gerçek' })).toHaveTextContent('Henüz yok');
    await user.click(within(panel).getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(kayitOgesi(region, 'Örnek kase')));
    expect(window.location.hash).not.toContain(kase.id);
  });

  it('mod değişince seçim ve odak korunur', async () => {
    const { user } = setup();
    const region = await sonuclar();
    await user.click(kayitOgesi(region, 'Örnek kase'));
    await screen.findByRole('dialog', { name: 'Örnek kase' });
    const tablo = screen.getByRole('radio', { name: 'Tablo' });
    await modSec(user, 'Tablo');
    await waitFor(() => expect(tablo).toBeChecked());
    expect(screen.getByRole('dialog', { name: 'Örnek kase' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tablo' }));
    const satir = kayitOgesi(await sonuclar(), 'Örnek kase', 'row');
    expect(satir).toHaveAttribute('aria-selected', 'true');
  });

  it('"Durumu değiştir" yalnız iş akışı geçişlerini sunar; seçim yerel change set’e yazılır ve "Geri al" geri çevirir', async () => {
    const { user } = setup();
    const region = await sonuclar();
    // Satır düğmesi bir kez bulunur: memo'lu satır aynı DOM düğümünde kalır (seçim ve yerel değişiklik onu yeniden
    // kurmaz); bekleme döngüsü her turda 28 satırın adını hesaplayan rol araması yapmaz (kök neden: testkit › kayitOgesi).
    const kaseSatiri = kayitOgesi(region, 'Örnek kase');
    await user.click(kaseSatiri);
    const panel = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(panel).getByRole('combobox', { name: 'Durumu değiştir' }));
    const liste = await screen.findByRole('listbox');
    const secenekler = within(liste).getAllByRole('option').map((o) => o.textContent);
    expect(secenekler).toEqual(['Araştırılıyor', 'Karar bekliyor', 'İptal']);
    expect(within(liste).queryByRole('option', { name: 'Fikir' })).toBeNull();
    await user.click(within(liste).getByRole('option', { name: 'Karar bekliyor' }));

    await waitFor(() => expect(kaseSatiri).toHaveTextContent('Karar bekliyor'));
    expect(await screen.findByText(/Araştırılıyor → Karar bekliyor/)).toHaveTextContent(/kaynağa yazılmadı/);
    const geriAl = within(panel).getByRole('button', { name: 'Geri al' });
    await user.click(geriAl);
    await waitFor(() => expect(kaseSatiri).toHaveTextContent('Araştırılıyor'));
    expect(await screen.findByText('Değişiklik geri alındı.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Geri al' })).toBeNull();
    expect(kaseSatiri.isConnected).toBe(true);
  });

  it('telefon: ayrıntı tam sayfa ("Listeye dön"); dönüşte odak açan satıra gelir', async () => {
    const { user } = setup({ device: 'phone' });
    const region = await sonuclar();
    await user.click(kayitOgesi(region, 'Örnek kase'));
    const sayfa = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await waitFor(() => expect(document.activeElement).toBe(sayfa));
    expect(screen.queryByRole('search')).toBeNull();
    await user.click(within(sayfa).getByRole('button', { name: 'Listeye dön' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(kayitOgesi(region, 'Örnek kase')));
  });

  // WebKit/Safari düğmeye tıklamayı odak taşımadan işler: document.activeElement body ya da odaklanabilir bir ata
  // (main, tabIndex -1) kalır; açan öğe tıklanan satırdan bilinmeli. fireEvent.click odak taşımaz, Safari'yi taklit eder.
  it.each([
    ['phone', 'body'],
    ['desktop', 'body'],
    ['phone', 'başka öğe'],
    ['desktop', 'başka öğe'],
  ] as const)('%s: tıklama odak taşımasa da (Safari, odak %s) kapanınca odak açan satıra döner', async (device, odak) => {
    const { user } = setup({ device });
    const region = await sonuclar();
    const satir = kayitOgesi(region, 'Örnek kase');
    if (odak === 'başka öğe') screen.getByRole('searchbox', { name: 'Ara' }).focus();
    else expect(document.activeElement).toBe(document.body);
    fireEvent.click(satir);
    const ayrinti = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(ayrinti).getByRole('button', { name: device === 'phone' ? 'Listeye dön' : 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(kayitOgesi(region, 'Örnek kase')));
  });

  // Ayrıntı açıkken liste yeniden kurulabilir: geniş profile ilk geçişte sağlayıcı geçidi çalışma alanını bir kez yeniden
  // kurar (AdaptiveRoot) ve geniş modül gelince telefon yedeği geniş yerleşime geçer. Yeni sayfa örneği açan öğeyi bilmez
  // (seçim hash'ten gelir) ya da bildiği düğüm belgeden düşmüştür. Kapanınca odak yine o kaydın satırına döner (seçili
  // işaretli satır), body'de kalmaz. Hash'le açılış bu durumun en küçük örneğidir.
  it.each(['phone', 'desktop'] as const)('%s: açan öğe bilinmezse (sayfa yeniden kuruldu, seçim hash’ten) kapanınca odak seçili kaydın satırına döner', async (device) => {
    const kase = byLabel('Örnek kase');
    window.location.hash = `#/alimlar/${kase.id}`;
    const { user } = setup({ device });
    const ayrinti = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(ayrinti).getByRole('button', { name: device === 'phone' ? 'Listeye dön' : 'Kapat' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    const region = await sonuclar();
    await waitFor(() => expect(document.activeElement).toBe(kayitOgesi(region, 'Örnek kase')));
    expect(window.location.hash).not.toContain(kase.id);
  });

  // Kısa yükseklikte (yatay telefon 568×320) bildirim ayrıntı katmanının altlığına girince kayan gövde kısalır; durum
  // seçimi gövdenin altındayken yeni beliren "Geri al" altlığın arkasında kalırdı. Sayfa onu en yakın kenarla görünür
  // alana getirir (odak taşımaz; jsdom yerleşim yapmaz, çağrı doğrulanır — gerçek ölçü e2e/admin-page-alimlar).
  it('telefon: durum değişince "Geri al" görünür alana getirilir (en yakın kenar), odak taşınmaz', async () => {
    const kaydir = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    try {
      const { user } = setup({ device: 'phone' });
      const region = await sonuclar();
      await user.click(kayitOgesi(region, 'Örnek kase'));
      const sayfa = await screen.findByRole('dialog', { name: 'Örnek kase' });
      await user.click(within(sayfa).getByRole('combobox', { name: 'Durumu değiştir' }));
      const liste = await screen.findByRole('listbox', { name: 'Durumu değiştir' });
      await user.click(within(liste).getByRole('option', { name: 'Karar bekliyor' }));
      const geriAl = await within(sayfa).findByRole('button', { name: 'Geri al' });
      await waitFor(() => expect(within(sayfa).getByRole('status')).toHaveTextContent(/Araştırılıyor → Karar bekliyor/));
      await waitFor(() => {
        const cagrilar = kaydir.mock.contexts.flatMap((oge, i) => (oge === geriAl ? [kaydir.mock.calls[i]] : []));
        expect(cagrilar).toContainEqual([{ block: 'nearest' }]);
      });
      expect(document.activeElement).not.toBe(geriAl);
    } finally {
      kaydir.mockRestore();
    }
  });

  // Filtre yüzeyi telefonda shell/FilterDrawer › ui/BottomSheet (b03/a05): diyalog h2 "Filtreler" ile adlanır; altlıkta
  // canlı sonuç sayısı ("28 sonuç") ve "Uygula" (açıklaması sonuç sayısı, kapatır), "Temizle". Seçim anında uygulanır.
  it('telefon: filtreler alt sayfada; hash’teki seçim ayrıntıyı doğrudan açar', async () => {
    const kase = byLabel('Örnek kase');
    window.location.hash = `#/alimlar/${kase.id}`;
    const { user } = setup({ device: 'phone' });
    const sayfa = await screen.findByRole('dialog', { name: 'Örnek kase' });
    await user.click(within(sayfa).getByRole('button', { name: 'Listeye dön' }));
    await act(async () => {});
    const filtreDugmesi = await sorguAlani().findByRole('button', { name: 'Filtreler (0)' });
    await user.click(filtreDugmesi);
    const cekmece = await screen.findByRole('dialog', { name: 'Filtreler' });
    const sonucDurumu = within(cekmece).getByRole('status');
    expect(sonucDurumu).toHaveTextContent(`${PURCHASES.length} sonuç`);
    const uygula = within(cekmece).getByRole('button', { name: 'Uygula' });
    expect(uygula).toHaveAccessibleDescription(`${PURCHASES.length} sonuç`);
    expect(within(cekmece).getByRole('button', { name: 'Temizle' })).toBeInTheDocument();

    // Seçim anında uygulanır: altlıktaki sayı daralır; "Uygula" kapatır ve odak Filtreler düğmesine döner.
    await user.click(within(cekmece).getByRole('checkbox', { name: 'Örnek oda 1' }));
    const oda1 = PURCHASES.filter((r) => r.room_id === roomId('Örnek oda 1')).length;
    await waitFor(() => expect(sonucDurumu).toHaveTextContent(`${oda1} sonuç`));
    expect(uygula).toHaveAccessibleDescription(`${oda1} sonuç`);
    await user.click(uygula);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Filtreler/ })).toBeNull());
    await waitFor(() => expect(sorguAlani().getByRole('button', { name: 'Filtreler (1)' })).toHaveFocus());
    await sonucSayisi(oda1);
  });

  // WebKit/Safari düğmeye tıklamayı odak taşımadan işler (fireEvent.click bunu taklit eder): açan Filtreler düğmesi
  // document.activeElement'ten bilinemez; çekmece kapanınca odak yine o düğmeye dönmelidir (body'de kalmaz).
  it('telefon: tıklama odak taşımasa da (Safari) "Uygula" sonrası odak Filtreler düğmesine döner', async () => {
    const { user } = setup({ device: 'phone' });
    await sonuclar();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(sorguAlani().getByRole('button', { name: 'Filtreler (0)' }));
    const cekmece = await screen.findByRole('dialog', { name: 'Filtreler' });
    await user.click(within(cekmece).getByRole('button', { name: 'Uygula' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filtreler' })).toBeNull());
    await waitFor(() => expect(sorguAlani().getByRole('button', { name: 'Filtreler (0)' })).toHaveFocus());
  });

  // a11 DetailPanel telefonda ekranı kaplayan modal katmandır (position fixed, aria-modal). Sayfa sonundaki bildirim bölgesi
  // bu katmanın arkasında kalır ve modalın dışında okunmaz; bildirim ayrıntı açıkken katmanın altlığında (footer) çizilir.
  it('telefon: durum bildirimi tam ekran ayrıntının içinde, altlıkta görünür; geri alma bildirimi de orada', async () => {
    const { user } = setup({ device: 'phone' });
    const region = await sonuclar();
    await user.click(kayitOgesi(region, 'Örnek kase'));
    const sayfa = await screen.findByRole('dialog', { name: 'Örnek kase' });
    // Canlı bölge içerikten önce vardır (duyuru için): ayrıntı açılınca boş durum ve uyarı bölgeleri katmanın içindedir.
    const durumBolgesi = within(sayfa).getByRole('status');
    expect(durumBolgesi).toBeEmptyDOMElement();
    expect(within(sayfa).getByRole('alert')).toBeEmptyDOMElement();

    await user.click(within(sayfa).getByRole('combobox', { name: 'Durumu değiştir' }));
    const liste = await screen.findByRole('listbox', { name: 'Durumu değiştir' });
    await user.click(within(liste).getByRole('option', { name: 'Karar bekliyor' }));
    await waitFor(() => expect(durumBolgesi).toHaveTextContent(/Araştırılıyor → Karar bekliyor.*kaynağa yazılmadı/));

    await user.click(within(sayfa).getByRole('button', { name: 'Geri al' }));
    await waitFor(() => expect(durumBolgesi).toHaveTextContent('Değişiklik geri alındı.'));
    // Tek bildirim bölgesi: aynı metin sayfada ikinci kez (katmanın arkasında) yazılmaz.
    expect(screen.getAllByText('Değişiklik geri alındı.')).toHaveLength(1);

    // Listeye dönünce bildirim kapanır; sayfanın canlı bölgesi yine vardır (boş).
    await user.click(within(sayfa).getByRole('button', { name: 'Listeye dön' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Örnek kase' })).toBeNull());
    expect(screen.queryByText('Değişiklik geri alındı.')).toBeNull();
    expect(document.querySelector('.aile-alimlar-bildirim-yuva [role="status"]')).toBeInTheDocument();
  });
});
