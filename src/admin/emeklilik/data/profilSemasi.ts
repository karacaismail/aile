// Emeklilik profilinin çalışma zamanı doğrulaması (Zod). Tek kaynak contract.EmeklilikProfili'dir; aşağıdaki tür
// eşitliği şema ile sözleşme ayrışırsa derlemeyi kırar.
//
// Kurallar:
//  - Yalnız surum 1 kabul edilir.
//  - Tarih 'YYYY-AA-GG' (takvimde geçerli, saatsiz), ay 'YYYY-AA'. TL metni nokta ondalıklı, işaretsiz, en çok iki hanedir
//    ('8500.00'); sayı tipi, yerel biçim ('1.234,56') ve üslü yazım reddedilir. Tutar hiçbir yerde kayan noktaya
//    çevrilmez: aralık uçları kuruş tamsayısıyla (BigInt) karşılaştırılır.
//  - TutarBilgisi ayrık birleşimdir ('bilinen' | 'aralik' | 'bilinmiyor'); kaynak/neden boş olamaz.
//  - Bilinmeyen alanlar reddedilmez ama sonuçtan düşer (Zod nesnesinin varsayılan davranışı); kaynak araçlar yeni alan
//    eklerse profil yine okunur, model yalnız sözleşmedeki alanları görür.
//  - Sonuç derin dondurulur: görünüm ya da model paylaşılan profili değiştiremez.
//  - Hata nedeni Türkçedir, alan yolunu söyler, hatalı değeri yazmaz (kişisel değer ekrana ya da kayda sızmaz).
import { z } from 'zod';
import type { EmeklilikProfili } from '../contract';

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const AY = /^\d{4}-(0[1-9]|1[0-2])$/;
const TL = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

/** 'YYYY-AA-GG' ve takvimde var olan gün (UTC; saat dilimi kayması yok). */
function takvimdeVar(metin: unknown): metin is string {
  if (typeof metin !== 'string' || !TARIH.test(metin)) return false;
  const [yil, ay, gun] = metin.split('-').map(Number) as [number, number, number];
  const tarih = new Date(Date.UTC(yil, ay - 1, gun));
  return tarih.getUTCFullYear() === yil && tarih.getUTCMonth() === ay - 1 && tarih.getUTCDate() === gun;
}

const ayMi = (metin: unknown): metin is string => typeof metin === 'string' && AY.test(metin);

/** TL metnini kuruş tamsayısına çevirir (BigInt; kayan nokta yok). TL deseninde olmayan değer için null. */
function tlKurus(tl: unknown): bigint | null {
  if (typeof tl !== 'string' || !TL.test(tl)) return null;
  const [tam, kesir = ''] = tl.split('.');
  return BigInt(tam!) * 100n + BigInt(kesir.padEnd(2, '0'));
}

/** Aralık uçları sıralı mı; uçlardan biri biçimsizse karar alan kuralına bırakılır (orada ayrıca reddedilir). */
function araliktaSirali(alt: unknown, ust: unknown): boolean {
  const altKurus = tlKurus(alt);
  const ustKurus = tlKurus(ust);
  return altKurus === null || ustKurus === null || altKurus <= ustKurus;
}

const Metin = z.string({ error: 'metin olmalı' });
const DoluMetin = Metin.refine(metin => metin.trim().length > 0, { error: 'boş olamaz' });
const Tarih = Metin.refine(takvimdeVar, { error: 'tarih YYYY-AA-GG biçiminde ve takvimde geçerli olmalı' });
const Ay = Metin.regex(AY, { error: 'ay YYYY-AA biçiminde olmalı' });
const Tl = Metin.regex(TL, { error: "TL metni nokta ondalıklı, işaretsiz ve en çok iki haneli olmalı (ör. '8500.00')" });
const Gun = z.int({ error: 'tam sayı olmalı' }).min(0, { error: 'negatif olamaz' });
// Zod 4 sayısı NaN ve sonsuzu kendiliğinden reddeder.
const OranSayi = z.number({ error: 'sonlu sayı olmalı' }).min(0, { error: 'negatif olamaz' });

const TutarBilgisi = z.discriminatedUnion(
  'tur',
  [
    z.object({ tur: z.literal('bilinen'), tl: Tl, kaynak: DoluMetin }),
    z
      .object({ tur: z.literal('aralik'), altTl: Tl, ustTl: Tl, kaynak: DoluMetin })
      .refine(aralik => araliktaSirali(aralik.altTl, aralik.ustTl), { error: 'aralığın alt ucu üst ucundan büyük olamaz', path: ['altTl'] }),
    z.object({ tur: z.literal('bilinmiyor'), neden: DoluMetin }),
  ],
  { error: "tutar bilgisi 'bilinen', 'aralik' ya da 'bilinmiyor' türünde olmalı" },
);

const AylikModeliAdi = z.enum(['sgkReferans', 'kazancTahmini', 'elle'], { error: "aylık modeli 'sgkReferans', 'kazancTahmini' ya da 'elle' olmalı" });

const PlanlananCalisma = z
  .object({
    baslangicAy: Ay,
    bitisAy: Ay.nullable(),
    ayBasinaGun: Gun.max(30, { error: 'ayda en çok 30 gün olabilir' }),
    aciklama: Metin,
  })
  .refine(calisma => !ayMi(calisma.bitisAy) || !ayMi(calisma.baslangicAy) || calisma.bitisAy >= calisma.baslangicAy, { error: 'bitiş ayı başlangıç ayından önce olamaz', path: ['bitisAy'] });

