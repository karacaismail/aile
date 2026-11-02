// EmeklilikPlaniViewModel birim testleri. Planlayıcı bağımlılık enjeksiyonuyla sahte (test/SahtePlanlayici: basit,
// belirlenimci kurallar; gerçek model değildir). Profil yalnız sentetik fikstür. Beklenen metinler sahte kurallardan elle
// türetilmiştir: taban ay Aralık 2032; eklenen her 30 gün bir ay erken; günlük bedel ₺495,00; aylık ₺25.000,00.
// Sınanan sözleşme: komutlar (seçim, öneri, alan güncelleme + Türkçe ayrıştırma + aralık/zorunluluk doğrulaması, sıfırlama,
// ihya karşılaştırma girdileri), değişmez anlık görüntü (aynı durumda aynı başvuru; yalnız biçimli metin ve görünüm
// verisi), abonelik ve hesap hatasının adıyla gösterilmesi.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EmeklilikProfili } from '../contract';
import { EmeklilikPlaniViewModel } from './EmeklilikPlaniViewModel';
import type { AlanGorunumu, EmeklilikEkrani } from './ekran';
import { SahtePlanlayici } from './test/SahtePlanlayici';

const PROFIL = JSON.parse(readFileSync(resolve(__dirname, '../../../../fixtures/emeklilik/profil-sentetik.json'), 'utf8')) as EmeklilikProfili;
const MEVZUAT = { borcKesintiTavani: 0.25 };

const BUGUN = () => new Date('2026-11-02T12:00:00+03:00');
// Bağ-Kur borcunun varsayılan kaynağı "SGK düzeltilmiş tutarı bilinmiyor"dur: profil aralık taşısa da borç bilinmiyor
// başlar (tutar uydurulmaz); bu yüzden Bağ-Kur kalemi, kesinti süresi ve Bağ-Kur'lu yolların farkı adıyla bilinmiyordur.
const SGK_BILINMIYOR = { tur: 'bilinmiyor', neden: 'SGK düzeltilmiş tutarı bilinmiyor' } as const;
const BILINMIYOR_METNI = 'Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor';
const ELLE_BOS_HATA = 'Hata: Tutarı girin; bilinmiyorsa “SGK düzeltilmiş tutarı bilinmiyor” seçeneğini seçin.';

function kur(ayarlar: ConstructorParameters<typeof SahtePlanlayici>[1] = {}) {
  const planlayici = new SahtePlanlayici(PROFIL, ayarlar);
  const vm = new EmeklilikPlaniViewModel(planlayici, PROFIL, { mevzuat: MEVZUAT, bugun: BUGUN });
  return { planlayici, vm, ekran: () => vm.getSnapshot() };
}

function alan(ekran: EmeklilikEkrani, anahtar: string): AlanGorunumu {
  const bulunan = ekran.form?.gruplar.flatMap(grup => grup.alanlar).find(a => a.anahtar === anahtar);
  if (!bulunan) throw new Error(`alan yok: ${anahtar}`);
  return bulunan;
}

function derinDondurulmus(deger: unknown, yol = 'ekran'): string[] {
  if (deger === null || typeof deger !== 'object') return [];
  const kendi = Object.isFrozen(deger) ? [] : [yol];
  return [...kendi, ...Object.entries(deger).flatMap(([k, v]) => derinDondurulmus(v, `${yol}.${k}`))];
}

