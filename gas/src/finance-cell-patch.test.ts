import {describe, expect, it, vi} from 'vitest';
import {planCellWrites} from '../finance/cell-writes.mjs';
import {FinanceSheetRepository} from '../finance/sheet-repository.mjs';
import {protectInputs} from '../../finance-sync/protected-inputs.mjs';

type Entered = {numberValue?: number; stringValue?: string; formulaValue?: string; boolValue?: boolean};
const cell = (entered: Entered = {}) => ({userEnteredValue: entered});
const source = (rows: Entered[][]) => ({sheets: [{properties: {sheetId: 7, title: 'Output'}, data: [{startRow: 2, startColumn: 1, rowData: rows.map(r => ({values: r.map(cell)}))}]}]});
const write = (r: number, c: number, height: number, width: number, rows: Entered[][] = []) => ({updateCells: {
  range: {sheetId: 7, startRowIndex: r, endRowIndex: r + height, startColumnIndex: c, endColumnIndex: c + width},
  rows: rows.map(row => ({values: row.map(cell)})), fields: 'userEnteredValue',
}});
const num = (numberValue: number): Entered => ({numberValue});

describe('cell-level finance publication', () => {
  it('writes one changed cell, not an unchanged 2D output or its preceding clear', () => {
    const before = source([[num(1), num(2)], [num(3), num(4)]]);
    const requests = [write(2, 1, 2, 2), write(2, 1, 2, 2, [[num(1), num(2)], [num(3), num(5)]])];
    const snapshot = JSON.stringify({before, requests});
    const plan = planCellWrites(before, requests);
    expect(plan.requests).toEqual([write(3, 2, 1, 1, [[num(5)]])]);
    expect(plan.cells).toEqual({requested: 8, compared: 4, changed: 1});
    expect(JSON.stringify({before, requests})).toBe(snapshot);
  });
  it('preserves implicit clears of omitted rows and columns, including old tail cells', () => {
    const before = source([[num(1), num(2)], [num(3), num(4)], [num(5), num(6)]]);
    const plan = planCellWrites(before, [write(2, 1, 3, 2, [[num(1)]])]);
    expect(plan.requests).toEqual([write(2, 2, 1, 1, [[{}]]), write(3, 1, 2, 2, [[{}, {}], [{}, {}]])]);
    expect(plan.cells.changed).toBe(5);
  });
  it('compares entered formulas, not cached values, and retains zero and false', () => {
    const before = source([[{formulaValue: '=1'}, {}, {}]]);
    const plan = planCellWrites(before, [write(2, 1, 1, 3, [[{formulaValue: '=2'}, num(0), {boolValue: false}]])]);
    expect(plan.cells.changed).toBe(3);
    expect(plan.requests).toEqual([write(2, 1, 1, 3, [[{formulaValue: '=2'}, num(0), {boolValue: false}]])]);
  });
  it('keeps gaps untouched and coalesces consecutive row runs', () => {
    const before = source([[num(1), num(2), num(3)], [num(1), num(2), num(3)]]);
    const plan = planCellWrites(before, [write(2, 1, 2, 3, [[num(4), num(2), num(5)], [num(6), num(2), num(7)]])]);
    expect(plan.requests).toEqual([write(2, 1, 2, 1, [[num(4)], [num(6)]]), write(2, 3, 2, 1, [[num(5)], [num(7)]])]);
    expect(plan.cells.changed).toBe(4);
  });
  it('does not publish the gate formula in the atomic data batch', () => {
    const gate = {sheetId: 7, row: 2, column: 1};
    const plan = planCellWrites(source([[{boolValue: false}, num(1)]]), [write(2, 1, 1, 2, [[{formulaValue: '=TRUE'}, num(2)]])], gate);
    expect(plan.requests).toEqual([write(2, 2, 1, 1, [[num(2)]])]);
  });
  it('grows/unmerges before changed values and restores merges/format afterward', () => {
    const grow = {appendDimension: {sheetId: 7, dimension: 'ROWS', length: 2}};
    const unmerge = {unmergeCells: {range: {sheetId: 7}}};
    const merge = {mergeCells: {range: {sheetId: 7}, mergeType: 'MERGE_ALL'}};
    const format = {copyPaste: {pasteType: 'PASTE_FORMAT', source: {sheetId: 7}, destination: {sheetId: 8}}};
    const values = write(2, 1, 1, 1, [[num(2)]]);
    expect(planCellWrites(source([[num(1)]]), [grow, values, unmerge, merge, format]).requests).toEqual([grow, unmerge, values, merge, format]);
  });
  it('rejects unsupported write masks or structural value operations instead of reordering them', () => {
    const w = write(2, 1, 1, 1, [[num(1)]]);
    expect(() => planCellWrites(source([]), [{updateCells: {...w.updateCells, fields: '*'}}])).toThrow();
    expect(() => planCellWrites(source([]), [{deleteRange: {}}])).toThrow();
    expect(() => planCellWrites(source([]), [{copyPaste: {pasteType: 'PASTE_VALUES'}}])).toThrow();
  });
  it('skips the API and flush entirely when the cell patch is empty', () => {
    const api = {batchUpdate: vi.fn()}, flush = vi.fn();
    const repository = new FinanceSheetRepository({spreadsheets: api, flush, log: () => {}});
    const plan = planCellWrites(source([[num(1)]]), [write(2, 1, 1, 1, [[num(1)]])]);
    repository.apply(plan, {targetId: 'synthetic'});
    expect(api.batchUpdate).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
  it('retains a protected user input between changed cells and sends one atomic batch', () => {
    const before = source([[num(1), num(900), num(3)]]);
    const requests = protectInputs([write(2, 1, 1, 3), write(2, 1, 1, 3, [[num(2), num(0), num(4)]])], [{sheetId: 7, row: 2, column: 2}]);
    const plan = planCellWrites(before, requests);
    expect(plan.requests).toEqual([write(2, 1, 1, 1, [[num(2)]]), write(2, 3, 1, 1, [[num(4)]])]);
    const api = {batchUpdate: vi.fn()}, flush = vi.fn();
    new FinanceSheetRepository({spreadsheets: api, flush, log: () => {}}).apply(plan, {targetId: 'synthetic'});
    expect(api.batchUpdate).toHaveBeenCalledExactlyOnceWith({requests: plan.requests}, 'synthetic');
    expect(flush).toHaveBeenCalledOnce();
  });
  it('matches sequential full writes over overlapping rectangles and is idempotent', () => {
    // Deterministic varied rectangles exercise empty cells, clears and last-write wins.
    let seed = 3;
    const random = (max: number) => { seed = (seed * 16807) % 2147483647; return seed % max; };
    const apply = (initial: Entered[][], requests: ReturnType<typeof write>[]) => {
      const rows = structuredClone(initial);
      for (const {updateCells: u} of requests) for (let r = u.range.startRowIndex; r < u.range.endRowIndex; r++) for (let c = u.range.startColumnIndex; c < u.range.endColumnIndex; c++) {
        rows[r - 2]![c - 1] = u.rows[r - u.range.startRowIndex]?.values[c - u.range.startColumnIndex]?.userEnteredValue ?? {};
      }
      return rows;
    };
    for (let trial = 0; trial < 30; trial++) {
      const initial = Array.from({length: 12}, () => Array.from({length: 8}, () => num(random(20))));
      const requests = Array.from({length: 20}, () => {
        const r = random(12), c = random(8), h = 1 + random(12 - r), w = 1 + random(8 - c);
        return write(r + 2, c + 1, h, w, random(3) ? Array.from({length: h}, () => Array.from({length: w}, () => num(random(20)))) : []);
      });
      const plan = planCellWrites(source(initial), requests);
      const expected = apply(initial, requests);
      expect(apply(initial, plan.requests)).toEqual(expected);
      expect(planCellWrites(source(expected), requests).cells.changed).toBe(0);
    }
  });
});
