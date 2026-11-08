// Model cephesi: EmeklilikPlanlayici sözleşmesinin uygulaması. Seçenekler, takvim, tarih hesabı ve aylık modeli
// fabrikası bağımlılık olarak verilebilir (testte ya da yeni seçenek eklerken); varsayılanlar profilden kurulur.
// Sekiz bileşim varsayım anahtarlı küçük bir önbellekte tutulur: görünüm modeli aynı tuşta tumBilesimler(v) ve oneri(v)
// sorar; öneri aynı varsayımın bileşimlerini yeniden hesaplamaz, yalnız duyarlılık varsayımlarını (kesintisiz, borcun
// üst ucu) hesaplar. Sonuçlar varsayımın saf işlevidir (profil ve mevzuat değişmez), önbellek doğruluğu etkilemez.
import {
  BILESIM_SIRASI,
  SECENEK_ANAHTARLARI,
  type AyMetni,
  type AylikModeliAdi,
  type EmeklilikPlanlayici,
  type EmeklilikProfili,
  type MevzuatParametreleri,
  type Oneri,
  type SecenekAnahtari,
  type Secim,
  type SecimEtkisi,
  type TlMetni,
  type TutarBilgisi,
  type Varsayimlar,
} from '../contract';
import { Ay } from './Ay';
import { ElleAylikModeli, aylikModeliOlustur, type AylikModeli } from './AylikModeli';
import { EmeklilikTarihiHesabi } from './EmeklilikTarihiHesabi';
import { AskerlikBorclanmasi, BagkurBorcOdemesi, Ihya, SECENEK_ADLARI, type HizmetSecenegi } from './HizmetSecenegi';
import { HizmetTakvimi } from './HizmetTakvimi';
import { KesintiPlani } from './KesintiPlani';
import { Para } from './Para';
import { Tutar, TutarIslemleri } from './Tutar';
import { YolHesabi, type YolSonucuAyrintili } from './Yol';
import { YolKarsilastirici, type KarsilastirmaAyrintisi, type KarsilastirmaKosullari } from './YolKarsilastirici';
import { kuralHatasi, nedenleriSirala, yuzde } from './bicim';

export const HICBIRI: Readonly<Secim> = Object.freeze({ askerlik: false, bagkur: false, ihya: false });
/** Varsayılan karşılaştırma süresi: geç yolun emekliliğinden sonra 10 yıl. */
export const VARSAYILAN_KARSILASTIRMA_YILI = 10;
const AYLIK_MODELLERI: readonly AylikModeliAdi[] = ['sgkReferans', 'kazancTahmini', 'elle'];
/** Bileşim önbelleğinin boyu: bir tuşta en çok üç varsayım (asıl, kesintisiz, borcun üst ucu) + bir önceki. */
const BILESIM_ONBELLEGI = 4;

/** 'Askerlik borçlanması + İhya' ya da 'Hiçbir şey ödememek'. */
export function bilesimAdi(secim: Secim): string {
  const adlar = SECENEK_ANAHTARLARI.filter((k) => secim[k]).map((k) => SECENEK_ADLARI[k]);
  return adlar.length === 0 ? 'Hiçbir şey ödememek' : adlar.join(' + ');
}

const ayAdi = (ay: AyMetni | null) => (ay === null ? 'bilinmiyor' : Ay.metinden(ay).adi());
const secimSayisi = (s: Secim) => SECENEK_ANAHTARLARI.filter((k) => s[k]).length;
const ayniSecim = (a: Secim, b: Secim) => SECENEK_ANAHTARLARI.every((k) => a[k] === b[k]);

/** Varsayımdaki TL metni; hata iletisi alanın adını söyler (değer cause'da). */
function tlGecerli(metin: TlMetni, ad: string): Para {
  let p: Para;
  try {
    p = Para.tlden(metin);
  } catch (hata) {
    const neden = hata instanceof Error ? hata.message : '';
    throw kuralHatasi(`${ad} hesaplanamıyor: ${neden.charAt(0).toLocaleLowerCase('tr-TR')}${neden.slice(1)}`, { alan: ad, metin, hata });
  }
  if (p.negatifMi()) throw kuralHatasi(`${ad} negatif olamaz.`, { alan: ad, metin });
  return p;
}

export interface PlanlayiciBagimliliklari {
  secenekler: readonly HizmetSecenegi[];
  takvim: HizmetTakvimi;
  tarihHesabi: EmeklilikTarihiHesabi;
  aylikModeliFabrikasi: (ad: AylikModeliAdi, elleAylikTl: TlMetni | null) => AylikModeli;
}

