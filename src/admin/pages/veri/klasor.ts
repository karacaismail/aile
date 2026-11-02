// Klasör içe aktarma: yöntem seçimi (özellik algılama), seçilen klasörde nesil adaylarını bulma ve seçilen nesli
// nesil sağlayıcısına kaynak olarak verme. React yok. UA okunmaz; yöntem yalnız yeteneğe bakar:
//   - "secici": window.showDirectoryPicker (Chromium ailesi; File System Access API, salt okunur).
//   - "girdi" : <input type="file" webkitdirectory> (Safari/WebKit ve seçicisiz tarayıcılar); dosyalar
//               webkitRelativePath ile aynı ağaç yüzeyine (DizinTutamagi) çevrilir.
//   - "yok"   : ikisi de yok; düğme devre dışı ve nedeni yanında yazılır.
// Aday kuralı geliştirme sunucusunun (devServer/privateData.ts selectGeneration) kuralıyla aynıdır: kök, doğrudan alt
// klasörler ve generations/* altı; manifest.json taşıyan ve generation_id'si sha256 olan klasör adaydır. Yalnız
// manifest.json okunur (küçük); parçalar seçimden sonra depo tarafından sha256 doğrulamasıyla okunur.
// Hiçbir yol yazma/silme yapmaz.

export type KlasorYontemi = 'secici' | 'girdi' | 'yok';

interface PencereBenzeri {
  showDirectoryPicker?: unknown;
  document?: { createElement(tag: 'input'): object };
}

/** Özellik algılama: seçici → girdi (webkitdirectory) → yok. */
export function klasorYontemi(win: PencereBenzeri | undefined = typeof window === 'undefined' ? undefined : (window as unknown as PencereBenzeri)): KlasorYontemi {
  if (!win) return 'yok';
  if (typeof win.showDirectoryPicker === 'function') return 'secici';
  const input = win.document?.createElement('input');
  return input && 'webkitdirectory' in input ? 'girdi' : 'yok';
}

// --- Ağaç yüzeyi (FileSystemDirectoryHandle'ın panelin kullandığı alt kümesi) -----------------------------------
export interface DosyaBenzeri { text(): Promise<string> }
export interface DosyaTutamagi { readonly kind: 'file'; readonly name: string; getFile(): Promise<DosyaBenzeri> }
export interface DizinTutamagi {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string): Promise<DizinTutamagi>;
  getFileHandle(name: string): Promise<DosyaTutamagi>;
  /** Doğrudan çocuklar; bilinmiyorsa (yalnız okuma sunan tutamak) boş. */
  values(): AsyncIterable<DizinTutamagi | DosyaTutamagi>;
}

const bulunamadi = (name: string) => new DOMException(`Bulunamadı: ${name}`, 'NotFoundError');

type HamTutamak = {
  kind?: unknown;
  name?: unknown;
  getDirectoryHandle?: (name: string) => Promise<unknown>;
  getFileHandle?: (name: string) => Promise<unknown>;
  values?: () => AsyncIterable<unknown>;
  getFile?: () => Promise<DosyaBenzeri>;
};

/** Tarayıcının (ya da testin) dizin tutamağını DizinTutamagi'na sarar; values() yoksa çocuk listesi boştur. */
export function dizinden(handle: unknown, name?: string): DizinTutamagi {
  const ham = handle as HamTutamak;
  if (!ham || typeof ham.getDirectoryHandle !== 'function' || typeof ham.getFileHandle !== 'function') {
    throw new TypeError('Dizin tutamağı değil');
  }
  const ad = name ?? (typeof ham.name === 'string' ? ham.name : '');
  return {
    kind: 'directory',
    name: ad,
    getDirectoryHandle: async child => dizinden(await ham.getDirectoryHandle!(child)),
    getFileHandle: async child => {
      const file = (await ham.getFileHandle!(child)) as HamTutamak;
      if (!file || typeof file.getFile !== 'function') throw bulunamadi(child);
      return { kind: 'file', name: child, getFile: () => file.getFile!() };
    },
    async *values() {
      if (typeof ham.values !== 'function') return;
      for await (const entry of ham.values()) {
        const item = entry as HamTutamak;
        if (item?.kind === 'directory') yield dizinden(item);
        else if (item?.kind === 'file' && typeof item.name === 'string') yield { kind: 'file', name: item.name, getFile: () => item.getFile!() } as DosyaTutamagi;
      }
    },
  };
}

