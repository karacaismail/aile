import test from 'node:test';
import assert from 'node:assert/strict';
import { bottomNoteRows, currentIssueNote } from './native-finance.mjs';

test('explains Current dates entered for items the budget could not schedule', () => {
  const note = currentIssueNote([{ key: 'item', amount: 2000, planAmount: 2000, kind: 'pending-current-date-override', sourceDate: '2027-02-01' }]);
  assert.match(note, /Güncel tarihi girilen 1 alım bütçe planında yer almadığı için takvime eklenmedi\./);
  assert.match(note, /Ödeme veya borç oluşmuş sayılmıyor\./);
  assert.equal(currentIssueNote([]), '');
});

test('explains unmapped Current edits apart from budget-pending ones', () => {
  const note = currentIssueNote([
    { key: 'orphan', amount: 150, planAmount: 100, kind: 'unmapped-current-override', sourceDate: null },
    { key: 'pending', amount: 51000, planAmount: 50000, kind: 'pending-current-price-override', sourceDate: null },
  ]);
  assert.match(note, /Kaynak eşleşmesi bulunamayan 1 Güncel kayıt hesaba katılmadı\./);
  assert.match(note, /Güncel fiyatı değişen 1 alım bütçe nedeniyle takvime alınamadı/);
});

test('places the reader notes under the cost table, leaving the row layout above unchanged', () => {
  const rows = bottomNoteRows({costsStart: 100, costCount: 3, notes: ['Birinci not', 'İkinci not']});
  assert.deepEqual(rows, [{row: 105, text: 'Notlar'}, {row: 106, text: 'Birinci not'}, {row: 107, text: 'İkinci not'}]);
});
