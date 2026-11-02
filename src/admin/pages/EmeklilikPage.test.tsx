// Emeklilik planı sayfası (#/emeklilik) — bileşim kökü + görünüm (MVVM). Görünüm yalnız ViewModel anlık görüntüsünü
// çizer ve komut çağırır; hesap yapmaz. Bağımlılıklar enjeksiyonla: sahte profil kaynağı (bellek) ve sahte planlayıcı
// (viewmodel/test/SahtePlanlayici: basit belirlenimci kurallar; gerçek model değildir). Profil yalnız sentetik fikstür.
// Telefon önce (yerel HTML, ARIA radyo grubu, akordeon tablo, Disclosure içinde TextField); geniş sunum lazyWide ile
// pages/emeklilik/EmeklilikGenis.wide.tsx (iki sütun, yapışkan sonuç) ve telefonda indirilmez.
// Profil durumları adıyla: yükleniyor, yok (dosya içe aktar; yalnız bellekte), hata, hazır; eski kayıt "Eski veri".
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { wideManifest } from '../adaptive';
import { importsOf } from '../adaptive/sourceRules';
import { DeviceContext } from '../device';
import type { Device } from '../shell/contracts';
import type { EmeklilikProfilKaynagi, EmeklilikProfili, ProfilDurumu } from '../emeklilik/contract';
import { SahtePlanlayici } from '../emeklilik/viewmodel/test/SahtePlanlayici';
import { EmeklilikPage, type EmeklilikPageProps } from './EmeklilikPage';

const PROFIL_METNI = readFileSync(resolve(__dirname, '../../../fixtures/emeklilik/profil-sentetik.json'), 'utf8');
const PROFIL = JSON.parse(PROFIL_METNI) as EmeklilikProfili;
// Amaç cümlesinin tek kaynağı shell/navigation.ts (emeklilik sayfa kaydı).
const AMAC = 'Askerlik, Bağ-Kur ve ihya seçeneklerinin emeklilik tarihine ve maliyetine etkisini karşılaştırın.';
const BUGUN = () => new Date('2026-11-02T12:00:00+03:00');

/** Bellekte profil kaynağı (repository sözleşmesi); dosya JSON olarak okunur, kalıcı depolama yok. */
class SahteProfilKaynagi implements EmeklilikProfilKaynagi {
  yenilemeSayisi = 0;
  yuklenenDosyalar: string[] = [];
  private mevcut: ProfilDurumu;
  private readonly dinleyiciler = new Set<() => void>();

  constructor(ilk: ProfilDurumu) {
    this.mevcut = ilk;
  }

  durum(): ProfilDurumu {
    return this.mevcut;
  }

  subscribe(dinleyici: () => void): () => void {
    this.dinleyiciler.add(dinleyici);
    return () => { this.dinleyiciler.delete(dinleyici); };
  }

  ayarla(durum: ProfilDurumu) {
    this.mevcut = durum;
    for (const d of [...this.dinleyiciler]) d();
  }

  async yenile(): Promise<void> {
    this.yenilemeSayisi++;
  }

  async dosyadanYukle(dosya: File): Promise<void> {
    this.yuklenenDosyalar.push(dosya.name);
    try {
      this.ayarla({ tur: 'hazir', profil: JSON.parse(await dosya.text()) as EmeklilikProfili, kaynak: 'dosya' });
    } catch {
      this.ayarla({ tur: 'hata', neden: 'Dosya JSON değil.' });
    }
  }

  temizle(): void {
    this.ayarla({ tur: 'yok', neden: 'Profil kaldırıldı.' });
  }
}

const hazir = (kaynak: 'gelistirme' | 'dosya' | 'sentetik' = 'gelistirme'): ProfilDurumu => ({ tur: 'hazir', profil: PROFIL, kaynak });

