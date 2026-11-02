// Değişiklik kümesi dışa aktarma: saf JSON üretimi, dosya adı (İstanbul saati) ve tarayıcı indirmesi. Gizli değer
// (Apps Script adresi, uygulama anahtarı) bu modüle hiç girmez: girdi yalnız nesil kimliği, sayı ve batch'tir.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchConversion } from '../../data/changeSet';
import { CHANGE_SET_EXPORT_KIND, changeSetExportText, exportFileName, saveJsonFile } from './disaAktar';

const GEN = 'd062d4882617b40bffe4d2b0b603125a949c8795992611af1be08f6ef6b7ed10';
const BATCH: BatchConversion = {
  ops: [{ op: 'upsert', table: 'kalemler', id: 'kalem-027', opId: 'OP001', patch: { not: 'Sentetik not' } }],
  skipped: [{ opId: 'OP002', recordId: 'r-2', reason: 'Kaynak sütunu yok: payment' }],
};

describe('changeSetExportText', () => {
  it('önizleme: alan sırası sabit, exported_at yok, sonda satır sonu', () => {
    const text = changeSetExportText({ generationId: GEN, pending: 2, batch: BATCH });
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['schemaVersion', 'kind', 'generation_id', 'pending', 'ops', 'skipped']);
    expect(parsed).toMatchObject({ schemaVersion: 1, kind: CHANGE_SET_EXPORT_KIND, generation_id: GEN, pending: 2 });
    expect(parsed.ops).toEqual(BATCH.ops);
    expect(parsed.skipped).toEqual(BATCH.skipped);
  });

  it('dosya: exported_at ISO olarak nesil kimliğinden sonra gelir; nesil yoksa null', () => {
    const parsed = JSON.parse(changeSetExportText({ generationId: null, pending: 0, batch: { ops: [], skipped: [] }, exportedAt: new Date('2026-10-28T21:30:00.000Z') })) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['schemaVersion', 'kind', 'generation_id', 'exported_at', 'pending', 'ops', 'skipped']);
    expect(parsed.generation_id).toBeNull();
    expect(parsed.exported_at).toBe('2026-10-28T21:30:00.000Z');
  });
});

describe('exportFileName', () => {
  it('nesil kısaltması + İstanbul yerel tarih/saat (gün dönümü dahil)', () => {
    expect(exportFileName(GEN, new Date('2026-10-28T21:30:00.000Z'))).toBe('aile-degisiklik-kumesi-d062d4-20261029-0030.json');
    expect(exportFileName(GEN, new Date('2026-03-05T06:07:00.000Z'))).toBe('aile-degisiklik-kumesi-d062d4-20260305-0907.json');
  });

  it('nesil yoksa adıyla: "nesil-yok"', () => {
    expect(exportFileName(null, new Date('2026-10-28T09:00:00.000Z'))).toBe('aile-degisiklik-kumesi-nesil-yok-20261028-1200.json');
  });
});

describe('saveJsonFile', () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('JSON Blob için geçici bağlantı oluşturur, tıklar, DOM\'dan kaldırır ve URL\'yi sonra bırakır', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:sentetik'; });
    URL.revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });

    saveJsonFile('aile-degisiklik-kumesi-x.json', '{"a":1}\n');

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('aile-degisiklik-kumesi-x.json');
    expect(clicked[0].getAttribute('href')).toBe('blob:sentetik');
    expect(clicked[0].isConnected).toBe(false);
    expect(blobs[0].type).toBe('application/json;charset=utf-8');
    expect(await blobs[0].text()).toBe('{"a":1}\n');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sentetik');
  });
});