interface AgacDugumu { dizinler: Map<string, AgacDugumu>; dosyalar: Map<string, File> }

function agactanDizin(dugum: AgacDugumu, name: string): DizinTutamagi {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: async child => {
      const next = dugum.dizinler.get(child);
      if (!next) throw bulunamadi(child);
      return agactanDizin(next, child);
    },
    getFileHandle: async child => {
      const file = dugum.dosyalar.get(child);
      if (!file) throw bulunamadi(child);
      return { kind: 'file', name: child, getFile: async () => file };
    },
    async *values() {
      for (const [child, next] of dugum.dizinler) yield agactanDizin(next, child);
      for (const [child, file] of dugum.dosyalar) yield { kind: 'file', name: child, getFile: async () => file } as DosyaTutamagi;
    },
  };
}

/**
 * <input webkitdirectory> dosyalarını (webkitRelativePath "kök/alt/dosya") tek köklü ağaca çevirir. Göreli yolu
 * olmayan, kökü farklı ya da "."/".." bölütlü dosyalar alınmaz. Hiç dosya kalmazsa null.
 */
export function dosyalardanDizin(files: ArrayLike<File>): DizinTutamagi | null {
  const kok: AgacDugumu = { dizinler: new Map(), dosyalar: new Map() };
  let kokAdi: string | null = null;
  let adet = 0;
  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || '').split('/');
    if (parts.length < 2 || parts.some(part => part === '' || part === '.' || part === '..')) continue;
    if (kokAdi === null) kokAdi = parts[0]!;
    if (parts[0] !== kokAdi) continue;
    let dugum = kok;
    for (const part of parts.slice(1, -1)) {
      let next = dugum.dizinler.get(part);
      if (!next) {
        next = { dizinler: new Map(), dosyalar: new Map() };
        dugum.dizinler.set(part, next);
      }
      dugum = next;
    }
    dugum.dosyalar.set(parts[parts.length - 1]!, file);
    adet += 1;
  }
  return adet > 0 && kokAdi !== null ? agactanDizin(kok, kokAdi) : null;
}

// --- Nesil adayları -------------------------------------------------------------------------------------------
export interface NesilAdayi {
  /** Kökten göreli klasör ("" kök, "eski", "generations/x"). */
  yol: string;
  /** Gösterim ve kaynak etiketi: "nesil-klasoru" ya da "nesil-klasoru/eski". */
  etiket: string;
  /** Kaynağa verilecek tutamak; adı etiket olarak sarılmış. */
  dizin: DizinTutamagi;
  generationId: string;
  /** Kaynak yakalamalarının en geç bitişi (ISO); yoksa null ("Bilinmiyor"). */
  yakalama: string | null;
  koleksiyon: number;
  kayit: number;
  sentetik: boolean;
}

export interface AdayTaramasi {
  adaylar: NesilAdayi[];
  /** manifest.json'u olup okunamayan/geçersiz klasörler ("eski: generation_id sha256 değil"). */
  atlanan: string[];
}

const NESIL_KIMLIGI = /^[a-f0-9]{64}$/;

/** DizinTutamagi'nı aynı içerikle başka adla sunar (kaynak etiketi "kök/alt" olur). */
export function adlandir(dizin: DizinTutamagi, name: string): DizinTutamagi {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: child => dizin.getDirectoryHandle(child),
    getFileHandle: child => dizin.getFileHandle(child),
    values: () => dizin.values(),
  };
}

async function cocukDizinler(dizin: DizinTutamagi): Promise<DizinTutamagi[]> {
  const out: DizinTutamagi[] = [];
  try {
    for await (const entry of dizin.values()) if (entry.kind === 'directory') out.push(entry);
  } catch {
    // Listelenemeyen klasör aday üretmez; okunabilen manifestler yine taranır.
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
}

const enGec = (values: unknown[]): string | null => {
  let best: { iso: string; time: number } | null = null;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const time = Date.parse(value);
    if (Number.isNaN(time)) continue;
    if (!best || time > best.time) best = { iso: value, time };
  }
  return best?.iso ?? null;
};

type ManifestOkuma = { aday: Omit<NesilAdayi, 'yol' | 'etiket' | 'dizin'> } | { hata: string } | null;

