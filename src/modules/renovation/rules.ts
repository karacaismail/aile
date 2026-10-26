// Tadilat modülü saf kuralları: tarih sayacı, zaman çizelgesi, usta sayaçları, kontrol listesi metni, iş sıralama/bağımlılık.
import type { Item } from '@shared/schema';
import { BAYRAM_2027, RAMAZAN_2027, addDays, daysUntil, todayIso } from '@/lib/dates';

/** Tadilat işleri için yerel durum etiketleri (label() yerine). */
export const TASK_DURUM_LABEL: Record<string, string> = {
  fikir: 'Planlandı', arastirma: 'Teklif', karar: 'Onaylandı', siparis: 'Devam ediyor', teslim: 'Bitti', kuruldu: 'Kabul edildi', iptal: 'İptal',
};
export function taskDurumLabel(durum: string | undefined | null): string {
  if (!durum) return '';
  return TASK_DURUM_LABEL[durum] ?? durum;
}

/** Bağımlılık çözümünde "bitmiş" sayılan durumlar. */
export const TASK_RESOLVED = new Set(['teslim', 'kuruldu', 'iptal']);
export const VENDOR_TARGET = { aday: 5, teklif: 3 } as const;

const isLive = (i: Item) => !i.deleted_at;

/** Hedef tarihe kalan gün (geçmiş negatif); tarih yoksa null. */
export function countdown(dateIso: string | undefined | null, now: Date = new Date()): number | null {
  if (!dateIso) return null;
  return daysUntil(dateIso, now);
}

export type TimelineKind = 'bugun' | 'bant' | 'kilometre' | 'tadilat';
export type BandHint = 'ramazan' | 'bayram' | 'diger';
export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  title: string;
  date: string;
  endDate?: string;
  tur?: string;
  band?: BandHint;
  senaryo?: string;
  note?: string;
  /** Bitişi (yoksa tarihi) bugünden önce. */
  past: boolean;
  /** Bugün aralığın içinde. */
  current: boolean;
  item?: Item;
}

const KIND_ORDER: Record<TimelineKind, number> = { bugun: 0, bant: 1, kilometre: 2, tadilat: 3 };
const coll = new Intl.Collator('tr');

function bandHint(ad: string): BandHint {
  const s = ad.toLocaleLowerCase('tr');
  if (s.includes('ramazan') && !s.includes('bayram')) return 'ramazan';
  if (s.includes('bayram')) return 'bayram';
  return 'diger';
}

function flags(date: string, endDate: string | undefined, today: string): { past: boolean; current: boolean } {
  const end = endDate ?? date;
  return { past: end < today, current: date <= today && today <= end };
}

/** Kilometre taşları (seçili senaryo + "hepsi" + senaryosuz) ve tarihi olan işler; sabit Ramazan/Bayram bantları; bugün işareti. */
export function timelineEntries(items: readonly Item[], scenario: string | undefined, now: Date = new Date()): TimelineEntry[] {
  const today = todayIso(now);
  const out: TimelineEntry[] = [];
  for (const i of items) {
    if (!isLive(i) || !i.planlanan_tarih) continue;
    if (i.tip === 'kilometre') {
      if (scenario && i.senaryo && i.senaryo !== 'hepsi' && i.senaryo !== scenario) continue;
      const isBand = i.kilometre_tur === 'bant';
      const endDate = i.bitis_tarihi ?? (isBand ? i.planlanan_tarih : undefined);
      out.push({
        id: i.id, kind: isBand ? 'bant' : 'kilometre', title: i.ad, date: i.planlanan_tarih, endDate, tur: i.kilometre_tur,
        band: isBand ? bandHint(i.ad) : undefined, senaryo: i.senaryo, note: i.not, item: i, ...flags(i.planlanan_tarih, endDate, today),
      });
    } else if (i.tip === 'tadilat') {
      const endDate = i.bitis_tarihi ?? (i.sure_gun && i.sure_gun > 0 ? addDays(i.planlanan_tarih, i.sure_gun) : undefined);
      out.push({
        id: i.id, kind: 'tadilat', title: [i.kod, i.ad].filter(Boolean).join(' '), date: i.planlanan_tarih, endDate, note: i.not, item: i,
        ...flags(i.planlanan_tarih, endDate, today),
      });
    }
  }
  const constants: Array<{ id: string; band: BandHint; title: string; range: { start: string; end: string } }> = [
    { id: 'bant-ramazan-2027', band: 'ramazan', title: 'Ramazan 2027', range: RAMAZAN_2027 },
    { id: 'bant-bayram-2027', band: 'bayram', title: 'Ramazan Bayramı 2027', range: BAYRAM_2027 },
  ];
  for (const c of constants) {
    if (out.some((e) => e.kind === 'bant' && e.date === c.range.start)) continue;
    out.push({ id: c.id, kind: 'bant', title: c.title, date: c.range.start, endDate: c.range.end, tur: 'bant', band: c.band, ...flags(c.range.start, c.range.end, today) });
  }
  out.push({ id: 'bugun', kind: 'bugun', title: 'Bugün', date: today, past: false, current: true });
  return out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || coll.compare(a.title, b.title));
}

