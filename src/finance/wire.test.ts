import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFinance } from './data';
import { syntheticFinance, syntheticFinanceWire } from './fixtures';
import { decodeFinanceWire, readFinanceWireMetadata } from './wire';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const day = (wire: ReturnType<typeof syntheticFinanceWire>) => wire.rows.find(row => row[0] === 'daily')!;

describe('content-bound typed finance transport', () => {
  it('round-trips original values and source headings, including Unicode and escaped text', async () => {
    const source = syntheticFinance();
    source.daily.rows[0][1] = 'İşbank: "ödeme"\nGül \\ İsmail';
    source.daily.rows[0][3] = -0;
    const decoded = await decodeFinanceWire(syntheticFinanceWire(source));
    expect(decoded.source).toEqual({ ...source, daily: { ...source.daily, rows: source.daily.rows.map((r, i) => i ? r : r.map((v, j) => j === 3 ? 0 : v)) } });
    expect(buildFinance(decoded.source).events[0].title).toBe(source.daily.rows[0][1]);
  });

  it('decodes native fixed-decimal tokens without rounding sub-cent values or formatted currency', async () => {
    const source = syntheticFinance();
    source.daily.rows[0][3] = 1.234567891;
    const wire = syntheticFinanceWire(source);
    wire.rows = wire.rows.map(row => row.map(token => token.startsWith('n:') ? `n:${Number(token.slice(2)).toFixed(9)}` : token));
    const decoded = await decodeFinanceWire(wire);
    expect(decoded.source).toEqual(source);
    expect(decoded.source.daily.rows[0][3]).toBe(1.234567891);
  });

  it.each([
    ['one cent', (wire: ReturnType<typeof syntheticFinanceWire>) => { day(wire)[5] = 'n:0.01'; }],
    ['one tenth of a cent', (wire: ReturnType<typeof syntheticFinanceWire>) => { day(wire)[5] = 'n:0.001'; }],
    ['date', (wire: ReturnType<typeof syntheticFinanceWire>) => { day(wire)[2] = 's:2098-01-02'; }],
    ['note', (wire: ReturnType<typeof syntheticFinanceWire>) => { day(wire)[18] = 's:Different source'; }],
    ['title', (wire: ReturnType<typeof syntheticFinanceWire>) => { day(wire)[3] = 's:Different title'; }],
    ['source epoch', (wire: ReturnType<typeof syntheticFinanceWire>) => { wire.rows[7][2] = `s:${'b'.repeat(64)}`; }],
    ['scope', (wire: ReturnType<typeof syntheticFinanceWire>) => { wire.rows[9][2] = 's:Different conditions'; }],
  ])('rejects changed %s even when the old digest accompanies the body', async (_, change) => {
    const wire = syntheticFinanceWire(); change(wire);
    await expect(decodeFinanceWire(wire)).rejects.toThrow(/içerik|özet|hash/i);
  });

  it('rejects an old internally consistent body tagged as a new source generation', async () => {
    const old = syntheticFinance(), next = syntheticFinance();
    next.metadata.rows[6][0] = 'b'.repeat(64);
    next.daily.rows.forEach(row => { row[1] = `Yeni ${row[1]}`; });
    const oldWire = syntheticFinanceWire(old), nextWire = syntheticFinanceWire(next);
    oldWire.rows.splice(0, 10, ...nextWire.rows.slice(0, 10));
    await expect(decodeFinanceWire(oldWire)).rejects.toThrow(/içerik|özet|hash/i);
  });

  it.each(['z:', '', null, 0, 'n:', 'n:NaN', 'n:Infinity', 'n:1.234,50', 'n:0x10'])('rejects unknown or wrongly typed amount %s without coercion', async value => {
    const wire = syntheticFinanceWire();
    (day(wire) as unknown[])[5] = value;
    await expect(decodeFinanceWire(wire)).rejects.toThrow();
  });

  it.each(['missing', 'extra', 'duplicate', 'reordered', 'count'] as const)('rejects %s rows', async change => {
    const wire = syntheticFinanceWire();
    if (change === 'missing') wire.rows.pop();
    if (change === 'extra') wire.rows.push([...wire.rows.at(-1)!]);
    if (change === 'duplicate') wire.rows[wire.rows.length - 1] = [...wire.rows[wire.rows.length - 2]];
    if (change === 'reordered') wire.rows.splice(-2, 2, wire.rows.at(-1)!, wire.rows.at(-2)!);
    if (change === 'count') wire.rows[4][2] = 's:3';
    await expect(decodeFinanceWire(wire)).rejects.toThrow();
  });

  it('does not let a correctly hashed broken ledger bypass the finance validator', async () => {
    const source = syntheticFinance(); source.daily.rows[0][13] = 512.001;
    const decoded = await decodeFinanceWire(syntheticFinanceWire(source));
    expect(() => buildFinance(decoded.source)).toThrow(/mutabakat/);
  });

  it('fails explicitly when secure hashing is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    await expect(decodeFinanceWire(syntheticFinanceWire())).rejects.toThrow(/SHA-256|güvenli/i);
  });

  it('rejects stale metadata before deliberately blank native values', () => {
    const source = syntheticFinance(); source.metadata.rows[2][0] = 'FALSE';
    expect(() => readFinanceWireMetadata(syntheticFinanceWire(source), false)).toThrow(/kaynak.*değiş|yenilenmeli/i);
  });
});
