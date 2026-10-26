// Çevrimdışı kuyruk (outbox): sıralı, idempotent (opId), ilk hatada durup doneCount'tan devam eder.
import type { Op, BatchRequest, BatchResponse, OpResult } from '@shared/api';
import { ApiError } from './api';

export interface QueuedOp { op: Op; ts: string; attempts: number }

export const MAX_OUTBOX = 200;
export const BATCH_SIZE = 50;

export interface FlushDeps {
  send: (req: BatchRequest) => Promise<BatchResponse>;
  actor: string;
  key?: string;
  onResult: (op: Op, result: OpResult) => void;
  onDrop: (op: Op, error: ApiError) => void;
}

export interface FlushOutcome { sent: number; remaining: QueuedOp[]; error?: ApiError }

/** Aynı kayıt için ardışık upsert patch'lerini birleştirir (son opId kullanılır). */
export function coalesce(ops: QueuedOp[]): QueuedOp[] {
  const out: QueuedOp[] = [];
  for (const q of ops) {
    const prev = out[out.length - 1];
    if (prev && prev.op.op === 'upsert' && q.op.op === 'upsert' && prev.op.table === q.op.table && prev.op.id === q.op.id) {
      prev.op = { ...q.op, patch: { ...prev.op.patch, ...q.op.patch }, baseVersion: prev.op.baseVersion ?? q.op.baseVersion };
      prev.ts = q.ts;
      continue;
    }
    out.push({ ...q, op: { ...q.op } });
  }
  return out;
}

export async function flushOutbox(queue: QueuedOp[], deps: FlushDeps): Promise<FlushOutcome> {
  let remaining = coalesce(queue);
  let sent = 0;
  while (remaining.length) {
    const chunk = remaining.slice(0, BATCH_SIZE);
    let res: BatchResponse;
    try {
      res = await deps.send({ action: 'batch', actor: deps.actor, key: deps.key, ops: chunk.map((q) => q.op) });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('network', String(e), true);
      if (err.retryable || err.code === 'config') {
        return { sent, remaining: remaining.map((q) => ({ ...q, attempts: q.attempts + 1 })), error: err };
      }
      // Kalıcı hata (ör. şema): kuyruğu koru ama dışarı bildir
      return { sent, remaining, error: err };
    }
    res.results.forEach((r, i) => { if (r.ok) deps.onResult(chunk[i].op, r); });
    sent += res.doneCount;
    remaining = remaining.slice(res.doneCount);
    if (!res.ok) {
      const failed = remaining[0];
      const failedResult = res.results[res.doneCount];
      if (failed && failedResult && !failedResult.ok) {
        const code = failedResult.error ?? 'internal';
        if (code === 'busy' || code === 'internal') {
          return { sent, remaining: remaining.map((q) => ({ ...q, attempts: q.attempts + 1 })), error: new ApiError(code, failedResult.message ?? code, true) };
        }
        // not_found / invalid_enum / bad_request: bu işlem düşürülür, diğerleri devam eder
        deps.onDrop(failed.op, new ApiError(code, failedResult.message ?? code, false, { ...failedResult }));
        remaining = remaining.slice(1);
        continue;
      }
      return { sent, remaining, error: new ApiError(res.error ?? 'internal', res.message ?? 'bilinmeyen', true) };
    }
  }
  return { sent, remaining: [] };
}

export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}
