import { expect, it } from 'vitest';
import type { BatchRequest, UpsertOp } from '../../shared/api';
import { ITEM_COLUMNS, ITEM_HEADERS, SETTING_COLUMNS, SETTING_HEADERS } from '../../shared/schema';
import { applyBatch, createTableState, stateFingerprint, type State } from './core';

const NOW = '2099-01-01T00:00:00.000Z';
const LATER = '2099-01-01T00:01:00.000Z';
const strict = (precondition: unknown = { version: 1, fields: { ad: 'Sentetik kalem', kategori: 'kopek', deleted_at: null } }): UpsertOp => ({ op: 'upsert', table: 'kalemler', id: 'SYNTH-A', opId: 'strict-category', baseVersion: 1, patch: { kategori: 'banyo_wc' }, precondition } as unknown as UpsertOp);
const request = (op: UpsertOp): BatchRequest => ({ action: 'batch', actor: 'test', ops: [op] });
function seeded() {
  const state: State = { kalemler: createTableState(ITEM_COLUMNS, [...ITEM_HEADERS], []), ayarlar: createTableState(SETTING_COLUMNS, [...SETTING_HEADERS], []) };
  applyBatch(state, request({ op: 'upsert', table: 'kalemler', id: 'SYNTH-A', opId: 'seed', patch: { tip: 'satinalma', ad: 'Sentetik kalem', kategori: 'kopek', not: 'Korunacak not' } }), NOW);
  state.kalemler.dirty.clear();
  return state;
}
const capture = (state: State) => ({ rows: structuredClone(state.kalemler.rows), dirty: [...state.kalemler.dirty], index: [...state.kalemler.index], sheetRows: [...state.kalemler.sheetRows], fingerprint: stateFingerprint(state) });

it('atomically rejects stale migration after category then unrelated field updates and changes no fields or metadata', () => {
  const state = seeded(); // A fresh client read agrees with version1/categorykopek here.
  applyBatch(state, request({ op: 'upsert', table: 'kalemler', id: 'SYNTH-A', opId: 'remote-category', patch: { kategori: 'mutfak' } }), LATER);
  applyBatch(state, request({ op: 'upsert', table: 'kalemler', id: 'SYNTH-A', opId: 'remote-note', patch: { not: 'Yeni uzak not' } }), LATER);
  state.kalemler.dirty.clear();
  const before = capture(state);
  const result = applyBatch(state, request(strict()), LATER);
  expect(result.ok).toBe(false);
  expect(result.results[0].error).toBe('precondition_failed');
  expect(result.doneCount).toBe(0);
  expect(capture(state)).toEqual(before);
});

it('retains ordinary non-strict merge behavior for existing clients', () => {
  const state = seeded();
  applyBatch(state, request({ op: 'upsert', table: 'kalemler', id: 'SYNTH-A', opId: 'remote-note', patch: { not: 'Yeni uzak not' } }), LATER);
  const { precondition: _precondition, ...op } = strict() as UpsertOp & { precondition: unknown };
  const result = applyBatch(state, request(op), LATER);
  expect(result.ok).toBe(true);
  expect(result.results[0].row).toMatchObject({ kategori: 'banyo_wc', not: 'Yeni uzak not', version: 3 });
});

it('applies matching strict conditions, then treats an identical replay as a no-write duplicate', () => {
  const state = seeded();
  expect(applyBatch(state, request(strict()), LATER).results[0].row).toMatchObject({ kategori: 'banyo_wc', version: 2 });
  state.kalemler.dirty.clear();
  const before = capture(state);
  const replay = applyBatch(state, request(strict()), LATER);
  expect(replay.results[0].duplicate).toBe(true);
  expect(capture(state)).toEqual(before);
});

it.each([
  { ad: 'Başka ad' }, { kategori: 'mutfak' }, { deleted_at: LATER }, { version: 2 },
])('rejects direct field changes even when category alone would still be writable: %j', change => {
  const state = seeded();
  Object.assign(state.kalemler.rows[0], change); // Simulates a direct Sheet edit with/without updated version.
  const before = capture(state);
  expect(applyBatch(state, request(strict()), LATER).results[0].error).toBe('precondition_failed');
  expect(capture(state)).toEqual(before);
});

it('does not insert a missing target and does not execute later ops after a failed strict condition', () => {
  const state = seeded();
  const before = capture(state);
  const missing = { ...strict(), id: 'MISSING', patch: { tip: 'satinalma', ad: 'Do not insert', kategori: 'banyo_wc' } };
  const result = applyBatch(state, { ...request(missing), ops: [missing, { op: 'upsert', table: 'kalemler', id: 'SECOND', opId: 'second', patch: { tip: 'satinalma', ad: 'Do not run' } }] }, LATER);
  expect(result.results).toHaveLength(1);
  expect(result.results[0].error).toBe('precondition_failed');
  expect(capture(state)).toEqual(before);
});

it.each([
  null, {}, [], { version: '1', fields: { ad: 'Sentetik kalem' } }, { version: -1, fields: { ad: 'Sentetik kalem' } },
  { version: 1.5, fields: { ad: 'Sentetik kalem' } }, { version: 1, fields: null }, { version: 1, fields: [] },
  { version: 1, fields: {} }, { version: 1, fields: { unknown: 'x' } }, { version: 1, fields: { kategori: {} } },
  { version: 1, fields: { ad: 123 } }, { version: 1, fields: { gercek_tl: '123' } },
  { version: 1, fields: { ad: 'Sentetik kalem' }, unexpected: true },
])('rejects malformed strict conditions without any mutation: %j', precondition => {
  const state = seeded();
  const before = capture(state);
  expect(applyBatch(state, request(strict(precondition)), LATER).results[0].error).toBe('bad_request');
  expect(capture(state)).toEqual(before);
});

it('validates a malformed precondition even on a previously completed operation id', () => {
  const state = seeded();
  applyBatch(state, request(strict()), LATER);
  state.kalemler.dirty.clear();
  const before = capture(state);
  expect(applyBatch(state, request(strict({ version: '1', fields: {} })), LATER).results[0].error).toBe('bad_request');
  expect(capture(state)).toEqual(before);
});

it('compares stored nullable, boolean, numeric and list fields without coercing them', () => {
  const state = seeded();
  Object.assign(state.kalemler.rows[0], { mevcut: false, gercek_tl: 0, kim: ['E', 'K'] });
  const fields = { ad: 'Sentetik kalem', deleted_at: null, mevcut: false, gercek_tl: 0, kim: ['E', 'K'] };
  expect(applyBatch(state, request(strict({ version: 1, fields: { ...fields, kim: ['K', 'E'] } })), LATER).results[0].error).toBe('precondition_failed');
  expect(applyBatch(state, request(strict({ version: 1, fields })), LATER).ok).toBe(true);
});

it('advertises conditional upsert support in full and unchanged reads without a schema-version bump', async () => {
  const { readState } = await import('./core');
  const state = seeded();
  const full = readState(state, undefined, NOW);
  expect(full.schemaVersion).toBe(2);
  expect(full).toHaveProperty('capabilities', ['conditional_upsert']);
  expect(readState(state, full.fingerprint, NOW)).toMatchObject({ notModified: true, capabilities: ['conditional_upsert'] });
});