describe('EmeklilikPlaniViewModel › ilk anlık görüntü', () => {
  it('starts from the recommendation and formats the selected path (month, age, payment, monthly with model, deduction)', () => {
    const { ekran } = kur();
    const e = ekran();
    expect(e.hesap).toEqual({ durum: 'hazir', neden: null });
    expect(e.sorular.map(s => [s.anahtar, s.evet])).toEqual([['askerlik', true], ['bagkur', false], ['ihya', true]]);
    expect(e.sonuc).not.toBeNull();
    const s = e.sonuc!;
    expect(s.secimAdi).toBe('Askerlik + ihya');
    expect(s.planlamaAyi).toBe('Ağustos 2030');
    expect(s.yas).toBe('44 yaşında');
    expect(s.sinirlayan).toBe('Tarihi prim günü belirliyor');
    expect(s.erken).toBe('Hiçbir şey ödememeye göre 28 ay erken');
    expect(s.calisarak).toBe('1.540 gün planlanan çalışmayla tamamlanır');
    expect(s.odeme).toEqual({ etiket: 'Geçmiş günler için ödeme', deger: '₺425.700,00', not: null, ton: 'notr', bicim: 'tutar' });
    expect(s.odemeKalemleri).toEqual([
      { ad: 'Askerlik borçlanması', tutar: '₺178.200,00' },
      { ad: 'İhya', tutar: '₺247.500,00' },
    ]);
    expect(s.aylik).toEqual({ etiket: 'Aylık', deger: '₺25.000,00', not: 'SGK referansı', ton: 'notr', bicim: 'tutar' });
    // Borç bilinmiyor (varsayılan kaynak): kesinti oranı bilinir, süresi bilinmez.
    expect(s.kesinti).toEqual({ etiket: 'Borç kesintisi', deger: '%10 kesinti · süre bilinmiyor', not: 'Ödenmeyen Bağ-Kur borcu bitene kadar', ton: 'uyari', bicim: 'metin' });
    expect(s.donemSonunda).toEqual({ etiket: 'Ortak dönem sonunda fark (10 yıl)', deger: '+₺274.300,00', not: null, ton: 'olumlu', bicim: 'tutar' });
    expect(s.gecYolEmekliOlunca).toEqual({ etiket: 'Geç yol emekli olduğunda fark', deger: '+₺274.300,00', not: null, ton: 'olumlu', bicim: 'tutar' });
    // Geri kazanma (başa baş): hiçbir şey ödemeyen yola göre birikimli farkın sıfıra ulaştığı ay, emeklilikten sayılır.
    expect(s.geriKazanma).toEqual({ etiket: 'Geri kazanma', deger: '18 ay sonra', not: null, ton: 'notr', bicim: 'metin' });
    expect(s.referansMi).toBe(false);
    expect(s.duyuru).toBe('Ağustos 2030 · 44 yaşında · 28 ay erken');
  });

  it('describes each question with days and cost (cost from the all-options path; unknown debt named, ranges kept as ranges)', () => {
    const { vm, ekran } = kur();
    expect(ekran().sorular).toEqual([
      { anahtar: 'askerlik', soru: 'Askerliği borçlanacak mısınız?', aciklama: '360 gün · ₺178.200,00', evet: true },
      { anahtar: 'bagkur', soru: 'Bağ-Kur borcunu ödeyecek misiniz?', aciklama: `600 gün · ${BILINMIYOR_METNI}`, evet: false },
      { anahtar: 'ihya', soru: 'Durdurulan Bağ-Kur sürelerini ihya edecek misiniz?', aciklama: '500 gün · ₺247.500,00', evet: true },
    ]);
    vm.borcKaynagiSec('tahmin');
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · ₺280.000,00 – ₺420.000,00');
  });

  it('names the recommendation; the action is disabled with a reason while it is selected', () => {
    const { ekran } = kur();
    expect(ekran().oneri).toEqual({
      etiket: 'Senaryo önerisi',
      secimAdi: 'Askerlik + ihya',
      gerekce: 'Sahte gerekçe: ortak dönem sonunda en yüksek fark.',
      saglamlik: 'Kesinti olmasa ya da borç aralığın üst ucunda olsa da aynı öneri.',
      secili: true,
      eylem: 'Bunu seç',
      devreDisiNedeni: 'Öneri şu an seçili.',
    });
  });

  it('calls a non-financial recommendation "En erken tarih senaryosu" and says it may change', () => {
    const { ekran } = kur({ oneri: { tur: 'enErkenTarih', saglam: false, secim: { askerlik: true, bagkur: true, ihya: true } } });
    const o = ekran().oneri!;
    expect(o.etiket).toBe('En erken tarih senaryosu');
    expect(o.secimAdi).toBe('Üçü birlikte');
    expect(o.saglamlik).toBe('Varsayımlar değişirse öneri değişebilir.');
    expect(ekran().sonuc!.odeme).toMatchObject({ deger: BILINMIYOR_METNI, bicim: 'metin' });
  });

  it('lists the eight combinations in contract order with formatted cells and the selected one marked', () => {
    const { vm, ekran } = kur();
    const satirlar = ekran().bilesimler;
    expect(satirlar.map(s => s.secimAdi)).toEqual([
      'Hiçbir şey ödememek', 'Yalnız askerlik', 'Yalnız Bağ-Kur borcu', 'Yalnız ihya',
      'Askerlik + Bağ-Kur borcu', 'Askerlik + ihya', 'Bağ-Kur borcu + ihya', 'Üçü birlikte',
    ]);
    expect(satirlar.map(s => s.anahtar)).toEqual(['hicbiri', 'askerlik', 'bagkur', 'ihya', 'askerlik+bagkur', 'askerlik+ihya', 'bagkur+ihya', 'askerlik+bagkur+ihya']);
    expect(satirlar.filter(s => s.secili).map(s => s.anahtar)).toEqual(['askerlik+ihya']);
    expect(satirlar[0]).toMatchObject({ emeklilik: 'Aralık 2032', yas: '46', erken: 'Referans', odeme: 'Ödeme yok', donemSonunda: 'Referans yol', geriKazanma: 'Gerekmez' });
    expect(satirlar[1]).toMatchObject({ emeklilik: 'Aralık 2031', yas: '45', erken: '12 ay erken', odeme: '₺178.200,00', aylik: '₺25.000,00', donemSonunda: '+₺121.800,00', donemTon: 'olumlu', geriKazanma: '8 ay' });
    // Tablo hücresi kısa kalır ("Bilinmiyor"); neden ayrı alanda, hücrenin altında yazılır.
    expect(satirlar[2]).toMatchObject({
      emeklilik: 'Nisan 2031', odeme: 'Bilinmiyor', odemeNedeni: 'SGK düzeltilmiş tutarı bilinmiyor',
      donemSonunda: 'Bilinmiyor', donemNedeni: 'SGK düzeltilmiş tutarı bilinmiyor', donemTon: 'notr', geriKazanma: 'Bilinmiyor',
    });
    expect(satirlar[1]).toMatchObject({ donemNedeni: null, odemeNedeni: null, aylikNedeni: null });
    // Aralıklı borçta ödeme aralık yazılır; sahte planlayıcı aralıktan tek fark üretmez ve nedenini söyler.
    vm.borcKaynagiSec('tahmin');
    expect(ekran().bilesimler[2]).toMatchObject({ odeme: '₺280.000,00 – ₺420.000,00', odemeNedeni: null, donemSonunda: 'Bilinmiyor', donemNedeni: 'Ödeme aralık; tek fark hesaplanmadı' });
  });

  it('names a payback that does not happen within the common period ("geri dönmüyor") apart from an unknown one', () => {
    const { vm, ekran } = kur();
    // Askerlik bedeli 360 × ₺5.000,00 + ihya ₺247.500,00 = ₺2.047.500,00; ⌈÷ ₺25.000,00⌉ = 82 ay > 28 ay erken.
    vm.alanGuncelle('askerlikGunlukBedel', '5.000,00');
    expect(ekran().sonuc!.geriKazanma).toEqual({
      etiket: 'Geri kazanma', deger: 'Dönem içinde geri dönmüyor', not: 'Ortak dönem içinde birikimli fark sıfıra ulaşmıyor.', ton: 'notr', bicim: 'metin',
    });
    expect(ekran().bilesimler.find(s => s.anahtar === 'askerlik+ihya')!.geriKazanma).toBe('Geri dönmüyor');
    vm.secimDegistir('bagkur', true);
    expect(ekran().sonuc!.geriKazanma).toEqual({ etiket: 'Geri kazanma', deger: 'Bilinmiyor', not: 'SGK düzeltilmiş tutarı bilinmiyor', ton: 'notr', bicim: 'metin' });
  });

  it('shows each choice’s share with the other choices held', () => {
    const { ekran } = kur();
    expect(ekran().paylar).toEqual([
      { anahtar: 'askerlik', ad: 'Askerlik borçlanması', durum: 'Seçili', erken: '12 ay erken', ekOdeme: '₺178.200,00', donemSonunda: '-₺125.700,00', ton: 'hata' },
      { anahtar: 'bagkur', ad: 'Bağ-Kur borcunu ödemek', durum: 'Seçili değil', erken: '20 ay erken', ekOdeme: BILINMIYOR_METNI, donemSonunda: BILINMIYOR_METNI, ton: 'notr' },
      { anahtar: 'ihya', ad: 'İhya', durum: 'Seçili', erken: '16 ay erken', ekOdeme: '₺247.500,00', donemSonunda: '-₺25.700,00', ton: 'hata' },
    ]);
  });

  it('carries only frozen data; the same state returns the same snapshot reference', () => {
    const { vm } = kur();
    const ilk = vm.getSnapshot();
    expect(vm.getSnapshot()).toBe(ilk);
    expect(derinDondurulmus(ilk)).toEqual([]);
    expect(() => { (ilk.sorular as unknown as unknown[]).push(1); }).toThrow(TypeError);
    // Görünüm verisi: işlev yok, model nesnesi (TutarBilgisi, Secim) yok.
    const json = JSON.stringify(ilk);
    expect(json).not.toMatch(/"tur":"(bilinen|aralik|bilinmiyor)"/);
    expect(json).not.toMatch(/"askerlik":(true|false)/);
  });

  it('labels the profile (synthetic flag, record date) without personal identifiers', () => {
    const { ekran } = kur();
    expect(ekran().profil).toEqual({
      etiket: 'Sentetik profil',
      kayit: 'Kayıt 2 Kasım 2026',
      kaynaklar: PROFIL.kaynaklar,
      tazelik: { durum: 'guncel', metin: 'Kayıt 2 Kasım 2026' },
    });
  });

  it('names stale profile data ("Eski veri") once the record is older than 30 days', () => {
    const planlayici = new SahtePlanlayici(PROFIL);
    const gun = (iso: string) => () => new Date(`${iso}T12:00:00+03:00`);
    const taze = new EmeklilikPlaniViewModel(planlayici, PROFIL, { mevzuat: MEVZUAT, bugun: gun('2026-12-02') });
    expect(taze.getSnapshot().profil.tazelik).toEqual({ durum: 'guncel', metin: 'Kayıt 2 Kasım 2026' });
    const eski = new EmeklilikPlaniViewModel(planlayici, PROFIL, { mevzuat: MEVZUAT, bugun: gun('2027-01-15') });
    expect(eski.getSnapshot().profil.tazelik).toEqual({ durum: 'eski', metin: 'Eski veri: kayıt 2 Kasım 2026, 74 gün önce. Gün ve tutarları SGK kayıtlarıyla yenileyin.' });
  });
});

