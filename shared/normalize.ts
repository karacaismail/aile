// CSV ("Eşya - Taşınma öncesi sonrası") satırı → uygulama kalemi. Vitest, tarayıcı ve Apps Script'te çalışır.
import type { Item, Oda } from './schema.ts';
import { KATEGORI } from './schema.ts';
import { parseNumberTr } from './convert.ts';
import { ulid } from './ids.ts';

export type Kategori = (typeof KATEGORI)[number];

/** ICU'ya bağımlı olmayan Türkçe küçük harf. */
export function trLower(s: string): string {
  return s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
}

export function parseTl(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = raw.replace(/₺|TL|tl/g, '').replace(/\s+/g, '').trim();
  if (s === '' || s === '?') return null;
  const n = parseNumberTr(s);
  return n === undefined ? null : n;
}

export function parsePhase(checked: string | boolean | undefined, when: string | number | undefined): { faz: '1' | '2' | '3'; kararBekliyor: boolean } {
  const w = when === undefined || when === null ? '' : String(when).trim();
  if (w === '2' || w === '3') return { faz: w, kararBekliyor: false };
  const c = typeof checked === 'boolean' ? checked : String(checked ?? '').trim().toUpperCase() === 'TRUE';
  if (c) return { faz: '1', kararBekliyor: false };
  return { faz: '2', kararBekliyor: true };
}

export type KeywordMap<T extends string> = Array<[T, string[]]>;

export const ODA_KEYWORDS: KeywordMap<Oda> = [
  ['cocuk', ['çocuk', 'cocuk', 'ders', 'bulut']],
  ['mutfak', ['mutfak', 'tezgâh', 'tezgah', 'buzdolab', 'dondurucu', 'bulaşık', 'kahve', 'espresso', 'bıçak', 'kesme tahtası', 'baharat', 'erzak', 'saklama', 'bardağ', 'bardak', 'havlu', 'silikon', 'fırın', 'ocak', 'sebzelik']],
  ['banyo', ['banyo', 'duş', 'çamaşır', 'kurutmalık']],
  ['wc', ['wc', 'tuvalet']],
  ['ebeveyn', ['baza', 'karyola', 'yatak', 'komodin', 'şifonyer', 'somya', 'alez', 'gardırop', 'gardirop']],
  ['calisma', ['çalışma', 'calisma', 'kitaplık', 'evrak', 'ofis', 'masaüstü', 'dock', 'bilgisayar', 'modem', 'router']],
  ['hol', ['askılık', 'portmanto', 'anahtar askısı', 'anahtarlık', 'kapı stoperi']],
  ['balkon1', ['balkon']],
  ['salon', ['koltuk', 'berjer', 'oturma', 'televizyon', 'tv ünitesi', 'sehpa', 'lambader', 'tablo', 'çerçeve', 'puf', 'duvar saati']],
];

export const KATEGORI_KEYWORDS: KeywordMap<Kategori> = [
  ['guvenlik', ['yangın', 'duman', 'alarm', 'gaz ', 'pencere güvenliği', 'sabitleyici', 'köşe koruyucu', 'kilit', 'bariyer', 'dedektör']],
  ['boya', ['boya', 'alçı', 'onarım', 'badana', 'macun']],
  ['elektrik', ['kablo', 'kanal', 'priz', 'tesisat', 'kaçak akım', 'sigorta', 'pano']],
  ['aydinlatma_akilli', ['hue', 'akıllı', 'smart', 'zigbee', 'sensör', 'bridge']],
  ['aydinlatma_led', ['ampul', 'led', 'lamba', 'lambader', 'aydınlatma', 'armatür', 'aplik', 'avize', 'spot', 'profil']],
  ['beyaz_esya', ['buzdolab', 'dondurucu', 'çamaşır makinesi', 'bulaşık makinesi', 'klima', 'kurutma makinesi', 'fırın', 'ocak']],
  ['mutfak', ['bıçak', 'kesme tahtası', 'kahve', 'espresso', 'baharat', 'saklama', 'bardak', 'bardağ', 'havlu', 'silikon', 'erzak', 'sebzelik', 'tencere', 'tava']],
  ['tekstil', ['perde', 'tül', 'halı', 'kilim', 'yolluk', 'alez', 'yastık', 'puf', 'nevresim', 'havlu seti']],
  ['mobilya', ['koltuk', 'berjer', 'oturma grubu', 'baza', 'karyola', 'yatak', 'kitaplık', 'masa', 'sandalye', 'sehpa', 'komodin', 'şifonyer', 'ünite', 'konsol', 'askılık', 'portmanto', 'dolap', 'raf', 'somya', 'başlığı', 'ütü masası']],
  ['masraf', ['depozito', 'peşinat', 'kira', 'abonelik', 'aidat']],
  ['hizmet', ['nakliye', 'taşıma', 'işlemleri', 'montaj', 'koli', 'ambalaj', 'kağıt']],
  ['idari', ['teyit', 'kuralları', 'envanter', 'kaydet', 'belge', 'klasör']],
  ['kopek', ['köpek', 'kafes', 'tasma', 'mama', 'pet']],
  ['bebek', ['bebek', 'beşik', 'emzirme']],
];

