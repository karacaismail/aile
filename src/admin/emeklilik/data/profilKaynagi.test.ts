// Emeklilik profil deposu (repository): profilKaynagiOlustur({ mod }).
//   - geliştirme: /__aile/emeklilik/profil.json (dev ara katmanı, AILE_EMEKLILIK_PROFILE) okunur; ilk abonelikte ya da
//     yenile() ile tek istek. 404 → 'yok' (sunucunun nedeni), diğer hata → 'hata'.
//   - üretim: varsayılan kaynak yok, hiçbir ağ isteği yapılmaz; 'yok' durumunda başlar, kullanıcı dosya içe aktarır.
//   - dosyadanYukle(File): JSON doğrulanır, profil yalnız bellekte tutulur. temizle() bellekten siler.
//   - Kalıcı depolama yoktur (localStorage, sessionStorage, IndexedDB kullanılmaz).
// Testler yalnız sentetik profili kullanır; ağ çağrısı yoktur (fetch enjekte edilir ya da stub'lanır).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmeklilikProfilKaynagi, ProfilDurumu } from '../contract';
import {
  EMEKLILIK_PROFIL_ADRESI, PROFIL_DOSYA_SINIRI_BAYT, profilKaynagiOlustur, varsayilanMod, varsayilanProfilKaynagi,
} from './index';

const SENTETIK_METIN = readFileSync(resolve(__dirname, '../../../../fixtures/emeklilik/profil-sentetik.json'), 'utf8');
const SENTETIK = JSON.parse(SENTETIK_METIN) as Record<string, unknown>;

type FetchStub = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

function fetchYaniti(yanit: () => Promise<Response>): FetchStub {
  return vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() => yanit());
}

/** Elle çözülen istek: yarış testleri için. */
function bekleyenFetch() {
  let coz!: (yanit: Response) => void;
  let reddet!: (hata: unknown) => void;
  const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>((_input, init) => new Promise<Response>((resolve, reject) => {
    coz = resolve;
    reddet = reject;
    init?.signal?.addEventListener('abort', () => reject(new DOMException('İptal', 'AbortError')));
  }));
  return { fetch, coz: (yanit: Response) => coz(yanit), reddet: (hata: unknown) => reddet(hata) };
}

const dosya = (icerik: string, ad = 'profil.json') => new File([icerik], ad, { type: 'application/json' });