describe('EmeklilikPlaniViewModel › komutlar', () => {
  it('secimDegistir updates the path at once, notifies once, and leaves the cached combinations alone', () => {
    const { vm, planlayici, ekran } = kur();
    const dinleyici = vi.fn();
    vm.subscribe(dinleyici);
    const bilesimCagrisi = planlayici.cagrilar.tumBilesimler;
    const oneriCagrisi = planlayici.cagrilar.oneri;
    const once = ekran();
    vm.secimDegistir('askerlik', false);
    expect(dinleyici).toHaveBeenCalledTimes(1);
    expect(ekran()).not.toBe(once);
    expect(ekran().sorular[0]!.evet).toBe(false);
    expect(ekran().sonuc!.planlamaAyi).toBe('Ağustos 2031');
    expect(ekran().sonuc!.secimAdi).toBe('Yalnız ihya');
    expect(ekran().oneri!.secili).toBe(false);
    expect(ekran().oneri!.devreDisiNedeni).toBeNull();
    expect(ekran().bilesimler.filter(s => s.secili).map(s => s.anahtar)).toEqual(['ihya']);
    expect(planlayici.cagrilar.tumBilesimler).toBe(bilesimCagrisi);
    expect(planlayici.cagrilar.oneri).toBe(oneriCagrisi);
    // Aynı değer: durum değişmez, bildirim yok.
    vm.secimDegistir('askerlik', false);
    expect(dinleyici).toHaveBeenCalledTimes(1);
  });

  it('oneriyiSec returns to the recommendation; bilesimSec picks a table row by key', () => {
    const { vm, ekran } = kur();
    vm.secimDegistir('askerlik', false);
    vm.oneriyiSec();
    expect(ekran().sonuc!.secimAdi).toBe('Askerlik + ihya');
    expect(ekran().oneri!.secili).toBe(true);
    vm.bilesimSec('bagkur+ihya');
    expect(ekran().sorular.map(s => s.evet)).toEqual([false, true, true]);
    expect(ekran().sonuc!.planlamaAyi).toBe('Aralık 2029');
    vm.bilesimSec('hicbiri');
    expect(ekran().sonuc!.referansMi).toBe(true);
    expect(ekran().sonuc!.erken).toBe('Referans yol: hiçbir şey ödemeden');
    expect(ekran().sonuc!.odeme.deger).toBe('Ödeme yok');
    expect(ekran().sonuc!.duyuru).toBe('Aralık 2032 · 46 yaşında');
    expect(() => vm.bilesimSec('yok')).toThrow(/Bilinmeyen bileşim/);
  });

  it('unsubscribe stops notifications', () => {
    const { vm } = kur();
    const dinleyici = vi.fn();
    const birak = vm.subscribe(dinleyici);
    birak();
    vm.secimDegistir('bagkur', true);
    expect(dinleyici).not.toHaveBeenCalled();
  });
});