export class EmeklilikPlanlayiciImpl implements EmeklilikPlanlayici {
  private readonly secenekler: readonly HizmetSecenegi[];
  private readonly takvim: HizmetTakvimi;
  private readonly tarihHesabi: EmeklilikTarihiHesabi;
  private readonly aylikModeliFabrikasi: PlanlayiciBagimliliklari['aylikModeliFabrikasi'];
  private readonly kayitAyi: Ay;
  /** Varsayım anahtarı (JSON) → sekiz bileşim; en son kullanılan sonda (Map ekleme sırası). */
  private readonly bilesimOnbellegi = new Map<string, readonly KarsilastirmaAyrintisi[]>();

  constructor(
    private readonly profil: EmeklilikProfili,
    private readonly mevzuat: MevzuatParametreleri,
    bagimliliklar: Partial<PlanlayiciBagimliliklari> = {},
  ) {
    this.takvim = bagimliliklar.takvim ?? new HizmetTakvimi(profil);
    this.tarihHesabi = bagimliliklar.tarihHesabi ?? new EmeklilikTarihiHesabi(profil, this.takvim);
    this.secenekler = bagimliliklar.secenekler ?? [
      new AskerlikBorclanmasi(profil.secenekler.askerlik.azamiGun),
      new BagkurBorcOdemesi(),
      new Ihya(),
    ];
    this.aylikModeliFabrikasi = bagimliliklar.aylikModeliFabrikasi
      ?? ((ad, elle) => aylikModeliOlustur(ad, profil, mevzuat, elle));
    this.kayitAyi = Ay.tarihten(profil.kayitTarihi);
    const anahtarlar = this.secenekler.map((s) => s.anahtar).sort();
    if (anahtarlar.join() !== [...SECENEK_ANAHTARLARI].sort().join()) {
      throw new RangeError('Her seçenek anahtarı için tam bir hizmet seçeneği gerekir.');
    }
    if (!Number.isFinite(profil.kazanc.ucretZamOrani) || profil.kazanc.ucretZamOrani < -1) {
      throw kuralHatasi('Ücret zam oranı −%100 ya da daha büyük olmalı.', { ucretZamOrani: profil.kazanc.ucretZamOrani });
    }
  }

  // ── Sözleşme ──────────────────────────────────────────────────────────────

  varsayilanVarsayimlar(): Varsayimlar {
    const { secenekler, planlananCalisma } = this.profil;
    const acikUclu = planlananCalisma.filter((c) => c.bitisAy === null);
    const bedel = this.varsayilanGunlukBedel();
    return {
      aylikModeli: this.profil.varsayilanAylikModeli,
      elleAylikTl: null,
      borcKesintiOrani: this.mevzuat.borcKesintiOrani,
      digerKesintilerTl: '0.00',
      karsilastirmaSuresiYil: VARSAYILAN_KARSILASTIRMA_YILI,
      isUcretiDevam: true,
      gunDuzeltmesiUygula: false,
      gelecekAyBasinaGun: acikUclu.length > 0 ? acikUclu[acikUclu.length - 1].ayBasinaGun : 0,
      bagkurGecikmeAylikOran: null,
      secenekGirdileri: {
        askerlik: { gun: secenekler.askerlik.gun, gunlukBedelTl: secenekler.askerlik.gunlukBedelTl ?? bedel },
        bagkur: {
          gun: secenekler.bagkur.gun,
          borc: { ...secenekler.bagkur.borc },
          yalnizSskYolundaOdenecek: { ...secenekler.bagkur.yalnizSskYolundaOdenecek },
        },
        ihya: { gun: secenekler.ihya.gun, gunlukBedelTl: secenekler.ihya.gunlukBedelTl ?? bedel },
      },
    };
  }

  yol(secim: Secim, varsayim: Varsayimlar): YolSonucuAyrintili {
    this.dogrula(varsayim);
    return this.yolHesabi(secim, varsayim).sonuc();
  }

  karsilastir(secim: Secim, varsayim: Varsayimlar): KarsilastirmaAyrintisi {
    return this.yolKarsilastir(secim, HICBIRI, varsayim);
  }