/** Durum 'yukleniyor' dışına çıkana kadar bekler. */
async function yerlesik(kaynak: EmeklilikProfilKaynagi): Promise<ProfilDurumu> {
  await vi.waitFor(() => expect(kaynak.durum().tur).not.toBe('yukleniyor'));
  return kaynak.durum();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('varsayilanMod', () => {
  it('import.meta.env.PROD true → üretim, değilse geliştirme', () => {
    expect(varsayilanMod({ PROD: true })).toBe('uretim');
    expect(varsayilanMod({ PROD: false })).toBe('gelistirme');
    expect(varsayilanMod({})).toBe('gelistirme');
  });

  it('dev ara katmanı adresi sabittir', () => {
    expect(EMEKLILIK_PROFIL_ADRESI).toBe('/__aile/emeklilik/profil.json');
  });
});

describe('geliştirme modu', () => {
  it('oluşturulunca istek atmaz ve yükleniyor durumundadır; ilk abonelik tek istek başlatır', async () => {
    const fetch = fetchYaniti(async () => json(200, SENTETIK));
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch });
    expect(kaynak.durum()).toEqual({ tur: 'yukleniyor' });
    expect(fetch).not.toHaveBeenCalled();
    const dinleyici = vi.fn();
    const birak = kaynak.subscribe(dinleyici);
    kaynak.subscribe(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    const [adres, init] = fetch.mock.calls[0]!;
    expect(adres).toBe('/__aile/emeklilik/profil.json');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    const durum = await yerlesik(kaynak);
    expect(durum.tur).toBe('hazir');
    if (durum.tur === 'hazir') {
      expect(durum.kaynak).toBe('gelistirme');
      expect(durum.profil).toEqual(SENTETIK);
    }
    expect(dinleyici).toHaveBeenCalled();
    birak();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('durum() değişiklikler arasında aynı nesneyi döndürür (useSyncExternalStore kararlılığı)', async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: fetchYaniti(async () => json(200, SENTETIK)) });
    kaynak.subscribe(() => {});
    await yerlesik(kaynak);
    expect(kaynak.durum()).toBe(kaynak.durum());
  });

  it("404 → 'yok' ve sunucunun nedeni (AILE_EMEKLILIK_PROFILE tanımlı değil)", async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: fetchYaniti(async () => json(404, { error: 'AILE_EMEKLILIK_PROFILE tanımlı değil' })) });
    await kaynak.yenile();
    expect(kaynak.durum()).toEqual({ tur: 'yok', neden: 'AILE_EMEKLILIK_PROFILE tanımlı değil' });
  });

  it("JSON gövdesiz 404 de 'yok' olur ve ortam değişkenini adıyla söyler", async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: fetchYaniti(async () => new Response('Not Found', { status: 404 })) });
    await kaynak.yenile();
    const durum = kaynak.durum();
    expect(durum.tur).toBe('yok');
    if (durum.tur === 'yok') expect(durum.neden).toContain('AILE_EMEKLILIK_PROFILE tanımlı değil');
  });

  it("sunucu hatası, ağ hatası, JSON olmayan ve şemaya uymayan yanıt 'hata' olur", async () => {
    const bozuk = { ...SENTETIK, dogumTarihi: '1986-02-30' };
    const vakalar: Array<[() => Promise<Response>, RegExp]> = [
      [async () => json(500, { error: 'Hata: emeklilik profili okunamadı (EACCES)' }), /HTTP 500.*EACCES/],
      [async () => { throw new TypeError('Failed to fetch'); }, /geliştirme sunucusuna ulaşılamadı/],
      [async () => new Response('<!doctype html><p>index</p>', { status: 200, headers: { 'Content-Type': 'text/html' } }), /geçerli JSON değil/],
      [async () => json(200, bozuk), /dogumTarihi/],
    ];
    for (const [yanit, neden] of vakalar) {
      const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: fetchYaniti(yanit) });
      await kaynak.yenile();
      const durum = kaynak.durum();
      expect(durum.tur, String(neden)).toBe('hata');
      if (durum.tur === 'hata') expect(durum.neden).toMatch(neden);
    }
  });

  it('yenile() yeniden okur; abonelik ikinci isteği başlatmaz', async () => {
    const fetch = fetchYaniti(async () => json(200, SENTETIK));
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch });
    await kaynak.yenile();
    kaynak.subscribe(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    await kaynak.yenile();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(kaynak.durum().tur).toBe('hazir');
  });

  it('enjekte edilmeyen fetch global fetch\'tir (çağrı anında çözülür)', async () => {
    const global = fetchYaniti(async () => json(404, { error: 'AILE_EMEKLILIK_PROFILE tanımlı değil' }));
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme' });
    vi.stubGlobal('fetch', global);
    await kaynak.yenile();
    expect(global).toHaveBeenCalledWith('/__aile/emeklilik/profil.json', expect.anything());
    expect(kaynak.durum().tur).toBe('yok');
  });
});