export const EmeklilikProfiliSemasi = z
  .object(
    {
      surum: z.literal(1, { error: 'yalnız sürüm 1 desteklenir' }),
      sentetik: z.boolean({ error: 'true ya da false olmalı' }),
      kayitTarihi: Tarih,
      dogumTarihi: Tarih,
      ilkSigortaGirisi: Tarih,
      hedefGun: Gun,
      sigortalilikYili: Gun,
      // İsteğe bağlı asgari yaş şartı (tam yıl); yoksa yaş şartı uygulanmaz (docs/EMEKLILIK-PLANI.md).
      asgariYas: Gun.max(100, { error: 'en çok 100 olabilir' }).optional(),
      kayitliGun: z.object({ gun: Gun, sonAy: Ay, once2008Gun: Gun, sonra2008Gun: Gun }),
      gunDuzeltmesi: z.object({ gun: z.int({ error: 'tam sayı olmalı' }), aciklama: Metin }),
      planlananCalisma: z.array(PlanlananCalisma, { error: 'liste olmalı' }),
      kazanc: z.object({
        sonPekTl: Tl,
        sonPekAyi: Ay,
        netUcretTl: Tl,
        ucretZamOrani: OranSayi,
        sonra2008KatToplam: OranSayi,
        once2008OrtalamaKat: OranSayi,
      }),
      sgkReferansAylik: z.object({ tl: Tl, tarih: Tarih, gun: Gun, ekOdemeTl: Tl.nullable() }),
      varsayilanAylikModeli: AylikModeliAdi,
      secenekler: z.object({
        askerlik: z
          .object({ gun: Gun, azamiGun: Gun, gunlukBedelTl: Tl.nullable(), aciklama: Metin })
          .refine(askerlik => !Number.isInteger(askerlik.gun) || !Number.isInteger(askerlik.azamiGun) || askerlik.gun <= askerlik.azamiGun, { error: 'askerlik günü azami günü aşamaz', path: ['gun'] }),
        // tahminiBorc isteğe bağlıdır (sade aracın tahmini); varsa aynı TutarBilgisi kurallarıyla doğrulanır, null kabul edilmez.
        bagkur: z.object({ gun: Gun, borc: TutarBilgisi, tahminiBorc: TutarBilgisi.optional(), yalnizSskYolundaOdenecek: TutarBilgisi, aciklama: Metin }),
        ihya: z.object({ gun: Gun, gunlukBedelTl: Tl.nullable(), aciklama: Metin }),
      }),
      kaynaklar: z.array(Metin, { error: 'liste olmalı' }),
    },
    { error: 'profil bir JSON nesnesi olmalı' },
  )
  .refine(profil => !takvimdeVar(profil.ilkSigortaGirisi) || !takvimdeVar(profil.dogumTarihi) || profil.ilkSigortaGirisi > profil.dogumTarihi, { error: 'ilk sigorta girişi doğum tarihinden sonra olmalı', path: ['ilkSigortaGirisi'] });

// --- Şema ↔ sözleşme tür eşitliği (derleme zamanı) --------------------------------------------------------------
type Esit<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const semaSozlesmeyleAyni: Esit<z.output<typeof EmeklilikProfiliSemasi>, EmeklilikProfili> = true;
void semaSozlesmeyleAyni;

// --- Doğrulama ----------------------------------------------------------------------------------------------------
export type ProfilDogrulamaSonucu = { tamam: true; profil: EmeklilikProfili } | { tamam: false; neden: string };

/** Nedende gösterilen en çok sorun sayısı; kalanlar sayıyla anılır. */
const GOSTERILEN_SORUN = 3;

function yolMetni(yol: readonly PropertyKey[]): string {
  return yol.length === 0 ? 'profil' : yol.map(parca => String(parca)).join('.');
}

/** Zod sorunlarını kısa Türkçe nedene çevirir: alan yolu + kural; değer yazılmaz. */
export function sorunlariAcikla(hata: z.ZodError): string {
  const satirlar = hata.issues.map(sorun => {
    const ileti = sorun.code === 'invalid_type' && sorun.input === undefined ? 'eksik' : sorun.message;
    return `${yolMetni(sorun.path)}: ${ileti}`;
  });
  const tekil = [...new Set(satirlar)];
  const gosterilen = tekil.slice(0, GOSTERILEN_SORUN).join('; ');
  const kalan = tekil.length - GOSTERILEN_SORUN;
  return `Profil doğrulanamadı: ${gosterilen}${kalan > 0 ? ` ve ${kalan} sorun daha` : ''}.`;
}

function derinDondur<T>(deger: T): T {
  if (deger !== null && typeof deger === 'object' && !Object.isFrozen(deger)) {
    for (const ic of Object.values(deger)) derinDondur(ic);
    Object.freeze(deger);
  }
  return deger;
}

/** Ayrıştırılmış JSON değerini doğrular; başarılıysa sözleşme alanlarından oluşan, derin dondurulmuş yeni profil verir. */
export function profilDogrula(veri: unknown): ProfilDogrulamaSonucu {
  const sonuc = EmeklilikProfiliSemasi.safeParse(veri, { reportInput: true });
  if (!sonuc.success) return { tamam: false, neden: sorunlariAcikla(sonuc.error) };
  return { tamam: true, profil: derinDondur(sonuc.data) };
}

export const JSON_DEGIL_NEDENI = 'Profil dosyası geçerli JSON değil.';

/** JSON metnini ayrıştırıp doğrular. Ayrıştırma hatası içeriği nedene yazmaz. */
export function profilJsonDogrula(metin: string): ProfilDogrulamaSonucu {
  let veri: unknown;
  try {
    veri = JSON.parse(metin);
  } catch {
    return { tamam: false, neden: JSON_DEGIL_NEDENI };
  }
  return profilDogrula(veri);
}
