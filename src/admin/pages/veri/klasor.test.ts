// Klasör içe aktarma saf mantığı: özellik algılama (UA yok), webkitdirectory dosya listesinden ağaç, nesil adayları
// (geliştirme sunucusuyla aynı kural) ve seçilen nesli kaynağa verme. Dosyalar sentetik nesilden bellekte üretilir.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectoryGenerationSource } from '../../data';
import { dizinden, dosyalardanDizin, klasorYontemi, nesilAdaylari, nesliKaynakYap } from './klasor';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(ROOT).find(name => statSync(join(ROOT, name)).isDirectory())!;
const MANIFEST = readFileSync(join(ROOT, GENERATION_ID, 'manifest.json'), 'utf8');
const ESKI_ID = 'e'.repeat(64);
const ESKI_MANIFEST = JSON.stringify({
  ...JSON.parse(MANIFEST),
  generation_id: ESKI_ID,
  sources: [{ key: 'budget', capture: { completed_at: '2026-10-20T06:30:00.000Z' } }],
});

/** webkitRelativePath taşıyan File (jsdom bu alanı doldurmaz). */
function dosya(path: string, text: string): File {
  const file = new File([text], path.split('/').pop()!, { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('klasorYontemi (özellik algılama)', () => {
  const input = (webkitdirectory: boolean) => ({ createElement: () => (webkitdirectory ? { webkitdirectory: false } : {}) });

  it('showDirectoryPicker varsa "secici"; yoksa webkitdirectory varsa "girdi"; ikisi de yoksa "yok"', () => {
    expect(klasorYontemi({ showDirectoryPicker: () => undefined, document: input(true) })).toBe('secici');
    expect(klasorYontemi({ document: input(true) })).toBe('girdi');
    expect(klasorYontemi({ showDirectoryPicker: undefined, document: input(false) })).toBe('yok');
    expect(klasorYontemi(undefined)).toBe('yok');
  });

  it('user agent okumaz', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get');
    klasorYontemi({ document: input(true) });
    expect(ua).not.toHaveBeenCalled();
    ua.mockRestore();
  });
});

describe('dosyalardanDizin (webkitdirectory)', () => {
  it('göreli yollardan tek köklü ağaç kurar; dosya metni okunabilir', async () => {
    const kok = dosyalardanDizin([dosya('nesil-klasoru/yeni/manifest.json', MANIFEST), dosya('nesil-klasoru/yeni/data/issues/budget/00000.json', '{"x":1}')])!;
    expect(kok.name).toBe('nesil-klasoru');
    const yeni = await kok.getDirectoryHandle('yeni');
    const parca = await (await (await (await yeni.getDirectoryHandle('data')).getDirectoryHandle('issues')).getDirectoryHandle('budget')).getFileHandle('00000.json');
    expect(await (await parca.getFile()).text()).toBe('{"x":1}');
    const cocuklar: string[] = [];
    for await (const entry of kok.values()) cocuklar.push(`${entry.kind}:${entry.name}`);
    expect(cocuklar).toEqual(['directory:yeni']);
    await expect(kok.getFileHandle('yok.json')).rejects.toThrow(/Bulunamadı/);
  });

  it('göreli yolu olmayan, farklı köklü ya da ".." bölütlü dosyaları almaz; hiç dosya yoksa null', () => {
    expect(dosyalardanDizin([new File(['{}'], 'manifest.json')])).toBeNull();
    const kok = dosyalardanDizin([dosya('a/manifest.json', MANIFEST), dosya('b/manifest.json', MANIFEST), dosya('a/../x.json', '{}')])!;
    expect(kok.name).toBe('a');
    expect(dosyalardanDizin([])).toBeNull();
  });
});

describe('nesilAdaylari', () => {
  it('kökün kendisi nesilse tek aday; etiket klasör adı', async () => {
    const kok = dosyalardanDizin([dosya('nesil/manifest.json', MANIFEST), dosya('nesil/data/issues/budget/00000.json', '{}')])!;
    const { adaylar, atlanan } = await nesilAdaylari(kok);
    expect(atlanan).toEqual([]);
    expect(adaylar).toHaveLength(1);
    expect(adaylar[0]).toMatchObject({ yol: '', etiket: 'nesil', generationId: GENERATION_ID, yakalama: '2026-10-28T08:00:05.000Z', koleksiyon: 24, sentetik: true });
    expect(adaylar[0]!.kayit).toBe(Object.values(JSON.parse(MANIFEST).counts as Record<string, number>).reduce((a, b) => a + b, 0));
    expect(adaylar[0]!.dizin.name).toBe('nesil');
  });

  it('alt klasörler ve generations/* adaydır; en yeni yakalama önce; geçersiz manifest atlanır ve adıyla bildirilir', async () => {
    const kok = dosyalardanDizin([
      dosya('kok/eski/manifest.json', ESKI_MANIFEST),
      dosya('kok/yeni/manifest.json', MANIFEST),
      dosya('kok/generations/arsiv/manifest.json', JSON.stringify({ ...JSON.parse(MANIFEST), generation_id: 'f'.repeat(64), sources: [] })),
      dosya('kok/bozuk/manifest.json', '{ değil'),
      dosya('kok/kisa/manifest.json', JSON.stringify({ ...JSON.parse(MANIFEST), generation_id: 'abc' })),
      dosya('kok/notlar/oku.json', '{}'),
    ])!;
    const { adaylar, atlanan } = await nesilAdaylari(kok);
    expect(adaylar.map(aday => aday.etiket)).toEqual(['kok/yeni', 'kok/eski', 'kok/generations/arsiv']);
    expect(adaylar.map(aday => aday.yakalama)).toEqual(['2026-10-28T08:00:05.000Z', '2026-10-20T06:30:00.000Z', null]);
    expect(adaylar[1]!.dizin.name).toBe('kok/eski');
    expect(atlanan).toEqual(['kok/bozuk: manifest.json JSON değil', 'kok/kisa: generation_id sha256 değil']);
  });

  it('nesil olmayan klasör: aday yok', async () => {
    const kok = dosyalardanDizin([dosya('belgeler/notlar/oku.json', '{}')])!;
    expect(await nesilAdaylari(kok)).toEqual({ adaylar: [], atlanan: [] });
  });

  it('values() sunmayan tutamak (yalnız okuma) yalnız kökü tarar', async () => {
    const kok = dizinden({
      name: 'yalniz-okuma',
      getDirectoryHandle: async () => { throw new DOMException('yok', 'NotFoundError'); },
      getFileHandle: async (name: string) => {
        if (name !== 'manifest.json') throw new DOMException('yok', 'NotFoundError');
        return { getFile: async () => ({ text: async () => MANIFEST }) };
      },
    });
    const { adaylar } = await nesilAdaylari(kok);
    expect(adaylar.map(aday => aday.etiket)).toEqual(['yalniz-okuma']);
  });

  it('dizinden: dizin tutamağı olmayan değer reddedilir', () => {
    expect(() => dizinden({ name: 'x' })).toThrow(TypeError);
  });
});

describe('nesliKaynakYap', () => {
  it('pickDirectory çağrısı süresince seçici seçilen dizini döndürür; sonra eski hâline döner', async () => {
    const kok = dosyalardanDizin([dosya('kok/yeni/manifest.json', MANIFEST)])!;
    const [aday] = (await nesilAdaylari(kok)).adaylar;
    let kaynak: DirectoryGenerationSource | null = null;
    const pickDirectory = vi.fn(async () => {
      kaynak = await DirectoryGenerationSource.pick();
      return true;
    });
    expect(DirectoryGenerationSource.isSupported()).toBe(false);
    await expect(nesliKaynakYap(pickDirectory, aday!.dizin)).resolves.toBe(true);
    // Kaynak seçilen alt klasörden okur ve etiketi "kök/alt"tır.
    expect(kaynak!.label).toBe('kok/yeni');
    expect(await kaynak!.readText('manifest.json')).toBe(MANIFEST);
    // Seçici yalnız çağrı süresince vardı: tarayıcı yeteneği değişmedi.
    expect(DirectoryGenerationSource.isSupported()).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(window, 'showDirectoryPicker')).toBe(false);
  });

  it('tarayıcının kendi seçicisi varsa onu geri koyar', async () => {
    const yerli = vi.fn();
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = yerli;
    const kok = dosyalardanDizin([dosya('kok/manifest.json', MANIFEST)])!;
    const kaynak = await nesliKaynakYap(async () => {
      const source = await DirectoryGenerationSource.pick();
      return source.label === 'kok';
    }, kok);
    expect(kaynak).toBe(true);
    expect((window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker).toBe(yerli);
    expect(yerli).not.toHaveBeenCalled();
  });
});