describe('EmeklilikPlaniViewModel › alan doğrulaması', () => {
  it('rejects an out-of-range day next to the field, keeps the draft and computes with the last valid value', () => {
    const { vm, planlayici, ekran } = kur();
    expect(alan(ekran(), 'askerlikGun')).toMatchObject({ etiket: 'Askerlikten eklenecek gün', metin: '360', hata: null, girisModu: 'numeric' });
    const bilesimCagrisi = planlayici.cagrilar.tumBilesimler;
    vm.alanGuncelle('askerlikGun', '9999');
    expect(alan(ekran(), 'askerlikGun')).toMatchObject({ metin: '9999', hata: 'Hata: 0 ile 360 arasında bir gün girin.' });
    expect(planlayici.sonVarsayim!.secenekGirdileri.askerlik.gun).toBe(360);
    expect(planlayici.cagrilar.tumBilesimler).toBe(bilesimCagrisi);
    expect(ekran().form!.hataOzeti).toBe('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
    vm.alanGuncelle('askerlikGun', '1,5');
    expect(alan(ekran(), 'askerlikGun').hata).toBe('Hata: Tam sayı girin; ör. 360.');
    vm.alanGuncelle('askerlikGun', '300');
    expect(alan(ekran(), 'askerlikGun').hata).toBeNull();
    expect(ekran().form!.hataOzeti).toBeNull();
    expect(planlayici.sonVarsayim!.secenekGirdileri.askerlik.gun).toBe(300);
    expect(planlayici.cagrilar.tumBilesimler).toBe(bilesimCagrisi + 1);
    expect(ekran().sorular[0]!.aciklama).toBe('300 gün · ₺148.500,00');
  });

  it('accepts thousands separators in days up to the target day count', () => {
    const { vm, planlayici, ekran } = kur();
    vm.alanGuncelle('ihyaGun', '1.200');
    expect(alan(ekran(), 'ihyaGun').hata).toBeNull();
    expect(planlayici.sonVarsayim!.secenekGirdileri.ihya.gun).toBe(1200);
    vm.alanGuncelle('ihyaGun', '6.000');
    expect(alan(ekran(), 'ihyaGun').hata).toBe('Hata: 0 ile 5.900 arasında bir gün girin.');
  });

  it('parses Turkish money (8.500,00) into exact TL text; empty optional money means "use the official rate"', () => {
    const { vm, planlayici, ekran } = kur();
    expect(alan(ekran(), 'askerlikGunlukBedel')).toMatchObject({ metin: '', bicim: 'para', girisModu: 'decimal', zorunlu: false });
    vm.alanGuncelle('askerlikGunlukBedel', '600,50');
    expect(planlayici.sonVarsayim!.secenekGirdileri.askerlik.gunlukBedelTl).toBe('600.50');
    vm.alanGuncelle('askerlikGunlukBedel', '8.5');
    expect(alan(ekran(), 'askerlikGunlukBedel').hata).toBe('Hata: Tutarı 8.500,00 biçiminde girin.');
    vm.alanGuncelle('askerlikGunlukBedel', '');
    expect(alan(ekran(), 'askerlikGunlukBedel').hata).toBeNull();
    expect(planlayici.sonVarsayim!.secenekGirdileri.askerlik.gunlukBedelTl).toBeNull();
  });

  it('requires other deductions; zero is a valid answer', () => {
    const { vm, planlayici, ekran } = kur();
    expect(alan(ekran(), 'digerKesintiler')).toMatchObject({ metin: '0,00', zorunlu: true });
    vm.alanGuncelle('digerKesintiler', '');
    expect(alan(ekran(), 'digerKesintiler').hata).toBe('Hata: Boş bırakılamaz; kesinti yoksa 0 yazın.');
    vm.alanGuncelle('digerKesintiler', '1.250,00');
    expect(planlayici.sonVarsayim!.digerKesintilerTl).toBe('1250.00');
  });

  it('bounds the debt deduction rate by the legal ceiling and the late-fee rate by its range', () => {
    const { vm, planlayici, ekran } = kur();
    expect(alan(ekran(), 'borcKesintiOrani')).toMatchObject({ metin: '10', sonek: '%' });
    vm.alanGuncelle('borcKesintiOrani', '30');
    expect(alan(ekran(), 'borcKesintiOrani').hata).toBe('Hata: %0 ile %25 arasında bir oran girin.');
    vm.alanGuncelle('borcKesintiOrani', '0');
    expect(planlayici.sonVarsayim!.borcKesintiOrani).toBe(0);
    expect(ekran().sonuc!.kesinti).toEqual({ etiket: 'Borç kesintisi', deger: 'Kesinti yok', not: null, ton: 'notr', bicim: 'metin' });
    vm.alanGuncelle('bagkurGecikmeOrani', '3');
    expect(planlayici.sonVarsayim!.bagkurGecikmeAylikOran).toBe(0.03);
    vm.alanGuncelle('bagkurGecikmeOrani', '15');
    expect(alan(ekran(), 'bagkurGecikmeOrani').hata).toBe('Hata: %0 ile %10 arasında bir oran girin.');
    vm.alanGuncelle('bagkurGecikmeOrani', '');
    expect(planlayici.sonVarsayim!.bagkurGecikmeAylikOran).toBeNull();
  });

  it('bounds comparison years and monthly work days; zero work days names an unreachable date', () => {
    const { vm, ekran } = kur();
    vm.alanGuncelle('karsilastirmaSuresi', '41');
    expect(alan(ekran(), 'karsilastirmaSuresi').hata).toBe('Hata: 0 ile 40 arasında bir yıl girin.');
    vm.alanGuncelle('karsilastirmaSuresi', '5');
    expect(ekran().sonuc!.donemSonunda.etiket).toBe('Ortak dönem sonunda fark (5 yıl)');
    vm.alanGuncelle('gelecekAyBasinaGun', '31');
    expect(alan(ekran(), 'gelecekAyBasinaGun').hata).toBe('Hata: 0 ile 30 arasında bir gün girin.');
    vm.alanGuncelle('gelecekAyBasinaGun', '0');
    expect(ekran().sonuc!.planlamaAyi).toBe('Ulaşılamıyor');
    expect(ekran().sonuc!.yas).toBe('Yaş bilinmiyor');
    expect(ekran().sonuc!.erken).toBe('Bilinmiyor');
  });

  it('shows the manual monthly field only for the manual model and requires it there', () => {
    const { vm, ekran } = kur();
    expect(ekran().form!.aylikModeli.secili).toBe('sgkReferans');
    expect(ekran().form!.aylikModeli.secenekler.map(s => s.etiket)).toEqual(['SGK referansı', 'Kazanç tahmini', 'Elle girilen']);
    expect(() => alan(ekran(), 'elleAylik')).toThrow(/alan yok/);
    vm.aylikModeliSec('kazancTahmini');
    expect(ekran().sonuc!.aylik).toMatchObject({ deger: '₺27.000,00', not: 'Kazanç tahmini' });
    vm.aylikModeliSec('elle');
    expect(alan(ekran(), 'elleAylik')).toMatchObject({ metin: '', zorunlu: true, hata: 'Hata: Elle aylık için tutar girin.' });
    expect(ekran().sonuc!.aylik).toMatchObject({ deger: 'Bilinmiyor · Elle aylık girilmedi.', not: 'Elle girilen', bicim: 'metin' });
    expect(ekran().bilesimler[1]).toMatchObject({ aylik: 'Bilinmiyor', aylikNedeni: 'Elle aylık girilmedi.' });
    vm.alanGuncelle('elleAylik', '30.000,00');
    expect(alan(ekran(), 'elleAylik').hata).toBeNull();
    expect(ekran().sonuc!.aylik).toMatchObject({ deger: '₺30.000,00', not: 'Elle girilen' });
  });

  it('shows the wage used in the comparison next to the wage flag with its source; it is not editable', () => {
    const { vm, ekran } = kur();
    const bayrak = () => ekran().form!.gruplar.flatMap(g => g.bayraklar).find(b => b.anahtar === 'isUcretiDevam')!;
    expect(bayrak().not).toBe('İş ücreti ayda ₺80.000,00 (profildeki net ücret); iki yolda aynı olduğundan farka girmez.');
    vm.bayrakDegistir('isUcretiDevam', false);
    expect(bayrak().not).toBe('Vazgeçilen ücret ayda ₺80.000,00 (profildeki net ücret); emekli olan yol işi bıraktığı her ay bu ücreti almaz.');
    expect(ekran().form!.gruplar.flatMap(g => g.bayraklar).find(b => b.anahtar === 'gunDuzeltmesiUygula')!.not).toBeNull();
    expect(ekran().form!.gruplar.flatMap(g => g.alanlar).map(a => a.etiket).join(' ')).not.toMatch(/ücret/i);
  });

  it('toggles the day correction and the wage assumption', () => {
    const { vm, planlayici, ekran } = kur();
    const bayraklar = () => Object.fromEntries(ekran().form!.gruplar.flatMap(g => g.bayraklar).map(b => [b.anahtar, b.deger]));
    expect(bayraklar()).toEqual({ gunDuzeltmesiUygula: false, isUcretiDevam: true });
    // Sayı ile birimi bölünmez boşlukla bağlı: "(-1 gün)" satır sonunda ayrılmaz.
    expect(ekran().form!.gruplar[0]!.bayraklar[0]!.etiket).toBe('Kayıttaki gün düzeltmesini uygula (-1\u00a0gün)');
    vm.bayrakDegistir('gunDuzeltmesiUygula', true);
    vm.bayrakDegistir('isUcretiDevam', false);
    expect(planlayici.sonVarsayim!.gunDuzeltmesiUygula).toBe(true);
    expect(planlayici.sonVarsayim!.isUcretiDevam).toBe(false);
    expect(bayraklar()).toEqual({ gunDuzeltmesiUygula: true, isUcretiDevam: false });
    const duzeltme = ekran().form!.gruplar.flatMap(g => g.bayraklar).find(b => b.anahtar === 'gunDuzeltmesiUygula')!;
    expect(duzeltme.aciklama).toBe(PROFIL.gunDuzeltmesi.aciklama);
  });

  it('varsayimlariSifirla restores defaults and drafts, clears errors and keeps the selection', () => {
    const { vm, planlayici, ekran } = kur();
    vm.secimDegistir('bagkur', true);
    vm.alanGuncelle('askerlikGun', '100');
    vm.alanGuncelle('ihyaGun', 'x');
    vm.aylikModeliSec('elle');
    vm.ihyaSuresiGuncelle('3');
    vm.varsayimlariSifirla();
    expect(alan(ekran(), 'askerlikGun')).toMatchObject({ metin: '360', hata: null });
    expect(alan(ekran(), 'ihyaGun')).toMatchObject({ metin: '500', hata: null });
    expect(ekran().form!.aylikModeli.secili).toBe('sgkReferans');
    expect(ekran().form!.hataOzeti).toBeNull();
    expect(ekran().ihya.sure.metin).toBe('10');
    // Planlayıcının varsayılanları; Bağ-Kur borcu varsayılan kaynaktan (SGK düzeltilmiş tutarı bilinmiyor).
    const varsayilan = planlayici.varsayilanVarsayimlar();
    expect(planlayici.sonVarsayim).toEqual({
      ...varsayilan,
      secenekGirdileri: { ...varsayilan.secenekGirdileri, bagkur: { ...varsayilan.secenekGirdileri.bagkur, borc: SGK_BILINMIYOR } },
    });
    expect(ekran().sorular.map(s => s.evet)).toEqual([true, true, true]);
  });
});

// Bağ-Kur borcunun kaynağı (iki kaynak aracın seçenekleri): "SGK düzeltilmiş tutarı bilinmiyor" (Codex aracı, varsayılan),
// "Sade araç tahmini (aralık)" (yalnız profilde tahminiBorc varsa) ve "Tutarı gir" (Türkçe TL; tek tutar ya da aralık).
// Seçim varsayımlar.secenekGirdileri.bagkur.borc'u ayarlar; sıfırlama varsayılana döner.

function profilKopya(degistir: (bagkur: Record<string, unknown>) => void): EmeklilikProfili {
  const kopya = structuredClone(PROFIL) as EmeklilikProfili;
  degistir(kopya.secenekler.bagkur as unknown as Record<string, unknown>);
  return kopya;
}

function kurProfille(profil: EmeklilikProfili) {
  const planlayici = new SahtePlanlayici(profil);
  const vm = new EmeklilikPlaniViewModel(planlayici, profil, { mevzuat: MEVZUAT, bugun: BUGUN });
  return { planlayici, vm, ekran: () => vm.getSnapshot() };
}

describe('EmeklilikPlaniViewModel › Bağ-Kur borcunun kaynağı', () => {
  const kaynak = (e: EmeklilikEkrani) => e.form!.borcKaynagi;
  const borc = (planlayici: SahtePlanlayici) => planlayici.sonVarsayim!.secenekGirdileri.bagkur.borc;

  it('starts from "SGK düzeltilmiş tutarı bilinmiyor" and does not invent the amount, even if the profile carries one', () => {
    const { planlayici, ekran } = kur();
    expect(kaynak(ekran())).toEqual({
      baslik: 'Bağ-Kur borcunun kaynağı',
      secili: 'bilinmiyor',
      secenekler: [
        { deger: 'bilinmiyor', etiket: 'SGK düzeltilmiş tutarı bilinmiyor', aciklama: 'Ödeme, fark ve geri kazanma bilinmiyor olur; tutar uydurulmaz.' },
        { deger: 'tahmin', etiket: 'Sade araç tahmini (aralık)', aciklama: `₺280.000,00 – ₺420.000,00 · ${(PROFIL.secenekler.bagkur.tahminiBorc as { kaynak: string }).kaynak}` },
        { deger: 'elle', etiket: 'Tutarı gir', aciklama: 'SGK’dan öğrendiğiniz ya da kendi tahmininiz; tek tutar ya da aralık.' },
      ],
      alan: null,
      sonra: 'bagkurGun',
    });
    expect(borc(planlayici)).toEqual(SGK_BILINMIYOR);
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · Bilinmiyor · SGK düzeltilmiş tutarı bilinmiyor');
    expect(ekran().bilesimler.find(s => s.anahtar === 'bagkur')).toMatchObject({ odeme: 'Bilinmiyor', odemeNedeni: 'SGK düzeltilmiş tutarı bilinmiyor' });
    // Borç tutarı artık grubun düz alanı değildir: yalnız "Tutarı gir" seçiliyken kaynağın altında çizilir.
    expect(ekran().form!.gruplar.flatMap(g => g.alanlar).map(a => a.anahtar)).not.toContain('bagkurBorc');
  });

  it('offers the tahmin source only when the profile has tahminiBorc; the command is ignored otherwise', () => {
    const { vm, ekran } = kurProfille(profilKopya(bagkur => { delete bagkur.tahminiBorc; }));
    expect(kaynak(ekran()).secenekler.map(s => s.deger)).toEqual(['bilinmiyor', 'elle']);
    const dinleyici = vi.fn();
    vm.subscribe(dinleyici);
    vm.borcKaynagiSec('tahmin');
    expect(kaynak(ekran()).secili).toBe('bilinmiyor');
    expect(dinleyici).not.toHaveBeenCalled();
  });

  it('the tahmin source applies the range at once: question, combinations, shares and the recommendation are recomputed; the selection stays', () => {
    const { vm, planlayici, ekran } = kur();
    const secim = ekran().sorular.map(s => s.evet);
    const dinleyici = vi.fn();
    vm.subscribe(dinleyici);
    const oneriCagrisi = planlayici.cagrilar.oneri;
    const bilesimCagrisi = planlayici.cagrilar.tumBilesimler;
    vm.borcKaynagiSec('tahmin');
    expect(dinleyici).toHaveBeenCalledTimes(1);
    expect(kaynak(ekran())).toMatchObject({ secili: 'tahmin', alan: null });
    expect(borc(planlayici)).toEqual(PROFIL.secenekler.bagkur.tahminiBorc);
    expect(planlayici.cagrilar.oneri).toBe(oneriCagrisi + 1);
    expect(planlayici.cagrilar.tumBilesimler).toBe(bilesimCagrisi + 1);
    expect(ekran().sorular.map(s => s.evet)).toEqual(secim);
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · ₺280.000,00 – ₺420.000,00');
    expect(ekran().bilesimler.find(s => s.anahtar === 'bagkur')).toMatchObject({ odeme: '₺280.000,00 – ₺420.000,00', odemeNedeni: null });
    expect(ekran().paylar.find(p => p.anahtar === 'bagkur')!.ekOdeme).toBe('₺280.000,00 – ₺420.000,00');
    expect(ekran().sonuc!.kesinti.deger).toBe('%10 kesinti · 30 ay');
    vm.borcKaynagiSec('tahmin');
    expect(dinleyici).toHaveBeenCalledTimes(1);
  });

  it('the manual source shows a Turkish money field prefilled with the profile amount; valid input applies, invalid input keeps the last valid value', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('elle');
    expect(kaynak(ekran()).secili).toBe('elle');
    expect(kaynak(ekran()).alan).toMatchObject({
      anahtar: 'bagkurBorc', etiket: 'Düzeltilmiş Bağ-Kur borcu', metin: '300.000,00 – 450.000,00', hata: null, girisModu: 'decimal', zorunlu: true,
    });
    expect(borc(planlayici)).toEqual(PROFIL.secenekler.bagkur.borc);
    vm.alanGuncelle('bagkurBorc', '350.000,00');
    expect(borc(planlayici)).toEqual({ tur: 'bilinen', tl: '350000.00', kaynak: 'Elle girildi' });
    expect(ekran().sorular[1]!.aciklama).toBe('600 gün · ₺350.000,00');
    vm.alanGuncelle('bagkurBorc', '350.000 - 420.000,50');
    expect(borc(planlayici)).toEqual({ tur: 'aralik', altTl: '350000.00', ustTl: '420000.50', kaynak: 'Elle girildi' });
    vm.alanGuncelle('bagkurBorc', '450.000,00 – 300.000,00');
    expect(kaynak(ekran()).alan!.hata).toBe('Hata: Alt tutar üst tutardan büyük olamaz.');
    expect(ekran().form!.hataOzeti).toBe('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
    vm.alanGuncelle('bagkurBorc', 'çok');
    expect(kaynak(ekran()).alan!.hata).toBe('Hata: Tutarı 8.500,00 ya da 300.000,00 – 450.000,00 biçiminde girin.');
    vm.alanGuncelle('bagkurBorc', '');
    expect(kaynak(ekran()).alan).toMatchObject({ metin: '', hata: ELLE_BOS_HATA });
    expect(borc(planlayici)).toEqual({ tur: 'aralik', altTl: '350000.00', ustTl: '420000.50', kaynak: 'Elle girildi' });
  });

  it('switching away keeps the manual amount for later and hides its error; switching back restores it', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '350.000,00');
    vm.borcKaynagiSec('bilinmiyor');
    expect(kaynak(ekran())).toMatchObject({ secili: 'bilinmiyor', alan: null });
    expect(borc(planlayici)).toEqual(SGK_BILINMIYOR);
    vm.borcKaynagiSec('elle');
    expect(kaynak(ekran()).alan).toMatchObject({ metin: '350.000,00', hata: null });
    expect(borc(planlayici)).toEqual({ tur: 'bilinen', tl: '350000.00', kaynak: 'Elle girildi' });
    vm.alanGuncelle('bagkurBorc', 'x');
    vm.borcKaynagiSec('tahmin');
    expect(ekran().form!.hataOzeti).toBeNull();
  });

  it('with no amount in the profile the manual source starts empty and names the missing amount', () => {
    const { vm, planlayici, ekran } = kurProfille(profilKopya(bagkur => { bagkur.borc = { tur: 'bilinmiyor', neden: 'Sentetik: düzeltilmiş borç sorgulanmadı.' }; }));
    vm.borcKaynagiSec('elle');
    expect(kaynak(ekran()).alan).toMatchObject({ metin: '', hata: ELLE_BOS_HATA });
    expect(borc(planlayici)).toEqual({ tur: 'bilinmiyor', neden: 'Bağ-Kur borcu tutarı girilmedi' });
    expect(ekran().form!.hataOzeti).toBe('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
  });

  it('typing a debt amount selects the manual source', () => {
    const { vm, planlayici, ekran } = kur();
    vm.alanGuncelle('bagkurBorc', '400.000,00');
    expect(kaynak(ekran()).secili).toBe('elle');
    expect(borc(planlayici)).toEqual({ tur: 'bilinen', tl: '400000.00', kaynak: 'Elle girildi' });
  });

  it('the amount also paid on the SSK-only path keeps its own unknown / entered choice (blank = unknown, named)', () => {
    const { vm, planlayici, ekran } = kur();
    expect(alan(ekran(), 'bagkurOrtakOdeme')).toMatchObject({ metin: '50.000,00', zorunlu: false });
    vm.alanGuncelle('bagkurOrtakOdeme', '');
    expect(planlayici.sonVarsayim!.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek).toEqual({ tur: 'bilinmiyor', neden: 'Ortak ödenecek Bağ-Kur tutarı girilmedi' });
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBeNull();
    vm.alanGuncelle('bagkurOrtakOdeme', '40.000,00');
    expect(planlayici.sonVarsayim!.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek).toEqual({ tur: 'bilinen', tl: '40000.00', kaynak: 'Elle girildi' });
    expect(kaynak(ekran()).secili).toBe('bilinmiyor');
  });

  it('varsayimlariSifirla returns to "SGK düzeltilmiş tutarı bilinmiyor" and forgets the manual amount', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '350.000,00');
    vm.varsayimlariSifirla();
    expect(kaynak(ekran())).toMatchObject({ secili: 'bilinmiyor', alan: null });
    expect(borc(planlayici)).toEqual(SGK_BILINMIYOR);
    vm.borcKaynagiSec('elle');
    expect(kaynak(ekran()).alan).toMatchObject({ metin: '300.000,00 – 450.000,00', hata: null });
    vm.borcKaynagiSec('tahmin');
    vm.varsayimlariSifirla();
    expect(kaynak(ekran()).secili).toBe('bilinmiyor');
    expect(borc(planlayici)).toEqual(SGK_BILINMIYOR);
  });
});

