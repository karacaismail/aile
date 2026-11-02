import type { BatchConversion } from '../../data/changeSet';

// Ayarlar › Değişiklik kümesi dışa aktarma. Girdi yalnız nesil kimliği, bekleyen sayı ve toBatch() sonucudur; Apps Script
// adresi, uygulama anahtarı ya da başka bir gizli değer bu modüle hiç girmez (BatchRequest.key bilerek yok). Önizleme ve
// indirilen dosya aynı alan sırasını kullanır; dosya ayrıca exported_at taşır. Ağ çağrısı ve Sheets'e yazma yok.

export const CHANGE_SET_EXPORT_KIND = 'aile-change-set-batch';
const ZAMAN_DILIMI = 'Europe/Istanbul';
const NESIL_KISA = 6;

export interface ChangeSetExportInput {
  generationId: string | null;
  pending: number;
  batch: BatchConversion;
  /** Verilirse dosyaya ISO olarak yazılır (indirme anı); önizlemede yok. */
  exportedAt?: Date;
}

/** Dışa aktarma JSON metni (2 boşluk girinti, sonda satır sonu). */
export function changeSetExportText({ generationId, pending, batch, exportedAt }: ChangeSetExportInput): string {
  const payload = {
    schemaVersion: 1,
    kind: CHANGE_SET_EXPORT_KIND,
    generation_id: generationId,
    ...(exportedAt ? { exported_at: exportedAt.toISOString() } : {}),
    pending,
    ops: batch.ops,
    skipped: batch.skipped,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const zamanParcalari = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZAMAN_DILIMI, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** aile-degisiklik-kumesi-<nesil6|nesil-yok>-YYYYMMDD-HHmm.json (İstanbul yerel zamanı). */
export function exportFileName(generationId: string | null, at: Date): string {
  const parts = Object.fromEntries(zamanParcalari.formatToParts(at).map((part) => [part.type, part.value]));
  const nesil = generationId ? generationId.slice(0, NESIL_KISA) : 'nesil-yok';
  return `aile-degisiklik-kumesi-${nesil}-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}.json`;
}

/** Tarayıcı indirmesi: geçici <a download> + Blob URL. WebKit indirmeyi başlatmadan URL bırakılmasın diye gecikmeli. */
const REVOKE_DELAY_MS = 10_000;

export function saveJsonFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
