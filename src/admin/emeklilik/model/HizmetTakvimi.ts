// Hizmet takvimi: kayıtlı gün + (isteğe bağlı) kayıt düzeltmesi + kayıtlı aydan sonra ay ay planlanan SSK
// çalışması. Günler ay sonunda sayılır; bir ayda en çok 30 gün. Açık uçlu planda ay başına gün varsayımdır.
import type { EmeklilikProfili, Varsayimlar } from '../contract';
import { Ay } from './Ay';

const AYLIK_AZAMI_GUN = 30;

interface PlanDilimi {
  baslangic: Ay;
  bitis: Ay | null;
  ayBasinaGun: number;
}

function gunGecerli(gun: number, ad: string, azami = AYLIK_AZAMI_GUN): number {
  if (!Number.isSafeInteger(gun) || gun < 0 || gun > azami) throw new RangeError(`${ad} 0–${azami} arasında tamsayı olmalı: ${gun}`);
  return gun;
}

export class HizmetTakvimi {
  private readonly kayitliSonAy: Ay;
  private readonly dilimler: readonly PlanDilimi[];

  constructor(private readonly profil: EmeklilikProfili) {
    this.kayitliSonAy = Ay.metinden(profil.kayitliGun.sonAy);
    this.dilimler = profil.planlananCalisma.map((c) => {
      const baslangic = Ay.metinden(c.baslangicAy);
      const bitis = c.bitisAy === null ? null : Ay.metinden(c.bitisAy);
      if (bitis !== null && bitis.oncesiMi(baslangic)) throw new RangeError(`Planlanan çalışmanın bitişi başlangıcından önce: ${c.baslangicAy}–${c.bitisAy}`);
      return { baslangic, bitis, ayBasinaGun: gunGecerli(c.ayBasinaGun, 'Planlanan ay başına gün') };
    });
  }

  /** Kayıtlı gün + uygulanıyorsa kayıt düzeltmesi. */
  bazGun(varsayim: Varsayimlar): number {
    return this.profil.kayitliGun.gun + this.duzeltme(varsayim);
  }

  duzeltme(varsayim: Varsayimlar): number {
    return varsayim.gunDuzeltmesiUygula ? this.profil.gunDuzeltmesi.gun : 0;
  }

  /** Bir ayda planlanan SSK günü (kayıtlı ay ve öncesi 0; en çok 30). */
  ayinGunu(ay: Ay, varsayim: Varsayimlar): number {
    const gelecek = gunGecerli(varsayim.gelecekAyBasinaGun, 'Gelecekte ay başına gün');
    if (!ay.sonrasiMi(this.kayitliSonAy)) return 0;
    let toplam = 0;
    for (const d of this.dilimler) {
      if (ay.oncesiMi(d.baslangic) || (d.bitis !== null && ay.sonrasiMi(d.bitis))) continue;
      toplam += d.bitis === null ? gelecek : d.ayBasinaGun;
    }
    return Math.min(AYLIK_AZAMI_GUN, toplam);
  }

  /** Kayıtlı aydan sonra `ay` sonuna kadar planlanan SSK günü. */
  calismaGunuAyaKadar(ay: Ay, varsayim: Varsayimlar): number {
    let toplam = 0;
    for (let a = this.kayitliSonAy.ekle(1); !a.sonrasiMi(ay); a = a.ekle(1)) toplam += this.ayinGunu(a, varsayim);
    return toplam;
  }

  /** Bu aydan sonra her ay aynı gün eklenen (açık uçlu) bölgenin başladığı ay; açık uçlu dilim yoksa null. */
  private sabitBolgeBaslangici(): Ay | null {
    let sinir: Ay | null = null;
    let acikVar = false;
    for (const d of this.dilimler) {
      const son = d.bitis === null ? d.baslangic : d.bitis.ekle(1);
      if (d.bitis === null) acikVar = true;
      sinir = sinir === null ? son : Ay.enGec(sinir, son);
    }
    if (!acikVar || sinir === null) return null;
    return Ay.enGec(sinir, this.kayitliSonAy.ekle(1));
  }

  /**
   * Baz gün + ekGun + planlanan çalışma hedef güne ilk hangi ayın sonunda ulaşır. Baz + ek zaten yeterliyse
   * kayıtlı ay döner (çalışma 0). Ulaşılamıyorsa null.
   */
  hedefeUlasma(ekGun: number, varsayim: Varsayimlar): { ay: Ay; calismaGunu: number } | null {
    if (!Number.isSafeInteger(ekGun) || ekGun < 0) throw new RangeError(`Eklenen gün sıfır ya da pozitif tamsayı olmalı: ${ekGun}`);
    const hedef = this.profil.hedefGun;
    let toplam = this.bazGun(varsayim) + ekGun;
    if (toplam >= hedef) return { ay: this.kayitliSonAy, calismaGunu: 0 };

    const sabit = this.sabitBolgeBaslangici();
    // Sonlu dilimlerin son ayı (ya da açık uçlu bölgenin başlangıcından önceki ay) kadar ay ay say.
    const sonlu = this.dilimler.reduce<Ay | null>((s, d) => (d.bitis === null ? s : s === null ? d.bitis : Ay.enGec(s, d.bitis)), null);
    const tarama = sabit !== null ? sabit.ekle(-1) : sonlu;
    let calisma = 0;
    if (tarama !== null) {
      for (let a = this.kayitliSonAy.ekle(1); !a.sonrasiMi(tarama); a = a.ekle(1)) {
        const gun = this.ayinGunu(a, varsayim);
        calisma += gun;
        toplam += gun;
        if (toplam >= hedef) return { ay: a, calismaGunu: calisma };
      }
    }
    if (sabit === null) return null;
    const ayBasina = this.ayinGunu(sabit, varsayim);
    if (ayBasina === 0) return null;
    const ay = Math.ceil((hedef - toplam) / ayBasina);
    return { ay: sabit.ekle(ay - 1), calismaGunu: calisma + ay * ayBasina };
  }

  /** Sonlu planın toplam günü (açık uçlu ve gün eklenen bölge varsa null: sınırsız). */
  planliToplam(varsayim: Varsayimlar): number | null {
    const sabit = this.sabitBolgeBaslangici();
    if (sabit !== null && this.ayinGunu(sabit, varsayim) > 0) return null;
    const son = this.dilimler.reduce<Ay | null>((s, d) => (d.bitis === null ? s : s === null ? d.bitis : Ay.enGec(s, d.bitis)), null);
    return son === null ? 0 : this.calismaGunuAyaKadar(son, varsayim);
  }
}