describe('üretim modu', () => {
  it("varsayılan istek yapmaz: 'yok' durumunda başlar; abonelik ve yenile() ağa çıkmaz", async () => {
    const fetch = fetchYaniti(async () => json(200, SENTETIK));
    vi.stubGlobal('fetch', fetch);
    const kaynak = profilKaynagiOlustur({ mod: 'uretim', fetch });
    const durum = kaynak.durum();
    expect(durum.tur).toBe('yok');
    if (durum.tur === 'yok') expect(durum.neden).toMatch(/içe aktarın/);
    kaynak.subscribe(() => {});
    await kaynak.yenile();
    expect(fetch).not.toHaveBeenCalled();
    expect(kaynak.durum()).toBe(durum);
  });

  it("dosyadanYukle geçerli profili belleğe alır ('dosya'); ağ isteği yok", async () => {
    const fetch = fetchYaniti(async () => json(200, SENTETIK));
    vi.stubGlobal('fetch', fetch);
    const kaynak = profilKaynagiOlustur({ mod: 'uretim' });
    const dinleyici = vi.fn();
    kaynak.subscribe(dinleyici);
    await kaynak.dosyadanYukle(dosya(SENTETIK_METIN));
    const durum = kaynak.durum();
    expect(durum.tur).toBe('hazir');
    if (durum.tur === 'hazir') {
      expect(durum.kaynak).toBe('dosya');
      expect(durum.profil).toEqual(SENTETIK);
      expect(Object.isFrozen(durum.profil)).toBe(true);
    }
    expect(dinleyici).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // Üretimde yenile() içe aktarılan profili değiştirmez.
    await kaynak.yenile();
    expect(kaynak.durum()).toBe(durum);
  });
});

describe('dosyadanYukle', () => {
  it("JSON olmayan, şemaya uymayan ve çok büyük dosya 'hata' olur; neden içeriği yazmaz", async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'uretim' });
    await kaynak.dosyadanYukle(dosya('{"dogumTarihi":"1986-03-10",'));
    expect(kaynak.durum()).toEqual({ tur: 'hata', neden: 'Profil dosyası geçerli JSON değil.' });

    await kaynak.dosyadanYukle(dosya(JSON.stringify({ ...SENTETIK, surum: 2 })));
    let durum = kaynak.durum();
    expect(durum.tur).toBe('hata');
    if (durum.tur === 'hata') expect(durum.neden).toContain('surum');

    await kaynak.dosyadanYukle(dosya(' '.repeat(PROFIL_DOSYA_SINIRI_BAYT + 1)));
    durum = kaynak.durum();
    expect(durum.tur).toBe('hata');
    if (durum.tur === 'hata') expect(durum.neden).toMatch(/çok büyük/);
  });

  it('bilinmeyen alanlar yok sayılır; profil belleğe girer', async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'uretim' });
    await kaynak.dosyadanYukle(dosya(JSON.stringify({ ...SENTETIK, ekNot: 'serbest' })));
    const durum = kaynak.durum();
    expect(durum.tur).toBe('hazir');
    if (durum.tur === 'hazir') expect(durum.profil).not.toHaveProperty('ekNot');
  });

  it('geliştirmede de dosya içe aktarılabilir; uçuştaki dev isteğinin geç yanıtı dosya profilini ezmez', async () => {
    const istek = bekleyenFetch();
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: istek.fetch });
    kaynak.subscribe(() => {});
    expect(istek.fetch).toHaveBeenCalledTimes(1);
    const dosyaProfili = { ...SENTETIK, kaynaklar: ['Sentetik dosya kopyası'] };
    await kaynak.dosyadanYukle(dosya(JSON.stringify(dosyaProfili)));
    istek.coz(json(200, SENTETIK));
    await new Promise(resolve => setTimeout(resolve, 0));
    const durum = kaynak.durum();
    expect(durum.tur).toBe('hazir');
    if (durum.tur === 'hazir') {
      expect(durum.kaynak).toBe('dosya');
      expect(durum.profil.kaynaklar).toEqual(['Sentetik dosya kopyası']);
    }
  });
});