  /** a yolunu b'ye (referans) göre karşılaştırır. elleAylik.a / .b verilirse (null dahil) o yolun aylığı elle modeldir. */
  yolKarsilastir(a: Secim, b: Secim, varsayim: Varsayimlar, elleAylik?: { a?: TlMetni | null; b?: TlMetni | null }): KarsilastirmaAyrintisi {
    this.dogrula(varsayim);
    const karsilastirici = new YolKarsilastirici(this.kosullar(varsayim));
    return karsilastirici.karsilastir(this.yolHesabi(a, varsayim, elleAylik?.a), this.yolHesabi(b, varsayim, elleAylik?.b));
  }

  /** Sekiz bileşim; dönen dizi her çağrıda yenidir (içerik önbellekten paylaşılır, değiştirilmez). */
  tumBilesimler(varsayim: Varsayimlar): KarsilastirmaAyrintisi[] {
    return [...this.bilesimler(varsayim)];
  }

  secimEtkileri(secim: Secim, varsayim: Varsayimlar): SecimEtkisi[] {
    return SECENEK_ANAHTARLARI.map((anahtar) => {
      const k = this.yolKarsilastir({ ...secim, [anahtar]: true }, { ...secim, [anahtar]: false }, varsayim);
      return { anahtar, erkenAy: k.erkenAy, ekOdeme: k.ekOdeme, donemSonundaFark: k.donemSonunda };
    });
  }

  oneri(varsayim: Varsayimlar): Oneri {
    const temel = this.oneriSec(varsayim);
    const kesintisiz = this.oneriSec({ ...varsayim, borcKesintiOrani: 0 });
    const borc = varsayim.secenekGirdileri.bagkur.borc;
    const borcUst = borc.tur === 'aralik'
      ? this.oneriSec({
        ...varsayim,
        secenekGirdileri: {
          ...varsayim.secenekGirdileri,
          bagkur: { ...varsayim.secenekGirdileri.bagkur, borc: { tur: 'bilinen', tl: borc.ustTl, kaynak: `${borc.kaynak} (üst uç)` } },
        },
      })
      : temel;
    const farklar: string[] = [];
    if (!ayniSecim(kesintisiz.secim, temel.secim)) farklar.push(`kesinti olmazsa: ${bilesimAdi(kesintisiz.secim)}`);
    if (!ayniSecim(borcUst.secim, temel.secim)) farklar.push(`borç aralığın üst ucunda olursa: ${bilesimAdi(borcUst.secim)}`);
    const saglam = farklar.length === 0;
    // Sağlamlık ayrı alanda (saglam) taşınır ve görünüm modeli kendi cümlesiyle yazar; gerekçe yalnız duyarlılığın
    // ayrıntısını (hangi varsayımda hangi bileşimin öne geçtiği) ekler, aynı bilgiyi iki kez söylemez.
    const ek = saglam ? '' : ` Öneri varsayıma duyarlı — ${farklar.join('; ')}.`;
    return { tur: temel.tur, secim: { ...temel.secim }, gerekce: temel.gerekce + ek, saglam };
  }

  // ── İç hesap ──────────────────────────────────────────────────────────────

  private varsayilanGunlukBedel(): TlMetni {
    return Para.tlden(this.mevzuat.gunlukKazancAltSiniriTl).carp(this.mevzuat.borclanmaOrani).tlMetni();
  }

  private kosullar(v: Varsayimlar): KarsilastirmaKosullari {
    const net = Para.tlden(this.profil.kazanc.netUcretTl);
    const zam = this.profil.kazanc.ucretZamOrani;
    return {
      ucret: net.topla(net.carp(zam)),
      ucretKaynagi: `Profildeki net ücret ${net.goster()}${zam === 0 ? '' : ` + ${yuzde(zam)} zam varsayımı`}`,
      ortakOdeme: v.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek,
      karsilastirmaSuresiYil: v.karsilastirmaSuresiYil,
      isUcretiDevam: v.isUcretiDevam,
    };
  }

  /** Ödenmeyen borç: düzeltilmiş borç − Bağ-Kur'suz yolda da ödenecek ortak tutar (senaryo senaryo). */
  private kalanBorc(v: Varsayimlar): Tutar {
    const { borc, yalnizSskYolundaOdenecek } = v.secenekGirdileri.bagkur;
    return Tutar.bilgiden(borc).cikar(Tutar.bilgiden(yalnizSskYolundaOdenecek));
  }