async function manifestOku(dizin: DizinTutamagi): Promise<ManifestOkuma> {
  let text: string;
  try {
    const handle = await dizin.getFileHandle('manifest.json');
    text = await (await handle.getFile()).text();
  } catch {
    return null; // manifest yok: aday değil, hata da değil
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { hata: 'manifest.json JSON değil' };
  }
  const manifest = raw as { schemaVersion?: unknown; generation_id?: unknown; files?: unknown; counts?: unknown; sources?: unknown; synthetic?: unknown };
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1) return { hata: 'schemaVersion 1 değil' };
  if (typeof manifest.generation_id !== 'string' || !NESIL_KIMLIGI.test(manifest.generation_id)) return { hata: 'generation_id sha256 değil' };
  if (!Array.isArray(manifest.files)) return { hata: 'files dizisi yok' };
  const counts = manifest.counts && typeof manifest.counts === 'object' ? Object.values(manifest.counts as Record<string, unknown>) : [];
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  return {
    aday: {
      generationId: manifest.generation_id,
      yakalama: enGec(sources.map(source => (source as { capture?: { completed_at?: unknown } })?.capture?.completed_at)),
      koleksiyon: counts.length,
      kayit: counts.reduce<number>((sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0),
      sentetik: manifest.synthetic === true,
    },
  };
}

/**
 * Seçilen klasörde nesil adaylarını bulur: kök, doğrudan alt klasörler ve generations/* (geliştirme sunucusuyla
 * aynı kural). Sıra: en yeni yakalama önce (bilinmeyen sona), eşitlikte etiket.
 */
export async function nesilAdaylari(kok: DizinTutamagi): Promise<AdayTaramasi> {
  const yerler: { yol: string; dizin: DizinTutamagi }[] = [{ yol: '', dizin: kok }];
  for (const cocuk of await cocukDizinler(kok)) {
    yerler.push({ yol: cocuk.name, dizin: cocuk });
    if (cocuk.name === 'generations') {
      for (const torun of await cocukDizinler(cocuk)) yerler.push({ yol: `generations/${torun.name}`, dizin: torun });
    }
  }
  const adaylar: NesilAdayi[] = [];
  const atlanan: string[] = [];
  for (const { yol, dizin } of yerler) {
    const etiket = yol ? `${kok.name}/${yol}` : kok.name;
    const okuma = await manifestOku(dizin);
    if (!okuma) continue;
    if ('hata' in okuma) atlanan.push(`${etiket}: ${okuma.hata}`);
    else adaylar.push({ yol, etiket, dizin: adlandir(dizin, etiket), ...okuma.aday });
  }
  adaylar.sort((a, b) => {
    const ta = a.yakalama ? Date.parse(a.yakalama) : Number.NEGATIVE_INFINITY;
    const tb = b.yakalama ? Date.parse(b.yakalama) : Number.NEGATIVE_INFINITY;
    return tb - ta || a.etiket.localeCompare(b.etiket, 'tr-TR');
  });
  return { adaylar, atlanan };
}

// --- Kaynağa verme --------------------------------------------------------------------------------------------
type PickDirectory = () => Promise<boolean>;

/**
 * Seçilen nesil klasörünü GenerationProvider'ın kaynağı yapar. Sağlayıcının bugünkü tek kaynak değiştirme yolu
 * pickDirectory()'dir: DirectoryGenerationSource.pick() window.showDirectoryPicker'ı eşzamanlı okur ve dönen tutamağı
 * kaynak yapar. Bu yüzden seçici, pickDirectory çağrısı süresince (eşzamanlı) seçilen tutamağı döndüren bir işlevle
 * değiştirilir ve hemen eski hâline getirilir; arada render ya da başka kod çalışmaz. Kalıcı çözüm için veri katmanına
 * kaynak alan bir API istendi (d02-loading); geldiğinde bu işlev onunla değiştirilir.
 */
export function nesliKaynakYap(pickDirectory: PickDirectory, dizin: DizinTutamagi, win: Window = window): Promise<boolean> {
  const host = win as unknown as Record<string, unknown>;
  const own = Object.prototype.hasOwnProperty.call(host, 'showDirectoryPicker');
  const previous = own ? Object.getOwnPropertyDescriptor(host, 'showDirectoryPicker') : undefined;
  const secici = async () => dizin;
  try {
    Object.defineProperty(host, 'showDirectoryPicker', { value: secici, configurable: true, writable: true });
  } catch {
    return Promise.reject(new Error('Hata: Nesil kaynağı değiştirilemedi (tarayıcı izin vermedi).'));
  }
  try {
    return pickDirectory();
  } finally {
    if (previous) Object.defineProperty(host, 'showDirectoryPicker', previous);
    else delete host.showDirectoryPicker;
  }
}
