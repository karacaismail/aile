import type { RecordRow } from '../../shell/contracts';
import { paraEkle, type ParaToplami } from './para';
import { BILINMIYOR } from './workflow';

// Pivot (oda × durum): her hücrede plan ve gerçek AYRI toplanır, kayıt sayısı tutulur; satır ve sütun toplamı her
// ölçü için ayrı hesaplanır. Telefon sunumu (PivotStack) ve geniş tablo (AlimlarPivot.wide) aynı hesabı kullanır. Saf.

export interface PivotHucre { plan: ParaToplami; gercek: ParaToplami; kayit: number }
export interface PivotSatiri { key: string; oda: string; hucreler: Map<string, PivotHucre>; toplam: PivotHucre; toplamSatiri?: boolean }
export interface Pivot { sutunlar: string[]; satirlar: PivotSatiri[] }

const bosHucre = (): PivotHucre => ({ plan: new Map(), gercek: new Map(), kayit: 0 });
function hucreEkle(cell: PivotHucre, row: RecordRow) {
  cell.kayit += 1;
  paraEkle(cell.plan, row.planned);
  paraEkle(cell.gercek, row.actual);
}

const collator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });
/** "Bilinmiyor" her zaman sonda; diğerleri tr-TR sırasıyla. */
export const bilinmeyenSonda = (a: string, b: string) => (a === BILINMIYOR ? 1 : b === BILINMIYOR ? -1 : collator.compare(a, b));

export function pivotHesapla(rows: readonly RecordRow[]): Pivot {
  const sutunlar: string[] = [];
  const odalar = new Map<string, PivotSatiri>();
  const genel: PivotSatiri = { key: '__toplam', oda: 'Toplam', hucreler: new Map(), toplam: bosHucre(), toplamSatiri: true };
  for (const row of rows) {
    const oda = row.room ?? BILINMIYOR;
    const durum = row.status.label || BILINMIYOR;
    if (!sutunlar.includes(durum)) sutunlar.push(durum);
    let satir = odalar.get(oda);
    if (!satir) {
      satir = { key: oda, oda, hucreler: new Map(), toplam: bosHucre() };
      odalar.set(oda, satir);
    }
    for (const target of [satir, genel]) {
      let cell = target.hucreler.get(durum);
      if (!cell) {
        cell = bosHucre();
        target.hucreler.set(durum, cell);
      }
      hucreEkle(cell, row);
      hucreEkle(target.toplam, row);
    }
  }
  sutunlar.sort((a, b) => (a === BILINMIYOR ? 1 : b === BILINMIYOR ? -1 : 0));
  const satirlar = [...odalar.values()].sort((a, b) => bilinmeyenSonda(a.oda, b.oda));
  return { sutunlar, satirlar: rows.length ? [...satirlar, genel] : [] };
}

const tryOnly = (total: ParaToplami): number | null => {
  const minor = total.get('TRY');
  return minor === undefined ? null : minor / 100;
};

/** PivotStack satırları (telefon): yalnız TRY tutarları; toplam satırı PivotStack kendisi hesaplar. */
export function pivotYiginSatirlari(pivot: Pivot): [string, [number | null, number | null][]][] {
  return pivot.satirlar
    .filter(row => !row.toplamSatiri)
    .map(row => [row.oda, pivot.sutunlar.map(durum => {
      const cell = row.hucreler.get(durum);
      return [cell ? tryOnly(cell.plan) : null, cell ? tryOnly(cell.gercek) : null];
    })]);
}

/** Satırlarda TRY dışında para birimi var mı (telefon özeti yalnız TRY gösterir; not yazılır). */
export const baskaParaVar = (rows: readonly RecordRow[]) =>
  rows.some(row => (row.planned && row.planned.currency !== 'TRY') || (row.actual && row.actual.currency !== 'TRY'));