  private yolHesabi(secim: Secim, v: Varsayimlar, elleAylik?: TlMetni | null): YolHesabi {
    const secili = this.secenekler.filter((s) => secim[s.anahtar]);
    const eklenenGun: Record<SecenekAnahtari, number> = { askerlik: 0, bagkur: 0, ihya: 0 };
    for (const s of secili) eklenenGun[s.anahtar] = s.gun(v);
    const ekGun = secili.reduce((t, s) => t + eklenenGun[s.anahtar], 0);
    const tarih = this.tarihHesabi.hesapla(ekGun, v);

    const model = elleAylik !== undefined ? new ElleAylikModeli(elleAylik) : this.aylikModeliFabrikasi(v.aylikModeli, v.elleAylikTl);
    const aylik = Tutar.bilgiden(model.aylik(tarih.calismaGunu === null ? null : {
      calismaGunu: tarih.calismaGunu,
      duzeltmeGunu: this.takvim.duzeltme(v),
      secenekler: secili.map((s) => ({ donem: s.donem, gun: eklenenGun[s.anahtar], kat: s.kazancKati() })),
    }));

    const kesinti = secim.bagkur ? null : KesintiPlani.olustur({
      oran: v.borcKesintiOrani,
      tavan: this.mevzuat.borcKesintiTavani,
      borc: this.kalanBorc(v),
      aylik,
      gecikmeAylikOran: v.bagkurGecikmeAylikOran,
      gecikmeAySayisi: tarih.emeklilikAyi === null ? 0 : Math.max(0, tarih.emeklilikAyi.fark(this.kayitAyi)),
    });

    return new YolHesabi({
      secim,
      tarih,
      eklenenGun,
      kalemler: secili.map((s) => ({ anahtar: s.anahtar, tutar: Tutar.bilgiden(s.maliyet(v, this.mevzuat)) })),
      aylik,
      aylikModeli: model.ad,
      kesinti,
      digerKesinti: Para.tlden(v.digerKesintilerTl),
    });
  }

  /**
   * Sekiz bileşim, varsayım anahtarlı önbellekten. Önce doğrulanır (geçersiz varsayım önbelleğe girmez ve JSON'da aynı
   * yazılan NaN/null gibi değerler karışmaz); eşit varsayım (kopya da olsa) aynı sonucu verir.
   */
  private bilesimler(v: Varsayimlar): readonly KarsilastirmaAyrintisi[] {
    this.dogrula(v);
    const anahtar = JSON.stringify(v);
    const hazir = this.bilesimOnbellegi.get(anahtar);
    if (hazir) {
      this.bilesimOnbellegi.delete(anahtar);
      this.bilesimOnbellegi.set(anahtar, hazir);
      return hazir;
    }
    const karsilastirici = new YolKarsilastirici(this.kosullar(v));
    const referans = this.yolHesabi(HICBIRI, v);
    const sonuc = Object.freeze(BILESIM_SIRASI.map((s) => karsilastirici.karsilastir(this.yolHesabi(s, v), referans)));
    this.bilesimOnbellegi.set(anahtar, sonuc);
    if (this.bilesimOnbellegi.size > BILESIM_ONBELLEGI) this.bilesimOnbellegi.delete(this.bilesimOnbellegi.keys().next().value!);
    return sonuc;
  }

  private oneriSec(v: Varsayimlar): { tur: Oneri['tur']; secim: Secim; gerekce: string } {
    const tum = this.bilesimler(v);
    const sira = (k: KarsilastirmaAyrintisi) => BILESIM_SIRASI.findIndex((s) => ayniSecim(s, k.yol.secim));
    const ay = (k: KarsilastirmaAyrintisi) => (k.yol.emeklilikAyi === null ? Number.POSITIVE_INFINITY : Ay.metinden(k.yol.emeklilikAyi).sira);

    if (tum.every((k) => k.donemSonunda.tur !== 'bilinmiyor')) {
      const orta = (t: TutarBilgisi) => Tutar.bilgiden(t).ortaIkiKati() ?? 0;
      const enIyi = [...tum].sort((a, b) => orta(b.donemSonunda) - orta(a.donemSonunda)
        || ay(a) - ay(b)
        || orta(a.ekOdeme) - orta(b.ekOdeme)
        || secimSayisi(a.yol.secim) - secimSayisi(b.yol.secim)
        || sira(a) - sira(b))[0];
      const bitis = enIyi.donemBitisAyi === null ? '' : `${ayAdi(enIyi.donemBitisAyi)} sonuna kadar `;
      return {
        tur: 'senaryoOnerisi',
        secim: enIyi.yol.secim,
        gerekce: `${bilesimAdi(enIyi.yol.secim)}: ${bitis}hiçbir şey ödemeyen yola göre en yüksek fark `
          + `${TutarIslemleri.goster(enIyi.donemSonunda)}; planlama ayı ${ayAdi(enIyi.yol.emeklilikAyi)}.`,
      };
    }

    const nedenler = nedenleriSirala(tum.flatMap((k) => k.nedenler));
    const tarihli = tum.filter((k) => k.yol.emeklilikAyi !== null);
    if (tarihli.length === 0) {
      return { tur: 'enErkenTarih', secim: { ...HICBIRI }, gerekce: `Hiçbir bileşimde emeklilik tarihi hesaplanamıyor (${nedenler}).` };
    }
    const enErken = [...tarihli].sort((a, b) => ay(a) - ay(b) || secimSayisi(a.yol.secim) - secimSayisi(b.yol.secim) || sira(a) - sira(b))[0];
    return {
      tur: 'enErkenTarih',
      secim: enErken.yol.secim,
      gerekce: `Mali sıralama yapılamıyor (${nedenler}). En erken planlama ayı ${ayAdi(enErken.yol.emeklilikAyi)}: `
        + `${bilesimAdi(enErken.yol.secim)}. Bu bir mali öneri değil, en erken tarih senaryosudur.`,
    };
  }

