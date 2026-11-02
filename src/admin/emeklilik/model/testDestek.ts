// Yalnız testler içindir: sentetik profil ve varsayım kopyaları. Kişisel profil hiçbir testte kullanılmaz.
import sentetik from '../../../../fixtures/emeklilik/profil-sentetik.json';
import type { EmeklilikProfili, TutarBilgisi, Varsayimlar } from '../contract';

/** fixtures/emeklilik/profil-sentetik.json'un değiştirilebilir derin kopyası. */
export function sentetikProfil(degistir?: (p: EmeklilikProfili) => void): EmeklilikProfili {
  const profil = structuredClone(sentetik) as unknown as EmeklilikProfili;
  if (profil.sentetik !== true) throw new Error('Testler yalnız sentetik profil kullanır.');
  degistir?.(profil);
  return profil;
}

/** Varsayımların derin kopyası; değişiklik işleviyle. */
export function varsayimKopya(v: Varsayimlar, degistir?: (k: Varsayimlar) => void): Varsayimlar {
  const kopya = structuredClone(v);
  degistir?.(kopya);
  return kopya;
}

/** TutarBilgisi'ni kısa karşılaştırma biçimine indirger: '12.00', ['1.00', '2.00'] ya da 'bilinmiyor'. */
export function kisa(t: TutarBilgisi): string | [string, string] {
  if (t.tur === 'bilinen') return t.tl;
  if (t.tur === 'aralik') return [t.altTl, t.ustTl];
  return 'bilinmiyor';
}

/** Sentetik profil + MEVZUAT_2026 için beklenen varsayılan varsayımlar (planlayıcıdan bağımsız yazılmıştır). */
export function sentetikVarsayimlar(degistir?: (k: Varsayimlar) => void): Varsayimlar {
  const v: Varsayimlar = {
    aylikModeli: 'sgkReferans',
    elleAylikTl: null,
    borcKesintiOrani: 0.1,
    digerKesintilerTl: '0.00',
    karsilastirmaSuresiYil: 10,
    isUcretiDevam: true,
    gunDuzeltmesiUygula: false,
    gelecekAyBasinaGun: 30,
    bagkurGecikmeAylikOran: null,
    secenekGirdileri: {
      askerlik: { gun: 360, gunlukBedelTl: '495.45' },
      bagkur: {
        gun: 600,
        borc: { tur: 'aralik', altTl: '300000.00', ustTl: '450000.00', kaynak: 'Sentetik aralık' },
        yalnizSskYolundaOdenecek: { tur: 'bilinen', tl: '50000.00', kaynak: 'Sentetik ortak ödeme' },
      },
      ihya: { gun: 500, gunlukBedelTl: '495.45' },
    },
  };
  degistir?.(v);
  return v;
}
