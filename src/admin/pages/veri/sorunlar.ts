// Sorun kuyruğunun saf mantığı (React yok): sorun kodu → Türkçe tür, kaynak hücre adresi, etki metni, türe göre
// gruplama, kararlı sıralama ve sayfa dilimi. Gerçek nesilde kuyruk yüzlerce kayıttır (469 formül hatası dahil) ve tek
// tabloda ~36 bin karakter üretir; sayfa bu yüzden türe göre gruplar ve her grubu SAYFA_BOYUTU'luk dilimlerle çizer.
// Eksik bilgi saklanmaz, adıyla yazılır ("Kaynak bilinmiyor", "Bilinmiyor", "Ayrıntı yok").
import type { Issue } from '../../data';
import type { Tone } from '../../shell/contracts';
import { BILINMIYOR, sayi } from './bicim';

/** Bir grubun tek seferde çizdiği kayıt sayısı (telefon ve geniş profil aynı). */
export const SAYFA_BOYUTU = 20;

export const KAYNAK_BILINMIYOR = 'Kaynak bilinmiyor';
export const AYRINTI_YOK = 'Ayrıntı yok';

/** normalize.mjs / taxonomy.mjs sorun kodları; bilinmeyen kod olduğu gibi yazılır (gizlenmez). */
const SORUN_TURU: Record<string, string> = {
  invalid_link: 'Geçersiz bağlantı',
  unknown_term: 'Bilinmeyen terim',
  unresolved_relation: 'Çözülmeyen ilişki',
  invalid_date: 'Geçersiz tarih',
  invalid_amount: 'Geçersiz tutar',
  missing_record_id: 'Kayıt kimliği eksik',
  duplicate_record_id: 'Yinelenen kayıt kimliği',
  unresolved_room: 'Çözülmeyen oda',
  unknown_phase: 'Bilinmeyen aşama',
  unknown_category: 'Bilinmeyen kategori',
  formula_error: 'Formül hatası',
  source_only_sheet: 'Yalnız kaynak sayfa',
};
export const sorunTuru = (code: string): string => SORUN_TURU[code] ?? code;

const SORUN_DURUMU: Record<string, { label: string; tone: Tone }> = {
  review: { label: 'Gözden geçirilecek', tone: 'uyari' },
  error: { label: 'Hata', tone: 'hata' },
  info: { label: 'Bilgi', tone: 'bilgi' },
  resolved: { label: 'Çözüldü', tone: 'olumlu' },
};
export function sorunDurumu(severity: string | undefined): { label: string; tone: Tone } {
  if (!severity || !severity.trim()) return { label: BILINMIYOR, tone: 'notr' };
  return SORUN_DURUMU[severity] ?? { label: severity, tone: 'notr' };
}

/** Önem sırası: hata → gözden geçirilecek → bilinmeyen → bilgi → çözüldü. Küçük önce gelir. */
const ONEM: Record<string, number> = { error: 0, review: 1, info: 3, resolved: 4 };
const onemOf = (severity: string | undefined) => (severity && severity in ONEM ? ONEM[severity]! : 2);

const AYRINTI_ALANI: Record<string, string> = {
  value: 'Değer', vocabulary: 'Sözlük', field: 'Alan', kind: 'Tür', target: 'Hedef', lookup: 'Arama', sheet: 'Sayfa',
  message: 'İleti', type: 'Tip', reason: 'Neden', column: 'Sütun', row: 'Satır', expected: 'Beklenen', actual: 'Okunan',
};

/** Google E-Tablolar hata türü (veri platformu adı) → hücrede görünen hata kodu. */
const FORMUL_HATASI: Record<string, string> = {
  REF: '#REF!', DIV_ZERO: '#DIV/0!', VALUE: '#VALUE!', NAME: '#NAME?', N_A: '#N/A', NA: '#N/A', NUM: '#NUM!',
  NULL: '#NULL!', ERROR: '#ERROR!',
};