describe('EmeklilikPlaniViewModel › borç ve ortak ödeme çapraz denetimi', () => {
  const kaynak = (e: EmeklilikEkrani) => e.form!.borcKaynagi;
  const bagkur = (planlayici: SahtePlanlayici) => planlayici.sonVarsayim!.secenekGirdileri.bagkur;

  it('a debt below the shared payment is a field error; the planner keeps the last valid assumption', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '4');
    expect(kaynak(ekran()).alan).toMatchObject({ metin: '4', hata: 'Hata: Borç, yalnız SSK yolunda da ödenecek tutardan (₺50.000,00) az olamaz.' });
    expect(ekran().form!.hataOzeti).toBe('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
    expect(ekran().hesap.durum).toBe('hazir');
    expect(bagkur(planlayici).borc).toEqual(PROFIL.secenekler.bagkur.borc);
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBeNull();
    vm.alanGuncelle('bagkurBorc', '400.000,00');
    expect(kaynak(ekran()).alan!.hata).toBeNull();
    expect(ekran().form!.hataOzeti).toBeNull();
    expect(bagkur(planlayici).borc).toEqual({ tur: 'bilinen', tl: '400000.00', kaynak: 'Elle girildi' });
  });

  it('while the rule is broken other edits still apply; repeated invalid input does not ask the planner again', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '4');
    vm.alanGuncelle('askerlikGun', '300');
    expect(planlayici.sonVarsayim!.secenekGirdileri.askerlik.gun).toBe(300);
    expect(bagkur(planlayici).borc).toEqual(PROFIL.secenekler.bagkur.borc);
    expect(kaynak(ekran()).alan!.hata).toBe('Hata: Borç, yalnız SSK yolunda da ödenecek tutardan (₺50.000,00) az olamaz.');
    const bilesimCagrisi = planlayici.cagrilar.tumBilesimler;
    vm.alanGuncelle('bagkurBorc', '45');
    expect(kaynak(ekran()).alan!.metin).toBe('45');
    expect(planlayici.cagrilar.tumBilesimler).toBe(bilesimCagrisi);
  });

  it('a shared payment above the debt is an error on that field; ranges are compared end by end', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('tahmin');
    vm.alanGuncelle('bagkurOrtakOdeme', '300.000,00');
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBe('Hata: Bu tutar düzeltilmiş borcu (₺280.000,00 – ₺420.000,00) aşamaz.');
    expect(bagkur(planlayici).yalnizSskYolundaOdenecek).toEqual(PROFIL.secenekler.bagkur.yalnizSskYolundaOdenecek);
    // Uç uca: alt ≤ alt ve üst ≤ üst ise geçerli.
    vm.alanGuncelle('bagkurOrtakOdeme', '280.000,00 – 300.000,00');
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBeNull();
    expect(bagkur(planlayici).yalnizSskYolundaOdenecek).toEqual({ tur: 'aralik', altTl: '280000.00', ustTl: '300000.00', kaynak: 'Elle girildi' });
  });

  it('a source change that breaks the rule is kept as a choice but computed with the last valid debt; an unknown debt clears it', () => {
    const { vm, planlayici, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '500.000,00');
    vm.alanGuncelle('bagkurOrtakOdeme', '400.000,00');
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBeNull();
    vm.borcKaynagiSec('tahmin');
    expect(kaynak(ekran()).secili).toBe('tahmin');
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBe('Hata: Bu tutar düzeltilmiş borcu (₺280.000,00 – ₺420.000,00) aşamaz.');
    expect(bagkur(planlayici).borc).toEqual({ tur: 'bilinen', tl: '500000.00', kaynak: 'Elle girildi' });
    expect(ekran().form!.hataOzeti).toBe('1 alanda hata var; sonuç son geçerli değerlerle hesaplandı.');
    vm.borcKaynagiSec('bilinmiyor');
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBeNull();
    expect(bagkur(planlayici).borc).toEqual(SGK_BILINMIYOR);
    expect(bagkur(planlayici).yalnizSskYolundaOdenecek).toEqual({ tur: 'bilinen', tl: '400000.00', kaynak: 'Elle girildi' });
  });

  it('reset clears the cross error', () => {
    const { vm, ekran } = kur();
    vm.borcKaynagiSec('elle');
    vm.alanGuncelle('bagkurBorc', '4');
    vm.varsayimlariSifirla();
    expect(ekran().form!.hataOzeti).toBeNull();
    expect(alan(ekran(), 'bagkurOrtakOdeme').hata).toBeNull();
  });
});

