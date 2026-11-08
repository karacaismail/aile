import type { TlMetni, TutarBilgisi } from '../contract';
import { BOS_HATA, PARA_HATA, type AyristirmaSonucu, type TurkceSayiAyristirici } from './ayristirma';
import type { TurkceBicimleyici } from './bicim';
import type { AlanAnahtari, AlanGrubuAnahtari, IhyaAlanAnahtari } from './ekran';

// Düzenlenebilir alanlar (şablon yöntemi + strateji). Ortak soyut sınıf FormAlani metni ayrıştırır, doğrular ve
// değişmez durumun yeni kopyasını üretir; alt sınıflar yalnız kendi türünün ayrıştırma/doğrulama ve taslak kuralını
// verir (tam sayı, para, oran, tutar bilgisi). Değerin durumda nerede durduğu dışarıdan verilen Erisim stratejisidir:
// aynı sınıflar Varsayimlar'ı da ihya karşılaştırma girdilerini de düzenler. Geçersiz metin durumu değiştirmez;
// hata "Hata: …" metniyle alanın yanında gösterilir, hesap son geçerli değerle sürer.

/** Değerin durumda okunduğu/yazıldığı yer. yaz değişmez kopya döndürür. */
export interface Erisim<S, T> {
  oku(durum: S): T;
  yaz(durum: S, deger: T): S;
}

export type HerhangiAlanAnahtari = AlanAnahtari | IhyaAlanAnahtari;

export interface AlanTanimi<S, K extends HerhangiAlanAnahtari = HerhangiAlanAnahtari> {
  anahtar: K;
  etiket: string;
  yardim: string;
  grup?: AlanGrubuAnahtari;
  /** Alan bu durumda görünür mü (ör. elle aylık yalnız "Elle girilen" modelinde). */
  gorunur?(durum: S): boolean;
}

export interface Araclar { ayristirici: TurkceSayiAyristirici; bicimleyici: TurkceBicimleyici }

export type UygulamaSonucu<S> = { tamam: true; durum: S } | { tamam: false; hata: string };

const HATA_ONEKI = 'Hata: ';
const onekli = (ileti: string) => (ileti.startsWith(HATA_ONEKI) ? ileti : `${HATA_ONEKI}${ileti}`);

/** Durum türü S üzerinde çalışan, değeri T olan, K anahtarlı düzenlenebilir alan. */
export abstract class FormAlani<S, T, K extends HerhangiAlanAnahtari = HerhangiAlanAnahtari> {
  abstract readonly girisModu: 'numeric' | 'decimal';
  readonly bicim: 'para' | 'metin' = 'metin';
  readonly sonek: string | null = null;
  abstract readonly zorunlu: boolean;

  constructor(
    protected readonly tanim: AlanTanimi<S, K>,
    private readonly erisim: Erisim<S, T>,
    protected readonly araclar: Araclar,
  ) {}

  get anahtar(): K { return this.tanim.anahtar; }
  get etiket() { return this.tanim.etiket; }
  get yardim() { return this.tanim.yardim; }
  get grup() { return this.tanim.grup; }

  gorunur(durum: S): boolean {
    return this.tanim.gorunur ? this.tanim.gorunur(durum) : true;
  }

  /** Metni ayrıştırır ve türün kurallarıyla doğrular (önek eklemeden). */
  protected abstract ayristir(metin: string): AyristirmaSonucu<T>;
  /** Değerden düzenlenebilir taslak metni. */
  protected abstract taslak(deger: T): string;

  /** Durumdaki değerin taslak metni. */
  taslakMetni(durum: S): string {
    return this.taslak(this.erisim.oku(durum));
  }

  /** Metni uygular: geçerliyse yeni durum, değilse "Hata: …". */
  uygula(durum: S, metin: string): UygulamaSonucu<S> {
    const sonuc = this.ayristir(metin);
    return sonuc.tamam ? { tamam: true, durum: this.erisim.yaz(durum, sonuc.deger) } : { tamam: false, hata: onekli(sonuc.hata) };
  }

  /** Metinden bağımsız durum hatası (zorunlu değer eksik); yoksa null. */
  durumHatasi(durum: S): string | null {
    void durum;
    return null;
  }
}