/** Meslek bazında aday ve teklif sayısı ('hepsi' ya da boş → tümü). */
export function vendorStats(ustalar: readonly Item[], meslek?: string): { aday: number; teklif: number } {
  let aday = 0; let teklif = 0;
  for (const u of ustalar) {
    if (!isLive(u) || u.tip !== 'usta') continue;
    if (meslek && meslek !== 'hepsi' && u.meslek !== meslek) continue;
    aday++;
    if (u.teklif_tl != null && u.teklif_tl > 0) teklif++;
  }
  return { aday, teklif };
}

/** Kontrol maddeleri → numaralı düz metin (WhatsApp ile ustaya gönderilir). */
export function checklistText(items: readonly Item[]): string {
  const lines: string[] = [];
  for (const i of items) {
    if (!isLive(i)) continue;
    const esik = i.esik ? ` — eşik: ${i.esik}${i.olcum_birim ? ` ${i.olcum_birim}` : ''}` : '';
    lines.push(`${lines.length + 1}. ${i.ad}${esik}`);
  }
  return lines.join('\n');
}

function kodKey(kod: string | undefined): [string, number] | null {
  if (!kod) return null;
  const m = /^([^\d]*)(\d+)?/.exec(kod.trim());
  return [(m?.[1] ?? '').toLocaleLowerCase('tr'), m?.[2] ? Number(m[2]) : Number.POSITIVE_INFINITY];
}

/** Kod (doğal sıra: T2 < T10), kodsuzlar sonda; sonra planlanan tarih, sonra ad. */
export function sortTasks(tasks: readonly Item[]): Item[] {
  return tasks.slice().sort((a, b) => {
    const ka = kodKey(a.kod); const kb = kodKey(b.kod);
    if (ka && kb) {
      const c = coll.compare(ka[0], kb[0]) || ka[1] - kb[1] || coll.compare(a.kod!, b.kod!);
      if (c) return c;
    } else if (ka || kb) return ka ? -1 : 1;
    const da = a.planlanan_tarih ?? '￿'; const db = b.planlanan_tarih ?? '￿';
    return da.localeCompare(db) || coll.compare(a.ad, b.ad);
  });
}

/** Tüm bağımlılık kodları bitmiş (teslim/kuruldu/iptal) bir işe karşılık geliyorsa true; bilinmeyen kod çözülmemiş sayılır. */
export function depsResolved(task: Item, tasks: readonly Item[]): boolean {
  const deps = (task.bagimlilik ?? []).map((k) => k.trim().toLocaleLowerCase('tr')).filter(Boolean);
  if (!deps.length) return true;
  const byKod = new Map<string, Item>();
  for (const t of tasks) if (isLive(t) && t.tip === 'tadilat' && t.kod) byKod.set(t.kod.trim().toLocaleLowerCase('tr'), t);
  return deps.every((k) => { const t = byKod.get(k); return !!t && !!t.durum && TASK_RESOLVED.has(t.durum); });
}

/** Yalnız rakam, 90 ile başlar: "0532…" → "90532…", "532…" → "90532…", "0090…" → "90…". */
export function normalizePhone(telefon: string | undefined | null): string {
  let d = (telefon ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('90') && d.length === 12) return d;
  if (d.startsWith('0')) return `9${d}`;
  if (d.length === 10) return `90${d}`;
  return d;
}
export function whatsappHref(telefon: string | undefined | null): string | undefined {
  const d = normalizePhone(telefon);
  return d ? `https://wa.me/${d}` : undefined;
}

export const KONTROL_TUR_ORDER = ['sartname', 'kabul', 'izin', 'ev_secimi'] as const;
export type CheckGroups = Map<string, Map<string, Item[]>>;

/** kontrol_tur → meslek (yoksa "genel") → maddeler. Sıra: sabit tür sırası; meslek ilk görülme sırası. */
export function groupChecks(items: readonly Item[]): CheckGroups {
  const g: CheckGroups = new Map();
  const sorted = items.filter((i) => isLive(i) && i.tip === 'kontrol').sort((a, b) => {
    const ia = KONTROL_TUR_ORDER.indexOf((a.kontrol_tur ?? 'sartname') as typeof KONTROL_TUR_ORDER[number]);
    const ib = KONTROL_TUR_ORDER.indexOf((b.kontrol_tur ?? 'sartname') as typeof KONTROL_TUR_ORDER[number]);
    return ia - ib;
  });
  for (const i of sorted) {
    const tur = i.kontrol_tur ?? 'sartname';
    const meslek = i.meslek ?? 'genel';
    if (!g.has(tur)) g.set(tur, new Map());
    const sub = g.get(tur)!;
    if (!sub.has(meslek)) sub.set(meslek, []);
    sub.get(meslek)!.push(i);
  }
  return g;
}

export function checklistProgress(items: readonly Item[]): { done: number; total: number } {
  let done = 0; let total = 0;
  for (const i of items) { if (!isLive(i)) continue; total++; if (i.tamam) done++; }
  return { done, total };
}