function degerMetni(key: string, value: unknown): string {
  if (key === 'type' && typeof value === 'string' && FORMUL_HATASI[value]) return FORMUL_HATASI[value];
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** detail nesnesini "Alan: değer · Alan: değer" biçiminde yazar; boşsa "Ayrıntı yok". */
export function etkiMetni(detail: unknown): string {
  if (detail === null || detail === undefined) return AYRINTI_YOK;
  if (typeof detail !== 'object') return String(detail);
  const parts = Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${AYRINTI_ALANI[key] ?? key}: ${degerMetni(key, value)}`);
  return parts.length ? parts.join(' · ') : AYRINTI_YOK;
}

const pozitifTam = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * A1 gösterimini okunur hücre adresine çevirir: "G9" → "G9", "11:11" → "11. satır", "3:5" → "3–5. satırlar",
 * "C:C" → "C sütunu", "A1:B2" → "A1:B2". a1 yoksa satır numarasından "N. satır"; hiçbiri yoksa null.
 */
export function a1Metni(a1: unknown, row?: unknown): string | null {
  const text = typeof a1 === 'string' ? a1.trim() : '';
  if (text) {
    const satir = /^(\d+):(\d+)$/.exec(text);
    if (satir) return satir[1] === satir[2] ? `${satir[1]}. satır` : `${satir[1]}–${satir[2]}. satırlar`;
    const sutun = /^([A-Za-z]+):([A-Za-z]+)$/.exec(text);
    if (sutun) {
      const [bas, son] = [sutun[1]!.toUpperCase(), sutun[2]!.toUpperCase()];
      return bas === son ? `${bas} sütunu` : `${bas}–${son} sütunları`;
    }
    return text;
  }
  return pozitifTam(row) ? `${row}. satır` : null;
}

/** Kaynak hücre adresi: "Gerçekleşen · G9", "app_kalemler · 11. satır"; provenance yoksa "Kaynak bilinmiyor". */
export function hucreAdresi(issue: Issue): string {
  const prov = issue.provenance;
  if (!prov) return KAYNAK_BILINMIYOR;
  const sayfa = typeof prov.sheet_title === 'string' && prov.sheet_title.trim() ? prov.sheet_title.trim() : null;
  const parts = [sayfa, a1Metni(prov.a1, prov.row)].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' · ') : KAYNAK_BILINMIYOR;
}

/** Kaynak çalışma kitabının anahtarı (sources.key); yoksa "Bilinmiyor". */
export function kaynakAnahtari(issue: Issue): string {
  const key = issue.provenance?.source_key;
  return typeof key === 'string' && key.trim() ? key.trim() : BILINMIYOR;
}

const harfler = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });
const sonsuz = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY);

/** Kaynak hücre sırası: kaynak → sayfa → satır → sütun → kimlik (kararlı). Provenance'sız kayıtlar sona. */
export function hucreSirasi(a: Issue, b: Issue): number {
  const pa = a.provenance;
  const pb = b.provenance;
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.id.localeCompare(b.id);
  return (
    harfler.compare(pa.source_key ?? '', pb.source_key ?? '')
    || harfler.compare(pa.sheet_title ?? '', pb.sheet_title ?? '')
    || sonsuz(pa.row) - sonsuz(pb.row)
    || sonsuz(pa.column) - sonsuz(pb.column)
    || a.id.localeCompare(b.id)
  );
}

export interface SorunGrubu {
  /** Sorun kodu (formula_error); grubun kalıcı anahtarı. */
  kod: string;
  /** Türkçe tür adı (Formül hatası). */
  ad: string;
  /** Kaynak hücre sırasıyla kayıtlar. */
  sorunlar: readonly Issue[];
}

/**
 * Sorunları koda göre gruplar. Grup sırası: en ağır önem (hata önce), sonra kalabalık önce, sonra Türkçe ad.
 * Grup içi sıra kaynak hücre sırasıdır; sayfa dilimleri bu yüzden yenilemeler arasında kararlıdır.
 */
export function sorunGruplari(issues: readonly Issue[]): SorunGrubu[] {
  const byCode = new Map<string, Issue[]>();
  for (const issue of issues) {
    const code = typeof issue.code === 'string' && issue.code ? issue.code : BILINMIYOR;
    const list = byCode.get(code);
    if (list) list.push(issue);
    else byCode.set(code, [issue]);
  }
  return [...byCode.entries()]
    .map(([kod, list]) => ({ kod, ad: kod === BILINMIYOR ? BILINMIYOR : sorunTuru(kod), sorunlar: [...list].sort(hucreSirasi), onem: Math.min(...list.map(issue => onemOf(issue.severity))) }))
    .sort((a, b) => a.onem - b.onem || b.sorunlar.length - a.sorunlar.length || harfler.compare(a.ad, b.ad))
    .map(({ kod, ad, sorunlar }) => ({ kod, ad, sorunlar }));
}

export interface SayfaDilimi {
  /** 0 tabanlı, sınırlar içine alınmış sayfa. */
  sayfa: number;
  sayfaSayisi: number;
  /** 1 tabanlı ilk ve son kayıt (boşta 0). */
  ilk: number;
  son: number;
  toplam: number;
}

/** Kayıt sayısı ve istenen sayfadan dilim; sayfa [0, sayfaSayisi-1] aralığına sıkıştırılır. */
export function sayfaDilimi(toplam: number, sayfa: number, boyut: number = SAYFA_BOYUTU): SayfaDilimi {
  const adet = Math.max(0, Math.floor(toplam));
  const sayfaSayisi = Math.max(1, Math.ceil(adet / boyut));
  const secili = Math.min(Math.max(0, Math.floor(Number.isFinite(sayfa) ? sayfa : 0)), sayfaSayisi - 1);
  if (adet === 0) return { sayfa: 0, sayfaSayisi, ilk: 0, son: 0, toplam: 0 };
  return { sayfa: secili, sayfaSayisi, ilk: secili * boyut + 1, son: Math.min(adet, (secili + 1) * boyut), toplam: adet };
}

/** "21–40 / 469" (tr-TR basamak ayırıcıyla). */
export const aralikMetni = ({ ilk, son, toplam }: SayfaDilimi): string => `${sayi(ilk)}–${sayi(son)} / ${sayi(toplam)}`;