/** Tam sayı (gün, yıl) [enAz, enCok] aralığında. */
export class TamSayiAlani<S, K extends HerhangiAlanAnahtari = HerhangiAlanAnahtari> extends FormAlani<S, number, K> {
  readonly girisModu = 'numeric' as const;
  readonly zorunlu = true;
  override readonly sonek: string | null;

  constructor(tanim: AlanTanimi<S, K>, erisim: Erisim<S, number>, araclar: Araclar, private readonly enAz: number, private readonly enCok: number, private readonly birim: 'gün' | 'yıl') {
    super(tanim, erisim, araclar);
    this.sonek = birim;
  }

  protected ayristir(metin: string): AyristirmaSonucu<number> {
    const sonuc = this.araclar.ayristirici.tamSayi(metin);
    if (!sonuc.tamam) return sonuc;
    const { bicimleyici } = this.araclar;
    return sonuc.deger < this.enAz || sonuc.deger > this.enCok
      ? { tamam: false, hata: `${bicimleyici.sayi(this.enAz)} ile ${bicimleyici.sayi(this.enCok)} arasında bir ${this.birim} girin.` }
      : sonuc;
  }

  protected taslak(deger: number): string {
    return this.araclar.bicimleyici.sayiGirdisi(deger);
  }
}

export interface ParaKurali {
  /** Zorunlu alan boş bırakılınca (ya da durumda değer yokken) yazılan neden. Verilmezse alan isteğe bağlıdır: boş → null. */
  bosHata?: string;
}

/** Para (ondalık TL metni). İsteğe bağlıysa boş metin null'dır (ör. "resmî bedeli kullan"). */
export class ParaAlani<S, K extends HerhangiAlanAnahtari = HerhangiAlanAnahtari> extends FormAlani<S, TlMetni | null, K> {
  readonly girisModu = 'decimal' as const;
  override readonly bicim = 'para' as const;
  readonly zorunlu: boolean;

  constructor(tanim: AlanTanimi<S, K>, erisim: Erisim<S, TlMetni | null>, araclar: Araclar, private readonly kural: ParaKurali = {}) {
    super(tanim, erisim, araclar);
    this.zorunlu = Boolean(kural.bosHata);
  }

  protected ayristir(metin: string): AyristirmaSonucu<TlMetni | null> {
    if (!metin.trim()) return this.kural.bosHata ? { tamam: false, hata: this.kural.bosHata } : { tamam: true, deger: null };
    return this.araclar.ayristirici.para(metin);
  }

  protected taslak(deger: TlMetni | null): string {
    return deger === null ? '' : this.araclar.bicimleyici.paraGirdisi(deger);
  }

  override durumHatasi(durum: S): string | null {
    return this.kural.bosHata && this.gorunur(durum) && this.taslakMetni(durum) === '' ? onekli(this.kural.bosHata) : null;
  }
}

/** Oran (yüzde olarak yazılır, 0–1 oranı saklanır). bosOlabilir: boş → null ("tahmin yapılmaz"). */
export class OranAlani<S, K extends HerhangiAlanAnahtari = HerhangiAlanAnahtari> extends FormAlani<S, number | null, K> {
  readonly girisModu = 'decimal' as const;
  override readonly sonek = '%';
  readonly zorunlu: boolean;

  constructor(tanim: AlanTanimi<S, K>, erisim: Erisim<S, number | null>, araclar: Araclar, private readonly enAz: number, private readonly enCok: number, private readonly bosOlabilir: boolean) {
    super(tanim, erisim, araclar);
    this.zorunlu = !bosOlabilir;
  }

  protected ayristir(metin: string): AyristirmaSonucu<number | null> {
    if (!metin.trim() && this.bosOlabilir) return { tamam: true, deger: null };
    const sonuc = this.araclar.ayristirici.oran(metin);
    if (!sonuc.tamam) return sonuc;
    const { bicimleyici } = this.araclar;
    // Kayan nokta sınırı: yüzde metni en çok dört ondalıklıdır; karşılaştırma yüzde birimine yuvarlanır.
    const yuzde = (oran: number) => Math.round(oran * 1e6);
    return yuzde(sonuc.deger) < yuzde(this.enAz) || yuzde(sonuc.deger) > yuzde(this.enCok)
      ? { tamam: false, hata: `${bicimleyici.oran(this.enAz)} ile ${bicimleyici.oran(this.enCok)} arasında bir oran girin.` }
      : sonuc;
  }

