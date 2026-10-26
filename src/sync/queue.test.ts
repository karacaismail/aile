import { describe, it, expect, vi } from 'vitest';
import { coalesce, flushOutbox, backoffMs, type QueuedOp } from './queue';
import { ApiError } from './api';
import type { BatchRequest, BatchResponse } from '@shared/api';

const q = (id: string, patch: Record<string, unknown>, opId = `op-${id}-${JSON.stringify(patch).length}`): QueuedOp => ({
  op: { op: 'upsert', table: 'kalemler', id, opId, patch }, ts: '2026-10-26T10:00:00Z', attempts: 0,
});

describe('coalesce', () => {
  it('aynı kaydın ardışık patch\'lerini birleştirir', () => {
    const out = coalesce([q('A', { adet: 1 }), q('A', { not: 'x' }), q('B', { adet: 2 })]);
    expect(out).toHaveLength(2);
    expect(out[0].op).toMatchObject({ id: 'A', patch: { adet: 1, not: 'x' } });
  });
});

describe('flushOutbox', () => {
  it('başarılı batch: sonuçlar bildirilir, kuyruk boşalır', async () => {
    const send = vi.fn(async (req: BatchRequest): Promise<BatchResponse> => ({
      ok: true, doneCount: req.ops.length, fingerprint: 'f', serverTime: 't',
      results: req.ops.map((o) => ({ ok: true, id: o.id, row: { id: o.id, version: 1 } })),
    }));
    const onResult = vi.fn();
    const out = await flushOutbox([q('A', { adet: 1 }), q('B', { adet: 2 })], { send, actor: 'a', onResult, onDrop: vi.fn() });
    expect(out.remaining).toEqual([]);
    expect(out.sent).toBe(2);
    expect(onResult).toHaveBeenCalledTimes(2);
  });
  it('kalıcı hata (not_found) işlemi düşürür, sonrakiler devam eder', async () => {
    let call = 0;
    const send = vi.fn(async (req: BatchRequest): Promise<BatchResponse> => {
      call++;
      if (call === 1) return { ok: false, doneCount: 1, fingerprint: 'f', serverTime: 't', error: 'not_found', results: [{ ok: true, id: req.ops[0].id, row: { id: req.ops[0].id } }, { ok: false, id: req.ops[1].id, error: 'not_found' }] };
      return { ok: true, doneCount: req.ops.length, fingerprint: 'f', serverTime: 't', results: req.ops.map((o) => ({ ok: true, id: o.id, row: { id: o.id } })) };
    });
    const onDrop = vi.fn();
    const out = await flushOutbox([q('A', { adet: 1 }), q('B', { adet: 2 }), q('C', { adet: 3 })], { send, actor: 'a', onResult: vi.fn(), onDrop });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0][0]).toMatchObject({ id: 'B' });
    expect(out.remaining).toEqual([]);
    expect(out.sent).toBe(2);
  });
  it('ağ hatası: kuyruk korunur, attempts artar', async () => {
    const send = vi.fn(async () => { throw new ApiError('network', 'x', true); });
    const out = await flushOutbox([q('A', { adet: 1 })], { send, actor: 'a', onResult: vi.fn(), onDrop: vi.fn() });
    expect(out.remaining).toHaveLength(1);
    expect(out.remaining[0].attempts).toBe(1);
    expect(out.error?.code).toBe('network');
  });
  it('busy: doneCount\'tan devam etmek üzere kalanlar korunur', async () => {
    const send = vi.fn(async (req: BatchRequest): Promise<BatchResponse> => ({
      ok: false, doneCount: 1, fingerprint: 'f', serverTime: 't', error: 'busy',
      results: [{ ok: true, id: req.ops[0].id, row: { id: req.ops[0].id } }, { ok: false, id: req.ops[1].id, error: 'busy' }],
    }));
    const out = await flushOutbox([q('A', { adet: 1 }), q('B', { adet: 2 })], { send, actor: 'a', onResult: vi.fn(), onDrop: vi.fn() });
    expect(out.sent).toBe(1);
    expect(out.remaining.map((x) => x.op.id)).toEqual(['B']);
  });
  it('backoff üstel ve 60 sn ile sınırlı', () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(10)).toBe(60000);
  });
});
