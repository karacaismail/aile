import {grid} from '../../finance-engine/cells.mjs';

/** Fold clears + writes into final entered values. Never compare calculated caches.
 * Only the finance publisher's value-independent structural operations may move. */
export function planCellWrites(source, requests, gate) {
  const sheets = new Map(), before = [], after = [], patches = [];
  const cells = {requested: 0, compared: 0, changed: 0};
  for (const request of requests) {
    const u = request.updateCells;
    if (!u) {
      if (request.appendDimension || request.unmergeCells ||
          request.updateSheetProperties?.fields === 'gridProperties.frozenRowCount') before.push(request);
      else if (request.mergeCells || request.copyPaste?.pasteType === 'PASTE_FORMAT') after.push(request);
      else throw Error('Unsupported finance patch operation');
      continue;
    }
    const r = u.range;
    if (u.fields !== 'userEnteredValue' || !r ||
        ![r.sheetId, r.startRowIndex, r.endRowIndex, r.startColumnIndex, r.endColumnIndex].every(Number.isInteger)) {
      throw Error('Bounded entered-value writes required');
    }
    if (!sheets.has(r.sheetId)) sheets.set(r.sheetId, new Map());
    const rows = sheets.get(r.sheetId);
    for (let y = r.startRowIndex; y < r.endRowIndex; y++) {
      if (!rows.has(y)) rows.set(y, new Map());
      for (let x = r.startColumnIndex; x < r.endColumnIndex; x++) {
        rows.get(y).set(x, u.rows?.[y - r.startRowIndex]?.values?.[x - r.startColumnIndex]?.userEnteredValue ?? {});
        cells.requested++;
      }
    }
  }
  for (const [sheetId, rows] of sheets) {
    const sheet = source.sheets.find(s => s.properties.sheetId === sheetId);
    if (!sheet) throw Error('Patch source sheet missing');
    const original = grid(source, sheet.properties.title), runs = new Map();
    for (const [y, row] of [...rows].sort(([a], [b]) => a - b)) {
      let run;
      for (const [x, entered] of [...row].sort(([a], [b]) => a - b)) {
        // closeGate/openGate own this cell; an intermediate formula must not publish.
        if (gate?.sheetId === sheetId && gate.row === y && gate.column === x) continue;
        cells.compared++;
        if (JSON.stringify(original[y]?.[x]?.userEnteredValue ?? {}) === JSON.stringify(entered)) continue;
        cells.changed++;
        if (!run || run.end !== x) {
          run = {start: x, end: x, values: []};
          if (!runs.has(y)) runs.set(y, []);
          runs.get(y).push(run);
        }
        run.values.push({userEnteredValue: entered}); run.end++;
      }
    }
    const previous = new Map();
    for (const [y, rowRuns] of runs) for (const run of rowRuns) {
      const key = run.start + ':' + run.end, prior = previous.get(key);
      if (prior?.range.endRowIndex === y && prior.rows.length * run.values.length < 500) {
        prior.range.endRowIndex++; prior.rows.push({values: run.values});
      } else {
        const updateCells = {range: {sheetId, startRowIndex: y, endRowIndex: y + 1,
          startColumnIndex: run.start, endColumnIndex: run.end}, rows: [{values: run.values}], fields: 'userEnteredValue'};
        patches.push({updateCells}); previous.set(key, updateCells);
      }
    }
  }
  return {requests: [...before, ...patches, ...after], cells};
}