describe('EmeklilikPlaniViewModel › ihya karşılaştırması', () => {
  it('compares the current choices with and without ihya; entered net monthlies go to the matching path', () => {
    const { vm, planlayici, ekran } = kur();
    const ihya = ekran().ihya;
    expect(ihya.ihyali).toEqual({ secimAdi: 'Askerlik + ihya', emeklilik: 'Ağustos 2030', aylik: '₺25.000,00 · SGK referansı' });
    expect(ihya.ihyasiz).toEqual({ secimAdi: 'Yalnız askerlik', emeklilik: 'Aralık 2031', aylik: '₺25.000,00 · SGK referansı' });
    expect(ihya.erken).toBe('İhya ile 16 ay erken');
    expect(ihya.donemSonunda).toEqual({ etiket: 'Sonraki 10 yılın sonunda fark', deger: '-₺25.700,00', not: null, ton: 'hata', bicim: 'tutar' });
    expect(planlayici.sonYolKarsilastir!.a).toEqual({ askerlik: true, bagkur: false, ihya: true });
    expect(planlayici.sonYolKarsilastir!.b).toEqual({ askerlik: true, bagkur: false, ihya: false });
    // Boş net aylık gönderilmez: yol seçili aylık modelinde kalır (yardım metni "Boşsa seçili aylık modeli kullanılır").
    expect(planlayici.sonYolKarsilastir!.elleAylik).toEqual({});

    vm.ihyaAylikGuncelle('ihyali', '30.000,00');
    expect(planlayici.sonYolKarsilastir!.elleAylik).toEqual({ a: '30000.00' });
    expect(ekran().ihya.ihyali.aylik).toBe('₺30.000,00 · Elle girilen');
    expect(ekran().ihya.donemSonunda.deger).toBe('+₺54.300,00');
    expect(ekran().ihya.aylikIhyali).toMatchObject({ metin: '30.000,00', hata: null, etiket: 'İhya eklenen yolda net aylık' });

    vm.ihyaAylikGuncelle('ihyasiz', '25.000');
    expect(planlayici.sonYolKarsilastir!.elleAylik).toEqual({ a: '30000.00', b: '25000.00' });
    vm.ihyaAylikGuncelle('ihyasiz', 'yirmi');
    expect(ekran().ihya.aylikIhyasiz.hata).toBe('Hata: Tutarı 8.500,00 biçiminde girin.');
    expect(planlayici.sonYolKarsilastir!.elleAylik).toEqual({ a: '30000.00', b: '25000.00' });
    vm.ihyaAylikGuncelle('ihyali', '');
    expect(ekran().ihya.aylikIhyali.hata).toBeNull();
    expect(planlayici.sonYolKarsilastir!.elleAylik).toEqual({ b: '25000.00' });
    expect(ekran().ihya.ihyali.aylik).toBe('₺25.000,00 · SGK referansı');
  });

  it('has its own comparison period, independent of the main assumption', () => {
    const { vm, planlayici, ekran } = kur();
    vm.ihyaSuresiGuncelle('5');
    expect(planlayici.sonYolKarsilastir!.varsayim.karsilastirmaSuresiYil).toBe(5);
    expect(ekran().ihya.donemSonunda.etiket).toBe('Sonraki 5 yılın sonunda fark');
    expect(ekran().sonuc!.donemSonunda.etiket).toBe('Ortak dönem sonunda fark (10 yıl)');
    vm.ihyaSuresiGuncelle('50');
    expect(ekran().ihya.sure.hata).toBe('Hata: 0 ile 40 arasında bir yıl girin.');
  });

  it('keeps ihya monthlies when choices change and follows the other choices', () => {
    const { vm, planlayici } = kur();
    vm.ihyaAylikGuncelle('ihyali', '30.000,00');
    vm.secimDegistir('bagkur', true);
    expect(planlayici.sonYolKarsilastir!.a).toEqual({ askerlik: true, bagkur: true, ihya: true });
    expect(planlayici.sonYolKarsilastir!.b).toEqual({ askerlik: true, bagkur: true, ihya: false });
    expect(planlayici.sonYolKarsilastir!.elleAylik).toEqual({ a: '30000.00' });
  });
});

