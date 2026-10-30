import {measurePhase} from './timing.mjs';

const column = index => {
  let result = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
};

/** Native Sheet reads and writes; calculation and publication policy stay outside. */
export class FinanceSheetRepository {
  constructor({spreadsheets, flush, clock = Date.now, log = entry => console.log(JSON.stringify(entry))}) {
    this.spreadsheets = spreadsheets;
    this.flush = flush;
    this.clock = clock;
    this.log = log;
  }

  capture(state) {
    return measurePhase('capture', () => {
      this.log({phase: 'capture-start'});
      const bounds = new Map(Object.entries(state.config.readBounds).map(([title, [rows, cols]]) => [title, {rows, cols}]));
      for (const owner of [state.prior, state.pending?.prior]) {
        for (const r of owner?.ranges ?? []) {
          const b = bounds.get(r.title) ?? {rows: 0, cols: 0};
          b.rows = Math.max(b.rows, r.endRow);
          b.cols = Math.max(b.cols, r.endColumn);
          bounds.set(r.title, b);
        }
      }
      const metadata = this.spreadsheets.get(state.targetId, {fields: 'spreadsheetId,properties(locale,timeZone),sheets(properties)'});
      // Observe allocated tails too: added user rows/columns are never assumed empty.
      const ranges = [...bounds].map(([title, b]) => {
        const sheet = metadata.sheets.find(s => s.properties.title === title);
        if (!sheet) throw Error('Kaynak sekme eksik: ' + title);
        const g = sheet.properties.gridProperties;
        if (!g) throw Error('Kaynak sekme ızgarası eksik: ' + title);
        return `'${title.replaceAll("'", "''")}'!A1:${column(g.columnCount)}${title === '_Kasa hesap' ? Math.max(1, b.rows) : g.rowCount}`;
      });
      const source = {spreadsheetId: metadata.spreadsheetId, properties: metadata.properties, sheets: []};
      // Bounded JSON groups keep response memory and per-minute read quotas manageable.
      const groupSize=this.spreadsheets.maxRangesPerRequest??1;
      for (let index=0;index<ranges.length;index+=groupSize) {
        const part = this.spreadsheets.get(state.targetId, {
          ranges: ranges.slice(index,index+groupSize), includeGridData: true,
          fields: 'sheets(properties,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue))))',
        });
        source.sheets.push(...part.sheets);
        this.log({phase: 'capture-part', sheets: source.sheets.length});
      }
      return {...source, targetId: source.spreadsheetId};
    }, this.clock, this.log);
  }

  gate(state, entered) {
    const control = state.prior.financeSheets.find(s => s.title === '_Finans kontrol');
    if (!control) throw Error('Finans kontrol sekmesi tanımsız.');
    this.spreadsheets.batchUpdate({requests: [{updateCells: {
      range: {sheetId: control.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2},
      rows: [{values: [{userEnteredValue: entered}]}], fields: 'userEnteredValue',
    }}]}, state.targetId);
    this.flush();
  }

  apply(candidate, state) {
    return measurePhase('apply', () => {
      this.spreadsheets.batchUpdate({requests: candidate.requests}, state.targetId);
      this.flush();
    }, this.clock, this.log);
  }
}