describe('temizle', () => {
  it("profili bellekten siler ('yok'), dinleyicilere bildirir", async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'uretim' });
    await kaynak.dosyadanYukle(dosya(SENTETIK_METIN));
    const dinleyici = vi.fn();
    kaynak.subscribe(dinleyici);
    kaynak.temizle();
    const durum = kaynak.durum();
    expect(durum.tur).toBe('yok');
    if (durum.tur === 'yok') expect(durum.neden).toMatch(/silindi/);
    expect(dinleyici).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(durum)).not.toContain(String(SENTETIK.dogumTarihi));
  });

  it('uçuştaki isteği iptal eder; geç yanıt yok sayılır', async () => {
    const istek = bekleyenFetch();
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: istek.fetch });
    const yukleme = kaynak.yenile();
    const signal = istek.fetch.mock.calls[0]![1]!.signal!;
    kaynak.temizle();
    expect(signal.aborted).toBe(true);
    await yukleme;
    expect(kaynak.durum().tur).toBe('yok');
  });

  it('abonelik bırakılınca dinleyici çağrılmaz', async () => {
    const kaynak = profilKaynagiOlustur({ mod: 'uretim' });
    const dinleyici = vi.fn();
    const birak = kaynak.subscribe(dinleyici);
    birak();
    await kaynak.dosyadanYukle(dosya(SENTETIK_METIN));
    kaynak.temizle();
    expect(dinleyici).not.toHaveBeenCalled();
  });
});

describe('kalıcı depolama yok', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'getItem');
  });

  it('içe aktarma, yenileme ve temizleme localStorage/sessionStorage/IndexedDB kullanmaz', async () => {
    const indexedDB = { open: vi.fn(), deleteDatabase: vi.fn() };
    vi.stubGlobal('indexedDB', indexedDB);
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch: fetchYaniti(async () => json(200, SENTETIK)) });
    kaynak.subscribe(() => {});
    await yerlesik(kaynak);
    await kaynak.dosyadanYukle(dosya(SENTETIK_METIN));
    kaynak.temizle();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    expect(Storage.prototype.getItem).not.toHaveBeenCalled();
    expect(indexedDB.open).not.toHaveBeenCalled();
  });

  it('kaynak kapısı: data/ modülleri tarayıcı depolama API\'lerine ve idb-keyval\'a başvurmaz', () => {
    const klasor = __dirname;
    const kaynaklar = readdirSync(klasor).filter(ad => /\.tsx?$/.test(ad) && !/\.test\.tsx?$/.test(ad));
    expect(kaynaklar.length).toBeGreaterThan(0);
    for (const ad of kaynaklar) {
      const metin = readFileSync(join(klasor, ad), 'utf8');
      expect(metin, ad).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|idb-keyval|caches\.open|document\.cookie)\b/);
    }
  });
});

describe('sentetik profille başlatma (test ve önizleme)', () => {
  it("'hazir' (kaynak 'sentetik') başlar; abonelik istek atmaz; geçersiz profil 'hata' olur", () => {
    const fetch = fetchYaniti(async () => json(200, SENTETIK));
    const kaynak = profilKaynagiOlustur({ mod: 'gelistirme', fetch, sentetikProfil: SENTETIK });
    const durum = kaynak.durum();
    expect(durum.tur).toBe('hazir');
    if (durum.tur === 'hazir') {
      expect(durum.kaynak).toBe('sentetik');
      expect(durum.profil).toEqual(SENTETIK);
    }
    kaynak.subscribe(() => {});
    expect(fetch).not.toHaveBeenCalled();
    const bozuk = profilKaynagiOlustur({ mod: 'uretim', sentetikProfil: { ...SENTETIK, surum: 3 } });
    expect(bozuk.durum().tur).toBe('hata');
  });
});

describe('varsayilanProfilKaynagi', () => {
  it('sözleşmeyi uygular ve içe aktarılırken ağ isteği yapmaz', () => {
    for (const yontem of ['durum', 'subscribe', 'yenile', 'dosyadanYukle', 'temizle'] as const) {
      expect(typeof varsayilanProfilKaynagi[yontem], yontem).toBe('function');
    }
    // Test ortamı geliştirme modudur (import.meta.env.PROD false): ilk abonelikten önce istek yok.
    expect(varsayilanProfilKaynagi.durum().tur).toBe('yukleniyor');
  });
});