describe('EmeklilikPlaniViewModel › hesap hatası', () => {
  it('a failing planner yields a named error state instead of throwing; questions still render from the profile', () => {
    const { ekran } = kur({ hata: 'Emeklilik modeli henüz uygulanmadı (taslak).' });
    const e = ekran();
    expect(e.hesap).toEqual({ durum: 'hata', neden: 'Hesap yapılamadı: Emeklilik modeli henüz uygulanmadı (taslak).' });
    expect(e.sonuc).toBeNull();
    expect(e.oneri).toBeNull();
    expect(e.bilesimler).toEqual([]);
    expect(e.paylar).toEqual([]);
    expect(e.form).toBeNull();
    expect(e.sorular.map(s => s.aciklama)).toEqual(['360 gün', '600 gün', '500 gün']);
    expect(e.sorular.map(s => s.evet)).toEqual([false, false, false]);
  });

  it('recovers on the next command once the planner works again', () => {
    const { vm, planlayici, ekran } = kur();
    planlayici.hata = 'Geçici hata';
    vm.secimDegistir('bagkur', true);
    expect(ekran().hesap).toEqual({ durum: 'hata', neden: 'Hesap yapılamadı: Geçici hata' });
    expect(ekran().sorular[1]!.evet).toBe(true);
    planlayici.hata = null;
    vm.secimDegistir('ihya', false);
    expect(ekran().hesap.durum).toBe('hazir');
    expect(ekran().sonuc!.secimAdi).toBe('Askerlik + Bağ-Kur borcu');
  });
});