function matchKeywords<T extends string>(name: string, map: KeywordMap<T>): T | undefined {
  const n = trLower(name);
  for (const [key, words] of map) {
    if (words.some((w) => n.includes(trLower(w)))) return key;
  }
  return undefined;
}

export function guessOda(name: string, extra?: KeywordMap<Oda>): Oda | undefined {
  return (extra ? matchKeywords(name, extra) : undefined) ?? matchKeywords(name, ODA_KEYWORDS);
}

export function guessKategori(name: string, extra?: KeywordMap<Kategori>): Kategori {
  return (extra ? matchKeywords(name, extra) : undefined) ?? matchKeywords(name, KATEGORI_KEYWORDS) ?? 'diger';
}

export function collectLinks(cells: readonly (string | undefined)[]): { links: string[]; notes: string[] } {
  const links: string[] = [];
  const notes: string[] = [];
  for (const raw of cells) {
    const s = (raw ?? '').trim();
    if (!s) continue;
    if (/^https?:\/\//i.test(s)) { if (!links.includes(s)) links.push(s); }
    else notes.push(s);
  }
  return { links, notes };
}

export interface CsvOptions {
  odaKeywords?: KeywordMap<Oda>;
  kategoriKeywords?: KeywordMap<Kategori>;
  idFor?: (row: readonly string[], index: number) => string;
}

/** Sütun sırası: sıra | onay | Eşya | When? | fiyat | not/link... (ilk satır başlık). */
export function csvRowToItem(row: readonly string[], _header: readonly string[], index: number, opts: CsvOptions = {}): Item | null {
  const [sira, onay, esya, when, fiyat, ...rest] = row.map((x) => (x ?? '').toString());
  const ad = esya.trim();
  if (!ad) return null;
  const price = parseTl(fiyat);
  const { faz, kararBekliyor } = parsePhase(onay, when);
  const { links, notes } = collectLinks(rest);
  const mevcut = price === 0;
  const item: Item = {
    id: opts.idFor ? opts.idFor(row, index) : ulid(),
    tip: 'satinalma',
    ad,
    faz,
    karar_bekliyor: kararBekliyor,
    adet: 1,
    birim: 'adet',
    kategori: guessKategori(ad, opts.kategoriKeywords),
  };
  const kod = sira.trim();
  if (kod) item.kod = kod;
  const oda = guessOda(ad, opts.odaKeywords);
  if (oda) item.oda = oda;
  if (mevcut) {
    item.mevcut = true;
  } else if (price !== null) {
    item.tahmini_tl_min = price;
    item.tahmini_tl_max = price;
    item.fiyat_guven = 'tahmini';
    item.durum = 'karar';
  } else {
    item.durum = 'fikir';
  }
  if (links.length) item.linkler = links;
  if (notes.length) item.not = notes.join('\n');
  return item;
}

/** Basit RFC 4180 ayrıştırıcı (tırnak, çift tırnak kaçışı, hücre içi satır sonu). */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