  /** Varsayımları doğrular; geçersizse RangeError (Türkçe ileti). */
  private dogrula(v: Varsayimlar): void {
    if (!AYLIK_MODELLERI.includes(v.aylikModeli)) throw kuralHatasi('Bilinmeyen aylık modeli.', { aylikModeli: String(v.aylikModeli) });
    if (v.elleAylikTl !== null) tlGecerli(v.elleAylikTl, 'Elle aylık');
    const tavan = this.mevzuat.borcKesintiTavani;
    if (!Number.isFinite(v.borcKesintiOrani) || v.borcKesintiOrani < 0 || v.borcKesintiOrani > tavan) {
      throw kuralHatasi(`Borç kesinti oranı %0 ile ${yuzde(tavan)} arasında olmalı.`, { borcKesintiOrani: v.borcKesintiOrani });
    }
    tlGecerli(v.digerKesintilerTl, 'Diğer kesintiler');
    if (!Number.isSafeInteger(v.karsilastirmaSuresiYil) || v.karsilastirmaSuresiYil < 0 || v.karsilastirmaSuresiYil > 40) {
      throw kuralHatasi('Karşılaştırma süresi 0–40 yıl arasında tamsayı olmalı.', { karsilastirmaSuresiYil: v.karsilastirmaSuresiYil });
    }
    if (typeof v.isUcretiDevam !== 'boolean' || typeof v.gunDuzeltmesiUygula !== 'boolean') {
      throw new RangeError('İş ücreti ve gün düzeltmesi seçimleri Evet/Hayır olmalı.');
    }
    if (!Number.isSafeInteger(v.gelecekAyBasinaGun) || v.gelecekAyBasinaGun < 0 || v.gelecekAyBasinaGun > 30) {
      throw kuralHatasi('Gelecekte ay başına gün 0–30 arasında tamsayı olmalı.', { gelecekAyBasinaGun: v.gelecekAyBasinaGun });
    }
    const gecikme = v.bagkurGecikmeAylikOran;
    if (gecikme !== null && (!Number.isFinite(gecikme) || gecikme < 0 || gecikme > 1)) {
      throw kuralHatasi('Gecikme oranı %0 ile %100 arasında olmalı.', { bagkurGecikmeAylikOran: gecikme });
    }
    // Gün sayıları (askerlikte azami gün dahil), günlük bedeller ve borç metinleri seçenek sınıflarında doğrulanır.
    for (const s of this.secenekler) {
      s.gun(v);
      s.maliyet(v, this.mevzuat);
    }
    const kalan = this.kalanBorc(v).senaryolar();
    const borc = Tutar.bilgiden(v.secenekGirdileri.bagkur.borc).senaryolar();
    if (borc !== null && (borc[0].negatifMi() || borc[1].negatifMi())) throw new RangeError('Bağ-Kur borcu negatif olamaz.');
    const ortak = Tutar.bilgiden(v.secenekGirdileri.bagkur.yalnizSskYolundaOdenecek).senaryolar();
    if (ortak !== null && (ortak[0].negatifMi() || ortak[1].negatifMi())) throw new RangeError('Ortak Bağ-Kur ödemesi negatif olamaz.');
    if (kalan !== null && (kalan[0].negatifMi() || kalan[1].negatifMi())) {
      throw new RangeError('Yalnız SSK yolunda da ödenecek Bağ-Kur tutarı düzeltilmiş borcu aşamaz.');
    }
  }
}