  protected taslak(deger: number | null): string {
    return deger === null ? '' : this.araclar.bicimleyici.oranGirdisi(deger);
  }
}

export const TUTAR_BILGISI_HATA = 'Tutarı 8.500,00 ya da 300.000,00 – 450.000,00 biçiminde girin.';
export const ARALIK_SIRA_HATA = 'Alt tutar üst tutardan büyük olamaz.';
export const ELLE_KAYNAK = 'Elle girildi';
/** "a – b" (uzun/kısa tire) ya da rakamdan sonra gelen "-" aralık ayırıcısıdır; tutarlar eksi olamaz. */
const ARALIK = /^(.*\d)\s*(?:[–—]|-)\s*(.+)$/;

/**
 * Tutar bilgisi: boş → bilinmiyor (neden adıyla; tutar uydurulmaz), tek tutar → bilinen, "a – b" → aralık. bosHata
 * verilirse alan zorunludur: boş metin hatadır (durum değişmez) ve durumdaki tutar bilinmiyorsa alanın yanında yazılır.
 */
export class TutarBilgisiAlani<S, K extends HerhangiAlanAnahtari = HerhangiAlanAnahtari> extends FormAlani<S, TutarBilgisi, K> {
  readonly girisModu = 'decimal' as const;
  readonly zorunlu: boolean;

  constructor(tanim: AlanTanimi<S, K>, erisim: Erisim<S, TutarBilgisi>, araclar: Araclar, private readonly bosNedeni: string, private readonly bosHata?: string) {
    super(tanim, erisim, araclar);
    this.zorunlu = Boolean(bosHata);
  }

  override durumHatasi(durum: S): string | null {
    return this.bosHata && this.gorunur(durum) && this.taslakMetni(durum) === '' ? onekli(this.bosHata) : null;
  }

  private tutar(metin: string): AyristirmaSonucu<TlMetni> {
    const sonuc = this.araclar.ayristirici.para(metin);
    return sonuc.tamam || sonuc.hata !== PARA_HATA ? sonuc : { tamam: false, hata: TUTAR_BILGISI_HATA };
  }

  protected ayristir(metin: string): AyristirmaSonucu<TutarBilgisi> {
    const temiz = metin.trim();
    if (!temiz) return this.bosHata ? { tamam: false, hata: this.bosHata } : { tamam: true, deger: { tur: 'bilinmiyor', neden: this.bosNedeni } };
    const aralik = ARALIK.exec(temiz);
    if (!aralik) {
      const tek = this.tutar(temiz);
      return tek.tamam ? { tamam: true, deger: { tur: 'bilinen', tl: tek.deger, kaynak: ELLE_KAYNAK } } : tek;
    }
    const alt = this.tutar(aralik[1]!);
    const ust = this.tutar(aralik[2]!);
    if (!alt.tamam) return alt.hata === BOS_HATA ? { tamam: false, hata: TUTAR_BILGISI_HATA } : alt;
    if (!ust.tamam) return ust.hata === BOS_HATA ? { tamam: false, hata: TUTAR_BILGISI_HATA } : ust;
    if (kurus(alt.deger) > kurus(ust.deger)) return { tamam: false, hata: ARALIK_SIRA_HATA };
    if (kurus(alt.deger) === kurus(ust.deger)) return { tamam: true, deger: { tur: 'bilinen', tl: alt.deger, kaynak: ELLE_KAYNAK } };
    return { tamam: true, deger: { tur: 'aralik', altTl: alt.deger, ustTl: ust.deger, kaynak: ELLE_KAYNAK } };
  }

  protected taslak(deger: TutarBilgisi): string {
    const { bicimleyici } = this.araclar;
    if (deger.tur === 'bilinen') return bicimleyici.paraGirdisi(deger.tl);
    if (deger.tur === 'aralik') return `${bicimleyici.paraGirdisi(deger.altTl)} – ${bicimleyici.paraGirdisi(deger.ustTl)}`;
    return '';
  }
}

/** Ayrıştırıcının ürettiği iki ondalıklı TL metninin kuruş değeri (BigInt; büyüklük sınırı yok). */
function kurus(tl: TlMetni): bigint {
  return BigInt(tl.replace('.', ''));
}
