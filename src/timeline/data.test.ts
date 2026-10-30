import { describe, expect, it } from 'vitest';
import { buildTimeline } from './data';
import { syntheticTimeline } from './fixtures';

describe('Timeline Sheet contract', () => {
  it('validates the ledger, preserves negative cash and returns every step balance', () => {
    const data = buildTimeline(syntheticTimeline());
    expect(data.events).toHaveLength(8);
    expect(data.events[2]).toMatchObject({ cash: 1000, denizDebt: 500, totalDebt: 500 });
    expect(data.events[5].cash).toBe(-100);
    expect(data.months).toEqual(['2098-11', '2098-12']);
  });
  it.each([['missing amount', 2, 6, null], ['formula error', 2, 9, '#REF!'], ['wrong running cash', 2, 9, 1200], ['wrong debt total', 2, 12, 501], ['control mismatch', 4, 15, 1], ['invalid date', 2, 1, '2098-11-31'], ['wrong period', 2, 16, '2099-11']] as const)('rejects %s', (_, r, c, value) => {
    const table = syntheticTimeline(); table.rows[r][c] = value;
    expect(() => buildTimeline(table)).toThrow();
  });
  it('rejects duplicate IDs, reordered steps and a missing month-end reconciliation', () => {
    const duplicate = syntheticTimeline(); duplicate.rows[2][0] = 'income';
    expect(() => buildTimeline(duplicate)).toThrow();
    const reordered = syntheticTimeline(); [reordered.rows[2], reordered.rows[3]] = [reordered.rows[3], reordered.rows[2]];
    expect(() => buildTimeline(reordered)).toThrow();
    const missing = syntheticTimeline(); missing.rows.pop();
    expect(() => buildTimeline(missing)).toThrow();
  });
  it('requires exact headers and an explicit initial balance rather than inventing zeros', () => {
    const headers = syntheticTimeline(); headers.labels[9] = 'Other';
    expect(() => buildTimeline(headers)).toThrow();
    const opening = syntheticTimeline(); opening.rows.shift();
    expect(() => buildTimeline(opening)).toThrow();
  });
  it('rejects a missing month even when surrounding balances happen to match', () => {
    const table = syntheticTimeline();
    table.rows.slice(5).forEach(row => { row[1] = String(row[1]).replace('2098-12', '2099-01'); row[16] = '2099-01'; });
    expect(() => buildTimeline(table)).toThrow();
  });
  it.each([['running cash', 2, 9], ['card total', 2, 12], ['reconciliation', 4, 15]] as const)('rejects a one-kurus %s discrepancy', (_, row, column) => {
    const table = syntheticTimeline();
    table.rows[row][column] = Number(table.rows[row][column]) + .01;
    expect(() => buildTimeline(table)).toThrow();
  });
  it('allows floating-point noise below a kurus without accepting monetary discrepancies', () => {
    const table = syntheticTimeline();
    table.rows[2][9] = Number(table.rows[2][9]) + 1e-9;
    expect(buildTimeline(table).events).toHaveLength(8);
  });
});