function ciz(device: Device, props: Partial<EmeklilikPageProps> & { profilKaynagi: EmeklilikProfilKaynagi }): { container: HTMLElement; tekrar: (ui: ReactNode) => void } {
  const sarmala = (ui: ReactNode) => <DeviceContext.Provider value={device}>{ui}</DeviceContext.Provider>;
  const sayfa = (
    <EmeklilikPage
      location="/emeklilik"
      planlayiciOlustur={profil => new SahtePlanlayici(profil)}
      mevzuat={{ borcKesintiTavani: 0.25 }}
      bugun={BUGUN}
      {...props}
    />
  );
  const { container, rerender } = render(sarmala(sayfa));
  return { container, tekrar: ui => rerender(sarmala(ui)) };
}

const bolge = (ad: string) => screen.getByRole('region', { name: ad });
const soru = (ad: string) => screen.getByRole('radiogroup', { name: ad });
const ay = () => within(bolge('Sonuç')).getByTestId('planlama-ayi');

describe('EmeklilikPage › başlık ve profil durumları', () => {
  it('yükleniyor: başlık iskeleti kalır, profil okunurken iskelet ve adı; kaynak bir kez yenilenir', () => {
    const kaynak = new SahteProfilKaynagi({ tur: 'yukleniyor' });
    ciz('phone', { profilKaynagi: kaynak });
    expect(screen.getByRole('heading', { level: 1, name: 'Emeklilik planı' })).toBeInTheDocument();
    expect(screen.getByText('Para')).toBeInTheDocument();
    expect(screen.getByText(AMAC)).toBeInTheDocument();
    expect(screen.getByText('Profil okunuyor').closest('[role="status"]')).toHaveAttribute('aria-busy', 'true');
    expect(kaynak.yenilemeSayisi).toBe(1);
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  });

  it('yok: "Profil dosyasını içe aktar" ve yalnız bellekte tutulur metni; içe aktarılan dosya hesaplanır', async () => {
    const kaynak = new SahteProfilKaynagi({ tur: 'yok', neden: 'Bu ortamda varsayılan profil yok.' });
    ciz('phone', { profilKaynagi: kaynak });
    expect(screen.getByRole('heading', { level: 2, name: 'Profil yok' })).toBeInTheDocument();
    expect(screen.getByText('Bu ortamda varsayılan profil yok.')).toBeInTheDocument();
    expect(screen.getByText(/yalnız bu sekmenin belleğinde tutulur/)).toBeInTheDocument();
    const girdi = screen.getByLabelText('Profil dosyasını içe aktar');
    expect(girdi).toHaveAttribute('type', 'file');
    expect(girdi).toHaveAttribute('accept', expect.stringContaining('.json'));
    await userEvent.upload(girdi, new File([PROFIL_METNI], 'profil-sentetik.json', { type: 'application/json' }));
    expect(kaynak.yuklenenDosyalar).toEqual(['profil-sentetik.json']);
    expect(await screen.findByRole('region', { name: 'Sonuç' })).toBeInTheDocument();
    expect(screen.getByText(/İçe aktarılan dosya/)).toBeInTheDocument();
  });

  it('hata: "Hata: Profil okunamadı" ve neden; tutar gösterilmez; Yeniden dene kaynağı yeniler; dosya içe aktarılabilir', async () => {
    const kaynak = new SahteProfilKaynagi({ tur: 'hata', neden: 'Profil şeması geçersiz: surum alanı yok.' });
    ciz('phone', { profilKaynagi: kaynak });
    const uyari = screen.getByRole('alert');
    expect(uyari).toHaveTextContent('Hata: Profil okunamadı');
    expect(uyari).toHaveTextContent('Profil şeması geçersiz: surum alanı yok.');
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
    const once = kaynak.yenilemeSayisi;
    await userEvent.click(within(uyari).getByRole('button', { name: 'Yeniden dene' }));
    expect(kaynak.yenilemeSayisi).toBe(once + 1);
    expect(screen.getByLabelText('Profil dosyasını içe aktar')).toBeInTheDocument();
  });

  it('hesap hatası: planlayıcı kurulamazsa adıyla hata, sayfa çökmez', () => {
    const kaynak = new SahteProfilKaynagi(hazir());
    ciz('phone', { profilKaynagi: kaynak, planlayiciOlustur: () => { throw new Error('Emeklilik modeli henüz uygulanmadı (taslak).'); } });
    const uyari = screen.getByRole('alert');
    expect(uyari).toHaveTextContent('Hata: Hesap yapılamadı');
    expect(uyari).toHaveTextContent('Emeklilik modeli henüz uygulanmadı (taslak).');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('hazır: profil satırı (sentetik, kayıt, kaynak); 30 günden eski kayıt "Eski veri" adıyla', () => {
    const kaynak = new SahteProfilKaynagi(hazir());
    const { tekrar } = ciz('phone', { profilKaynagi: kaynak });
    const satir = screen.getByText('Sentetik profil · Kayıt 2 Kasım 2026 · Geliştirme dosyası');
    // Profil satırı başlık bağlamında (kısa); içe aktarma eylemi sayfanın sonunda, öneri ilk ekranda kalsın diye.
    expect(satir.closest('header')).not.toBeNull();
    const iceAktar = screen.getByLabelText('Başka profil içe aktar');
    expect(iceAktar.closest('header')).toBeNull();
    expect(bolge('İhya karşılaştırması').compareDocumentPosition(iceAktar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Eski veri/)).not.toBeInTheDocument();
    tekrar(
      <EmeklilikPage location="/emeklilik" profilKaynagi={kaynak} planlayiciOlustur={p => new SahtePlanlayici(p)} mevzuat={{ borcKesintiTavani: 0.25 }} bugun={() => new Date('2027-01-15T12:00:00+03:00')} />,
    );
    expect(screen.getByText(/^Eski veri: kayıt 2 Kasım 2026, 74 gün önce/)).toBeInTheDocument();
  });

  it('dosyadan yüklenen profil kaldırılabilir (bellekten silinir)', async () => {
    const kaynak = new SahteProfilKaynagi(hazir('dosya'));
    ciz('phone', { profilKaynagi: kaynak });
    await userEvent.click(screen.getByRole('button', { name: 'Profili kaldır' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Profil yok' })).toBeInTheDocument();
  });
});

describe('EmeklilikPage › telefon yolculuğu', () => {
  it('öneri ilk sırada; "Bunu seç" seçiliyken devre dışı ve nedeni yazılı', () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const oneri = bolge('Öneri');
    expect(oneri).toHaveTextContent('Senaryo önerisi');
    expect(oneri).toHaveTextContent('Askerlik + ihya');
    const dugme = within(oneri).getByRole('button', { name: 'Bunu seç' });
    expect(dugme).toBeDisabled();
    expect(oneri).toHaveTextContent('Öneri şu an seçili.');
    // Ana eylem gerekçeden önce: uzun gerekçe (en erken tarih senaryosu) 320×568'de eylemi ilk ekrandan itmez.
    const gerekce = within(oneri).getByText(/Sahte gerekçe/);
    expect(dugme.compareDocumentPosition(gerekce) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sira = [oneri, bolge('Seçimler'), bolge('Sonuç')];
    for (let i = 1; i < sira.length; i++) {
      expect(sira[i - 1]!.compareDocumentPosition(sira[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('radyo grubu APG ok tuşları: Sağ/Aşağı sonraki, Sol/Yukarı önceki (uçta başa döner); odak taşınır, seçim anında uygulanır', async () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const grup = soru('Askerliği borçlanacak mısınız?');
    const evet = within(grup).getByRole('radio', { name: 'Evet' });
    const hayir = within(grup).getByRole('radio', { name: 'Hayır' });
    evet.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(hayir).toHaveFocus();
    expect(hayir).toBeChecked();
    expect(ay()).toHaveTextContent('Ağustos 2031');
    await userEvent.keyboard('{ArrowDown}');
    expect(evet).toHaveFocus();
    expect(evet).toBeChecked();
    await userEvent.keyboard('{ArrowUp}');
    expect(hayir).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Maaş ve aylık varsayımları' }));
    const model = screen.getByRole('radiogroup', { name: 'Aylık modeli' });
    within(model).getByRole('radio', { name: /SGK referansı/ }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(model).getByRole('radio', { name: /Kazanç tahmini/ })).toHaveFocus();
    expect(within(model).getByRole('radio', { name: /Kazanç tahmini/ })).toBeChecked();
    expect(bolge('Sonuç')).toHaveTextContent('₺27.000,00');
  });

  it('üç bağımsız soru: yerel radyo grubu, açıklama satırı gün ve maliyet; seçim sonucu anında değiştirir; öneriye dönülür', async () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const askerlik = soru('Askerliği borçlanacak mısınız?');
    expect(soru('Bağ-Kur borcunu ödeyecek misiniz?')).toBeInTheDocument();
    expect(soru('Durdurulan Bağ-Kur sürelerini ihya edecek misiniz?')).toBeInTheDocument();
    const evet = within(askerlik).getByRole('radio', { name: 'Evet' });
    const hayir = within(askerlik).getByRole('radio', { name: 'Hayır' });
    expect(evet).toBeChecked();
    expect(evet.tagName).toBe('INPUT');
    expect(evet).toHaveAccessibleDescription('360 gün · ₺178.200,00');
    expect(ay()).toHaveTextContent('Ağustos 2030');
    await userEvent.click(hayir);
    expect(hayir).toBeChecked();
    expect(ay()).toHaveTextContent('Ağustos 2031');
    expect(screen.getByRole('status', { name: 'Anlık sonuç' })).toHaveTextContent('Ağustos 2031 · 45 yaşında · 16 ay erken');
    const dugme = within(bolge('Öneri')).getByRole('button', { name: 'Bunu seç' });
    expect(dugme).toBeEnabled();
    await userEvent.click(dugme);
    expect(ay()).toHaveTextContent('Ağustos 2030');
    expect(evet).toBeChecked();
  });

  it('sonuç özeti: ay, yaş, koşul, ödeme ve kalemleri, aylık + model adı, kesinti, ortak dönem farkı, geri kazanma', () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const sonuc = bolge('Sonuç');
    expect(sonuc).toHaveTextContent('Askerlik + ihya');
    expect(sonuc).toHaveTextContent('44 yaşında');
    expect(sonuc).toHaveTextContent('Tarihi prim günü belirliyor');
    expect(sonuc).toHaveTextContent('Hiçbir şey ödememeye göre 28 ay erken');
    const tanim = (etiket: string) => within(sonuc).getByText(etiket, { selector: 'dt' }).nextElementSibling as HTMLElement;
    expect(tanim('Geçmiş günler için ödeme')).toHaveTextContent('₺425.700,00');
    expect(tanim('Aylık')).toHaveTextContent('₺25.000,00');
    expect(tanim('Aylık')).toHaveTextContent('SGK referansı');
    // Varsayılan borç kaynağı "SGK düzeltilmiş tutarı bilinmiyor": kesinti süresi adıyla bilinmiyor.
    expect(tanim('Borç kesintisi')).toHaveTextContent('%10 kesinti · süre bilinmiyor');
    expect(tanim('Ortak dönem sonunda fark (10 yıl)')).toHaveTextContent('+₺274.300,00');
    expect(tanim('Ödemeyi karşılayan')).toHaveTextContent('18 emekli aylığı');
    expect(within(sonuc).getByRole('list', { name: 'Ödeme kalemleri' })).toHaveTextContent('Askerlik borçlanması₺178.200,00');
    // Tutarlar tabular hizada (aile-tutar).
    expect(within(sonuc).getByText('₺425.700,00')).toHaveClass('aile-tutar');
  });

  it('her seçimin payı listesi ve sekiz bileşim telefonda akordeon (ilk satır açık); satırdan bileşim seçilir', async () => {
    const { container } = ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const paylar = bolge('Her seçimin payı');
    expect(within(paylar).getAllByRole('listitem')).toHaveLength(3);
    expect(paylar).toHaveTextContent('Askerlik borçlanması');
    expect(paylar).toHaveTextContent('12 ay erken');
    const bilesimler = bolge('Sekiz bileşim');
    expect(within(bilesimler).queryByRole('table')).not.toBeInTheDocument();
    const basliklar = bilesimler.querySelectorAll('button.aile-acc-head');
    expect(basliklar).toHaveLength(8);
    expect(basliklar[0]).toHaveAttribute('aria-expanded', 'true');
    expect(bilesimler).toHaveTextContent('Aylık: SGK referansı.');
    await userEvent.click(basliklar[6]!);
    await userEvent.click(within(bilesimler).getAllByRole('button', { name: 'Bu bileşimi seç' }).at(-1)!);
    expect(ay()).toHaveTextContent('Aralık 2029');
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[class*="ant-"]')).toBeNull();
  });

  it('gün ve tutarlar: Disclosure içinde TextField; aralık dışı gün hatası alanın yanında; geçerli değer sonucu değiştirir', async () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const ac = screen.getByRole('button', { name: 'Gün ve tutarları düzenle' });
    expect(ac).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(ac);
    const gun = screen.getByLabelText('Askerlikten eklenecek gün');
    expect(gun).toHaveValue('360');
    await userEvent.clear(gun);
    await userEvent.type(gun, '9999');
    expect(gun).toHaveAttribute('aria-invalid', 'true');
    expect(gun).toHaveAccessibleDescription(expect.stringContaining('Hata: 0 ile 360 arasında bir gün girin.'));
    expect(bolge('Sonuç')).toHaveTextContent('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
    await userEvent.clear(gun);
    await userEvent.type(gun, '0');
    expect(gun).not.toHaveAttribute('aria-invalid', 'true');
    expect(ay()).toHaveTextContent('Ağustos 2031');
    const duzeltme = screen.getByRole('checkbox', { name: /Kayıttaki gün düzeltmesini uygula/ });
    expect(duzeltme).not.toBeChecked();
    await userEvent.click(duzeltme);
    expect(duzeltme).toBeChecked();
  });

  it('Bağ-Kur borcunun kaynağı: yerel radyo grubu, varsayılan "bilinmiyor"; tahmin ve girilen tutar sonucu anında değiştirir; sıfırla varsayılana döner', async () => {
    const { container } = ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    await userEvent.click(screen.getByRole('button', { name: 'Gün ve tutarları düzenle' }));
    const grup = screen.getByRole('radiogroup', { name: 'Bağ-Kur borcunun kaynağı' });
    const radyolar = within(grup).getAllByRole('radio');
    expect(radyolar.map(r => (r as HTMLInputElement).type)).toEqual(['radio', 'radio', 'radio']);
    const bilinmiyor = within(grup).getByRole('radio', { name: 'SGK düzeltilmiş tutarı bilinmiyor' });
    const tahmin = within(grup).getByRole('radio', { name: 'Sade araç tahmini (aralık)' });
    const elle = within(grup).getByRole('radio', { name: 'Tutarı gir' });
    expect(bilinmiyor).toBeChecked();
    expect(tahmin).toHaveAccessibleDescription(expect.stringMatching(/^₺280\.000,00 – ₺420\.000,00 · /));
    expect(screen.queryByLabelText('Düzeltilmiş Bağ-Kur borcu')).not.toBeInTheDocument();
    // Grup Bağ-Kur günü alanından sonra, ortak ödeme alanından önce durur.
    const gun = screen.getByLabelText('Kabul edilecek Bağ-Kur günü');
    const ortak = screen.getByLabelText('Yalnız SSK yolunda da ödenecek Bağ-Kur tutarı');
    expect(gun.compareDocumentPosition(grup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grup.compareDocumentPosition(ortak) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const bagkurEvet = within(soru('Bağ-Kur borcunu ödeyecek misiniz?')).getByRole('radio', { name: 'Evet' });
    expect(bagkurEvet).toHaveAccessibleDescription('600 gün · Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor');
    const tanim = (etiket: string) => within(bolge('Sonuç')).getByText(etiket, { selector: 'dt' }).nextElementSibling as HTMLElement;
    expect(tanim('Borç kesintisi')).toHaveTextContent('%10 kesinti · süre bilinmiyor');
    // Bağ-Kur'lu yolda fark bilinmiyor: neden değerlerin yanında yazılır, ayrı bir "Fark hesaplanamadı" satırında
    // yinelenmez (sonuç paneli kısa kalır; masaüstünde yapışkan panel ilk ekranın altına taşmaz).
    await userEvent.click(bagkurEvet);
    expect(tanim('Ortak dönem sonunda fark (10 yıl)')).toHaveTextContent('Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor');
    expect(tanim('Ödemeyi karşılayan')).toHaveTextContent('BilinmiyorSGK düzeltilmiş tutarı bilinmiyor');
    expect(within(bolge('Sonuç')).queryByText(/^Fark hesaplanamadı/)).not.toBeInTheDocument();
    await userEvent.click(within(soru('Bağ-Kur borcunu ödeyecek misiniz?')).getByRole('radio', { name: 'Hayır' }));

    await userEvent.click(tahmin);
    expect(tahmin).toBeChecked();
    expect(bagkurEvet).toHaveAccessibleDescription('600 gün · ₺280.000,00 – ₺420.000,00');
    expect(tanim('Borç kesintisi')).toHaveTextContent('%10 kesinti · 30 ay');

    // APG: ok tuşu sonraki seçeneğe geçer ve seçer.
    tahmin.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(elle).toHaveFocus();
    expect(elle).toBeChecked();
    const tutar = screen.getByLabelText('Düzeltilmiş Bağ-Kur borcu');
    expect(tutar).toHaveValue('300.000,00 – 450.000,00');
    await userEvent.clear(tutar);
    expect(tutar).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(tutar, '350.000,00');
    expect(tutar).not.toHaveAttribute('aria-invalid', 'true');
    expect(bagkurEvet).toHaveAccessibleDescription('600 gün · ₺350.000,00');

    await userEvent.click(screen.getByRole('button', { name: 'Varsayımları sıfırla' }));
    expect(bilinmiyor).toBeChecked();
    expect(screen.queryByLabelText('Düzeltilmiş Bağ-Kur borcu')).not.toBeInTheDocument();
    expect(bagkurEvet).toHaveAccessibleDescription('600 gün · Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor');
    expect(container.querySelector('select')).toBeNull();
  });

  it('Bağ-Kur borcunun kaynağı: profilde tahmin yoksa yalnız "bilinmiyor" ve "Tutarı gir" sunulur', async () => {
    const profil = structuredClone(PROFIL);
    delete (profil.secenekler.bagkur as { tahminiBorc?: unknown }).tahminiBorc;
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi({ tur: 'hazir', profil, kaynak: 'gelistirme' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Gün ve tutarları düzenle' }));
    const grup = screen.getByRole('radiogroup', { name: 'Bağ-Kur borcunun kaynağı' });
    expect(within(grup).getAllByRole('radio').map(r => r.getAttribute('aria-labelledby') && (document.getElementById(r.getAttribute('aria-labelledby')!)?.textContent ?? ''))).toEqual([
      'SGK düzeltilmiş tutarı bilinmiyor', 'Tutarı gir',
    ]);
  });

  it('maaş ve aylık: model seçimi radyo grubu; "Elle girilen" zorunlu alanı açar; sıfırla varsayımları geri getirir', async () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    await userEvent.click(screen.getByRole('button', { name: 'Maaş ve aylık varsayımları' }));
    const model = screen.getByRole('radiogroup', { name: 'Aylık modeli' });
    expect(within(model).getByRole('radio', { name: /SGK referansı/ })).toBeChecked();
    expect(screen.queryByLabelText('Elle aylık (net)')).not.toBeInTheDocument();
    await userEvent.click(within(model).getByRole('radio', { name: /Elle girilen/ }));
    const elle = screen.getByLabelText('Elle aylık (net)');
    expect(elle).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(elle, '30.000,00');
    expect(elle).not.toHaveAttribute('aria-invalid', 'true');
    expect(bolge('Sonuç')).toHaveTextContent('₺30.000,00');
    expect(bolge('Sonuç')).toHaveTextContent('Elle girilen');
    await userEvent.click(screen.getByRole('button', { name: 'Varsayımları sıfırla' }));
    expect(within(model).getByRole('radio', { name: /SGK referansı/ })).toBeChecked();
    expect(bolge('Sonuç')).toHaveTextContent('₺25.000,00');
  });

  it('ihya karşılaştırması: iki yol, iki net aylık ve süre; sonuç adıyla', async () => {
    ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    const ihya = bolge('İhya karşılaştırması');
    expect(ihya).toHaveTextContent('Askerlik + ihya');
    expect(ihya).toHaveTextContent('Yalnız askerlik');
    expect(ihya).toHaveTextContent('İhya ile 16 ay erken');
    await userEvent.type(within(ihya).getByLabelText('İhya eklenen yolda net aylık'), '30.000,00');
    expect(ihya).toHaveTextContent('+₺54.300,00');
    const sure = within(ihya).getByLabelText('İki yol da emekli olduktan sonraki süre');
    await userEvent.clear(sure);
    await userEvent.type(sure, '50');
    expect(sure).toHaveAttribute('aria-invalid', 'true');
  });

  it('telefon geniş modülü istemez; kök telefon yerleşimini adlandırır', () => {
    const { container } = ciz('phone', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    expect(container.querySelector('[data-emeklilik-yerlesim]')).toHaveAttribute('data-emeklilik-yerlesim', 'telefon');
    expect(wideManifest().find(entry => entry.key === 'emeklilik-genis')?.status ?? 'idle').toBe('idle');
  });
});

describe('EmeklilikPage › geniş', () => {
  it('masaüstü: lazyWide ile iki sütun; sonuç sağda yapışkan sütunda, seçimler solda; bileşimler tablo', async () => {
    const { container } = ciz('desktop', { profilKaynagi: new SahteProfilKaynagi(hazir()) });
    await waitFor(() => expect(container.querySelector('[data-emeklilik-yerlesim]')).toHaveAttribute('data-emeklilik-yerlesim', 'genis'), { timeout: 5000 });
    const sag = container.querySelector('[data-yapiskan]');
    expect(sag).not.toBeNull();
    expect(sag!.contains(bolge('Sonuç'))).toBe(true);
    expect(sag!.contains(bolge('Seçimler'))).toBe(false);
    expect(within(bolge('Sekiz bileşim')).getByRole('table')).toBeInTheDocument();
    // Geniş sunum aynı ViewModel'i kullanır: seçim anında sonucu değiştirir.
    await act(async () => { await userEvent.click(within(soru('Askerliği borçlanacak mısınız?')).getByRole('radio', { name: 'Hayır' })); });
    expect(ay()).toHaveTextContent('Ağustos 2031');
  });
});

// Mimari kapı: görünüm parçaları modele ve sözleşmeye değil, yalnız ViewModel'e (ve ui/) bağlıdır; hesap bileşim kökündedir.
describe('EmeklilikPage › katman kapısı', () => {
  const kok = resolve(__dirname, 'emeklilik');
  const dosyalar = (dizin: string): string[] => readdirSync(dizin).flatMap(ad => {
    const yol = join(dizin, ad);
    return statSync(yol).isDirectory() ? dosyalar(yol) : /\.tsx?$/.test(ad) && !/\.test\./.test(ad) ? [yol] : [];
  });

  it('pages/emeklilik/** imports neither the model nor the data source; only the composition root wires them', () => {
    const ihlaller = dosyalar(kok).flatMap(yol => importsOf(readFileSync(yol, 'utf8'))
      .filter(ref => /emeklilik\/(model|data)(\/|$)/.test(ref.specifier))
      .map(ref => `${relative(kok, yol)} → ${ref.specifier}`));
    expect(ihlaller).toEqual([]);
    expect(dosyalar(kok).length).toBeGreaterThan(2);
  });
});
