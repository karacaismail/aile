// Takvim değer nesneleri. Ay: 'YYYY-MM' planlama ayı (ay sonu kabul edilir). TakvimGunu: 'YYYY-MM-DD'.
// Hesaplar saat dilimsiz takvim aritmetiğidir; "bugün" yalnız Ay.istanbulda ile Europe/Istanbul'a göre okunur.
import type { AyMetni, TarihMetni } from '../contract';

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const AY_DESENI = /^(\d{4})-(\d{2})$/;
const GUN_DESENI = /^(\d{4})-(\d{2})-(\d{2})$/;

const artikYil = (yil: number) => (yil % 4 === 0 && yil % 100 !== 0) || yil % 400 === 0;
const aydakiGun = (yil: number, ay: number) => [31, artikYil(yil) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][ay - 1];
const iki = (n: number) => String(n).padStart(2, '0');
const dort = (n: number) => String(n).padStart(4, '0');

export class Ay {
  private constructor(readonly yil: number, readonly ay: number) {}

  static metinden(metin: AyMetni): Ay {
    const e = typeof metin === 'string' ? AY_DESENI.exec(metin) : null;
    const yil = e ? Number(e[1]) : 0;
    const ay = e ? Number(e[2]) : 0;
    if (!e || yil < 1 || ay < 1 || ay > 12) throw new RangeError(`Geçersiz ay: "${metin}" (YYYY-MM beklenir)`);
    return new Ay(yil, ay);
  }

  static tarihten(tarih: TarihMetni): Ay {
    return TakvimGunu.metinden(tarih).ay();
  }

  /** Verilen anın Europe/Istanbul takvimindeki ayı. */
  static istanbulda(an: Date): Ay {
    const parcalar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(an);
    const deger = (tur: string) => Number(parcalar.find((p) => p.type === tur)?.value);
    return new Ay(deger('year'), deger('month'));
  }

  private static siradan(sira: number): Ay {
    const yil = Math.floor(sira / 12);
    if (yil < 1 || yil > 9999) throw new RangeError('Ay 0001–9999 aralığının dışında.');
    return new Ay(yil, (sira % 12) + 1);
  }

  static enGec(a: Ay, b: Ay): Ay {
    return a.karsilastir(b) >= 0 ? a : b;
  }

  static enErken(a: Ay, b: Ay): Ay {
    return a.karsilastir(b) <= 0 ? a : b;
  }

  /** Sıralama için mutlak ay numarası. */
  get sira(): number {
    return this.yil * 12 + (this.ay - 1);
  }

  ekle(ay: number): Ay {
    if (!Number.isSafeInteger(ay)) throw new RangeError(`Ay sayısı tamsayı olmalı: ${ay}`);
    return Ay.siradan(this.sira + ay);
  }

  /** this − diger (ay). */
  fark(diger: Ay): number {
    return this.sira - diger.sira;
  }

  aySonu(): TakvimGunu {
    return TakvimGunu.olustur(this.yil, this.ay, aydakiGun(this.yil, this.ay));
  }

  karsilastir(diger: Ay): -1 | 0 | 1 {
    return this.sira < diger.sira ? -1 : this.sira > diger.sira ? 1 : 0;
  }

  esit(diger: Ay): boolean {
    return this.sira === diger.sira;
  }

  oncesiMi(diger: Ay): boolean {
    return this.sira < diger.sira;
  }

  sonrasiMi(diger: Ay): boolean {
    return this.sira > diger.sira;
  }

  metin(): AyMetni {
    return `${dort(this.yil)}-${iki(this.ay)}`;
  }

  /** 'Aralık 2027'. */
  adi(): string {
    return `${AY_ADLARI[this.ay - 1]} ${this.yil}`;
  }

  toString(): string {
    return this.metin();
  }
}

export class TakvimGunu {
  private constructor(readonly yil: number, readonly ayNo: number, readonly gun: number) {}

  static olustur(yil: number, ay: number, gun: number): TakvimGunu {
    if (!Number.isInteger(yil) || yil < 1 || yil > 9999 || ay < 1 || ay > 12 || gun < 1 || gun > aydakiGun(yil, ay)) {
      throw new RangeError(`Geçersiz tarih: ${yil}-${ay}-${gun}`);
    }
    return new TakvimGunu(yil, ay, gun);
  }

  static metinden(metin: TarihMetni): TakvimGunu {
    const e = typeof metin === 'string' ? GUN_DESENI.exec(metin) : null;
    if (!e) throw new RangeError(`Geçersiz tarih: "${metin}" (YYYY-MM-DD beklenir)`);
    return TakvimGunu.olustur(Number(e[1]), Number(e[2]), Number(e[3]));
  }

  static enGec(a: TakvimGunu, b: TakvimGunu): TakvimGunu {
    return a.karsilastir(b) >= 0 ? a : b;
  }

  /** Yıl ekler; hedef yılda olmayan 29 Şubat 1 Mart'a taşar. */
  yilEkle(yil: number): TakvimGunu {
    if (!Number.isSafeInteger(yil)) throw new RangeError(`Yıl sayısı tamsayı olmalı: ${yil}`);
    const hedef = this.yil + yil;
    if (this.gun > aydakiGun(hedef, this.ayNo)) return TakvimGunu.olustur(hedef, this.ayNo + 1, 1);
    return TakvimGunu.olustur(hedef, this.ayNo, this.gun);
  }

  /** Bu doğum tarihine göre `gun` günü tamamlanmış yaş. */
  yasi(gun: TakvimGunu): number {
    const yil = gun.yil - this.yil;
    const dogumGunuGecti = gun.ayNo > this.ayNo || (gun.ayNo === this.ayNo && gun.gun >= this.gun);
    return dogumGunuGecti ? yil : yil - 1;
  }

  ay(): Ay {
    return Ay.metinden(`${dort(this.yil)}-${iki(this.ayNo)}`);
  }

  karsilastir(diger: TakvimGunu): -1 | 0 | 1 {
    const a = this.yil * 10000 + this.ayNo * 100 + this.gun;
    const b = diger.yil * 10000 + diger.ayNo * 100 + diger.gun;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  metin(): TarihMetni {
    return `${dort(this.yil)}-${iki(this.ayNo)}-${iki(this.gun)}`;
  }

  /** '2 Kasım 2026'. */
  adi(): string {
    return `${this.gun} ${AY_ADLARI[this.ayNo - 1]} ${this.yil}`;
  }

  toString(): string {
    return this.metin();
  }
}
