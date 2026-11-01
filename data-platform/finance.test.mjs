import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financeCollections } from './finance.mjs';
import { stableId } from './core.mjs';

const { outputFiles } = await build({ stdin: { contents: "export { syntheticFinance, syntheticFinanceWire } from './src/finance/fixtures.ts'", resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { syntheticFinance, syntheticFinanceWire } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const tenant = stableId('tenant', 'synthetic');
function native(source = syntheticFinance()) {
 const wire = syntheticFinanceWire(source);
 const table = { source_key: 'budget', source_id: stableId(tenant,'source','budget'), properties: { title: '_Finans web', sheetId: 1 }, rows: new Map([wire.labels,...wire.rows].map((row,r)=>[r,new Map(row.map((v,c)=>[c,{ effectiveValue:{stringValue:v} }]))])) };
 return { sheets:[table] };
}
test('exports verified forecasts once with stable source IDs, decimal money and no payment claim', async()=>{
 const source=syntheticFinance(), first=await financeCollections(native(source),tenant), repeated=await financeCollections(native(source),tenant);
 assert.deepEqual(first,repeated);
 const events=first.get('forecast_events').map(e=>e.record);
 assert.equal(events.length,source.daily.rows.length);
 assert.equal(events[0].record_basis,'forecast');
 assert.equal(events[0].cash_change.amount,String(source.daily.rows[0][3]));
 assert.equal(events[0].source_record_id,source.daily.rows[0][17]);
 assert.equal(first.has('payments'),false);
 assert.equal(first.get('forecast_months').length,source.monthly.rows.length);
});
test('does not normalize a corrupt or internally inconsistent finance ledger',async()=>{
 const n=native(); const row=[...n.sheets[0].rows.values()].find(r=>r.get(0).effectiveValue.stringValue==='daily');
 row.get(5).effectiveValue.stringValue='n:0.01';
 await assert.rejects(financeCollections(n,tenant),/özet|hash|içerik/);
 const bad=syntheticFinance();bad.daily.rows[0][13]=12345;
 await assert.rejects(financeCollections(native(bad),tenant),/mutabakat/);
});
test('absence of a forecast source does not create financial facts',async()=>{
 assert.equal((await financeCollections({sheets:[]},tenant)).size,0);
});
