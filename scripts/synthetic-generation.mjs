// Sentetik nesil üreticisi. data-platform sözleşmesine (partition zarfı, manifest, UUIDv5 kimlik, ondalık dizge
// para) birebir uyan, hiçbir gerçek aile verisi içermeyen bir nesil üretir ve fixtures/generation-synthetic/
// altına yazar. Deterministiktir: aynı seed aynı içeriği ve aynı generation_id'yi verir.
//
//   node scripts/synthetic-generation.mjs            → fixtures/generation-synthetic/<sha256>/
//   node scripts/synthetic-generation.mjs <klasör>   → <klasör>/<sha256>/
//
// Sözlükler (vocabularies/terms/workflows/view_definitions/task_templates) gerçek sözlük dosyalarından gelir;
// bunlar gizli değildir. Kayıt etiketleri "Örnek …" ile başlar; tutarlar yuvarlak sentetik sayılardır.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256, stableId } from '../data-platform/core.mjs';
import { createTaxonomy } from '../data-platform/taxonomy.mjs';
import { validateGeneration } from '../data-platform/validate.mjs';

export const SYNTHETIC_TENANT_KEY = 'aile-synthetic-fixture';
const SEED = 20261101;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dataPlatform = path.join(repoRoot, 'data-platform');
export const DEFAULT_OUTPUT = path.join(repoRoot, 'fixtures', 'generation-synthetic');

/** mulberry32: küçük, deterministik PRNG. */
function createRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    pick: list => list[Math.floor(next() * list.length)],
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** 100'ün katı sentetik tutar; ondalık dizge. */
    money: (min, max) => `${100 * Math.floor((min + next() * (max - min)) / 100)}.00`,
  };
}

const isoDay = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const addMonths = (year, month, offset) => {
  const index = year * 12 + (month - 1) + offset;
  return [Math.floor(index / 12), (index % 12) + 1];
};

export async function buildSyntheticGeneration() {
  const tenantId = stableId('tenant', SYNTHETIC_TENANT_KEY);
  const random = createRandom(SEED);
  const taxonomy = createTaxonomy(tenantId);
  const term = (vocabulary, code) => {
    const id = taxonomy.termIndex.get(`${vocabulary}:${code}`);
    if (!id) throw new Error(`Sözlükte terim yok: ${vocabulary}:${code}`);
    return id;
  };
  const money = amount => (amount === null ? null : { amount, currency: 'TRY' });

  /** @type {Map<string, {partition: string, record: any}[]>} */
  const collections = new Map();
  const add = (collection, record, partition = 'global') => {
    if (!collections.has(collection)) collections.set(collection, []);
    collections.get(collection).push({ partition, record });
  };
  for (const key of ['vocabularies', 'terms', 'workflows', 'view_definitions', 'task_templates']) for (const record of taxonomy[key]) add(key, record);

  // Kaynaklar ve sayfalar: sentetik çalışma kitabı kimlikleri, gerçek Sheet kimliği yok.
  const sources = {};
  const sheets = {};
  const sheetDefinitions = {
    household: [[101, 'app_kalemler'], [102, 'app_ayarlar'], [103, 'app_nakit']],
    budget: [[201, 'Plan'], [202, 'Gerçekleşen'], [203, '_Finans web']],
  };
  for (const key of ['budget', 'household']) {
    const id = stableId(tenantId, 'source', key);
    sources[key] = id;
    add('sources', {
      id, tenant_id: tenantId, key, spreadsheet_id: `synthetic-${key}-workbook`, metadata_hash: sha256(`synthetic:${key}:metadata`), chunk_hashes: [sha256(`synthetic:${key}:chunk`)],
      capture: { started_at: '2026-10-28T08:00:00.000Z', completed_at: '2026-10-28T08:00:05.000Z', coverage: 'synthetic', bounds: [], drive_before: null, drive_after: null, consistency: 'not_transactional', note: 'Sentetik fixture; gerçek çalışma kitabı yok' },
    }, key);
    for (const [sheetId, title] of sheetDefinitions[key]) {
      sheets[title] = { source_key: key, source_id: id, sheet_id: sheetId, sheet_title: title };
      add('sheets', { id: stableId(tenantId, 'sheet', key, sheetId), tenant_id: tenantId, source_id: id, properties: { sheetId, title, index: sheetId % 100, sheetType: 'GRID' }, nonempty_cell_count: 0, nonempty_row_count: 0 }, key);
    }
  }
  add('supplements', { id: stableId(tenantId, 'supplement', 'synthetic_notes'), tenant_id: tenantId, key: 'synthetic_notes', classification: 'synthetic_fixture_not_sheets', source_url: null, payload: { note: 'Sentetik ek veri; gerçek yorum veya katalog değil' } });
  const provenance = (title, row, column = null) => {
    const sheet = sheets[title];
    const a1 = column === null ? `${row}:${row}` : `${String.fromCharCode(64 + column)}${row}`;
    return { source_key: sheet.source_key, source_id: sheet.source_id, sheet_id: sheet.sheet_id, sheet_title: title, row, column, a1 };
  };

  // Odalar: 6 ayar kaydı + 6 oda kaydı.
  const roomIds = [];
  for (let i = 1; i <= 6; i += 1) {
    const sourceRecordId = `ayar-oda-${i}`;
    const settingId = stableId(tenantId, 'entity', 'household', 102, sourceRecordId);
    const roomId = stableId(tenantId, 'room', 'household', `oda_${i}`);
    const label = `Örnek oda ${i}`;
    const sourceAttributes = { id: sourceRecordId, tip: 'oda', anahtar: `oda_${i}`, etiket: label };
    const base = { tenant_id: tenantId, label, source_id: sources.household, source_record_id: sourceRecordId, source_attributes: sourceAttributes, attributes: { anahtar: `oda_${i}`, etiket: label, deleted_at: null }, provenance: provenance('app_ayarlar', i + 1), deleted_at: null };
    add('settings', { ...base, id: settingId, kind: 'room' }, 'household');
    add('rooms', { ...base, id: roomId, kind: 'room', setting_id: settingId, code: `oda_${i}` }, 'household');
    roomIds.push(roomId);
  }
  add('settings', { id: stableId(tenantId, 'entity', 'household', 102, 'ayar-para-birimi'), tenant_id: tenantId, kind: 'setting', label: 'para_birimi', source_id: sources.household, source_record_id: 'ayar-para-birimi', source_attributes: { id: 'ayar-para-birimi', tip: 'ayar', anahtar: 'para_birimi', deger: 'TRY' }, attributes: { anahtar: 'para_birimi', deger: 'TRY', deleted_at: null }, provenance: provenance('app_ayarlar', 8), deleted_at: null }, 'household');

  // Kalemler (app_kalemler): purchase_need çeşitli; diğer türler daha az.
  const categories = ['mobilya', 'tekstil', 'beyaz_esya', 'mutfak_kahve', 'mutfak_pisirme', 'mutfak_sofra', 'aydinlatma_led', 'aydinlatma_akilli', 'elektrik_kontrol', 'duzenleme_cekmece', 'calisma_elektronigi', 'banyo_wc', 'temizlik', 'guvenlik', 'kopek', 'bebek', 'boya', 'iscilik', 'masraf', 'hizmet'];
  const nouns = ['koltuk', 'masa', 'perde', 'halı', 'lamba', 'raf', 'dolap', 'sandalye', 'tencere', 'fincan', 'ayna', 'kilim', 'sehpa', 'yastık', 'battaniye', 'tabure', 'saksı', 'çerçeve', 'sepet', 'askı', 'kutu', 'kase', 'tepsi', 'örtü', 'minder', 'lambader', 'vazo', 'konsol'];
  const decisions = ['idea', 'researching', 'pending', 'decided', 'cancelled'];
  const fulfillments = [null, 'planned', 'ordered', 'delivered', 'installed'];
  const payments = [null, 'planned', 'partially_paid', 'paid'];
  const legacyByDecision = { idea: 'fikir', researching: 'arastirma', pending: 'arastirma', decided: 'karar', cancelled: 'iptal' };
  const items = [];
  let row = 1;
  const item = ({ kind, label, category, phase, decision, fulfillment, inspection, payment, planned, actual, roomIndex, dates = {}, deleted = false, extra = {} }) => {
    row += 1;
    const sourceRecordId = `kalem-${String(row).padStart(3, '0')}`;
    const id = stableId(tenantId, 'entity', 'household', 101, sourceRecordId);
    const snapshot = { decision: decision ?? null, fulfillment: fulfillment ?? null, inspection: inspection ?? null, payment: payment ?? null };
    const deletedAt = deleted ? '2026-10-20T09:30:00.000Z' : null;
    const sourceAttributes = { id: sourceRecordId, tip: { purchase_need: 'satinalma', lighting_spec: 'aydinlatma', work_order: 'tadilat', layout_item: 'yerlesim', inspection: 'kontrol', automation_scene: 'sahne', milestone: 'kilometre' }[kind], ad: label, kategori: category, faz: phase, durum: decision ? legacyByDecision[decision] : null, oda: roomIndex === null ? null : `oda_${roomIndex + 1}` };
    const record = {
      id, tenant_id: tenantId, kind, label, source_id: sources.household, source_record_id: sourceRecordId, source_attributes: sourceAttributes,
      attributes: { ad: label, kategori: category, faz: phase, not: 'Sentetik kayıt', deleted_at: deletedAt, ...extra },
      provenance: provenance('app_kalemler', row), deleted_at: deletedAt,
      category_term_id: category ? term('category', category) : null,
      phase_term_id: phase === '1' ? term('phase', 'before_move') : phase === '2' ? term('phase', 'after_move') : null,
      context_term_ids: phase === '3' ? [term('life_context', 'baby_preparation')] : [],
      legacy_status_term_id: decision ? term('legacy_status', legacyByDecision[decision]) : null,
      state_snapshot: snapshot,
      state_term_ids: Object.fromEntries(Object.entries(snapshot).map(([axis, code]) => [axis, code === null ? null : term(`${axis}_state`, code)])),
      amounts: { planned: money(planned), actual: money(actual), estimated_min: money(planned), estimated_max: money(planned === null ? null : `${Number(planned) + 500}.00`), recorded_price: money(actual), quote: null },
      dates: { planned_on: dates.planned_on ?? null, order_due_on: dates.order_due_on ?? null, delivered_on: dates.delivered_on ?? null, payment_on: dates.payment_on ?? null, end_on: dates.end_on ?? null },
      room_id: roomIndex === null ? null : roomIds[roomIndex],
    };
    items.push(record);
    return record;
  };
  const collectionFor = { purchase_need: 'purchase_needs', lighting_spec: 'lighting_specs', work_order: 'work_orders', layout_item: 'layout_items', inspection: 'inspections', automation_scene: 'automation_scenes', milestone: 'milestones' };

  for (let i = 0; i < 28; i += 1) {
    const decision = decisions[i % decisions.length];
    const noAmounts = i % 9 === 0; // 0, 9, 18, 27 → en az 3 kayıtta plan ve gerçek null
    const planned = noAmounts ? null : random.money(500, 40000);
    const fulfillment = decision === 'decided' ? fulfillments[(i >> 1) % fulfillments.length] : decision === 'cancelled' ? 'cancelled' : null;
    const paid = fulfillment === 'delivered' || fulfillment === 'installed';
    const payment = noAmounts ? null : paid ? payments[1 + (i % 3)] : payments[i % 2];
    const actual = paid && !noAmounts ? random.money(Number(planned) * 0.8, Number(planned) * 1.2) : null;
    const [year, month] = addMonths(2026, 11, i % 12);
    item({
      kind: 'purchase_need', label: `Örnek ${nouns[i % nouns.length]} ${Math.floor(i / nouns.length) + 1}`.replace(/ 1$/, ''), category: categories[i % categories.length], phase: ['1', '2', '3'][i % 3], decision, fulfillment, payment, planned, actual,
      roomIndex: i % 7 === 6 ? null : i % 6, deleted: i === 5 || i === 17,
      dates: { planned_on: isoDay(year, month, 1 + (i % 27)), order_due_on: fulfillment ? isoDay(year, month, 28) : null, delivered_on: paid ? isoDay(year, month, 28) : null, payment_on: payment === 'paid' ? isoDay(year, month, 28) : null },
    });
  }
  for (let i = 0; i < 4; i += 1) item({ kind: 'lighting_spec', label: `Örnek armatür ${i + 1}`, category: 'aydinlatma_led', phase: '1', decision: 'decided', fulfillment: 'planned', payment: 'planned', planned: random.money(800, 6000), actual: null, roomIndex: i, extra: { lumen: `${(i + 1) * 800}`, renk_sicakligi_k: '3000' } });
  for (let i = 0; i < 4; i += 1) item({ kind: 'layout_item', label: `Örnek yerleşim ${i + 1}`, category: 'mobilya', phase: '2', decision: 'pending', planned: null, actual: null, roomIndex: (i + 2) % 6 });
  for (let i = 0; i < 3; i += 1) item({ kind: 'automation_scene', label: `Örnek sahne ${i + 1}`, category: 'aydinlatma_akilli', phase: '2', decision: 'idea', planned: null, actual: null, roomIndex: i });
  const workOrders = [];
  for (let i = 0; i < 8; i += 1) {
    const [year, month] = addMonths(2026, 11, i);
    workOrders.push(item({ kind: 'work_order', label: `Örnek tadilat işi ${i + 1}`, category: i % 2 ? 'boya' : 'iscilik', phase: '1', decision: 'decided', fulfillment: i < 3 ? 'installed' : 'planned', payment: i < 3 ? 'paid' : 'planned', planned: random.money(5000, 60000), actual: i < 3 ? random.money(5000, 60000) : null, roomIndex: i % 6, dates: { planned_on: isoDay(year, month, 3), end_on: isoDay(year, month, 20) }, extra: { kod: `IS-${i + 1}` } }));
  }
  for (let i = 0; i < 4; i += 1) {
    const [year, month] = addMonths(2026, 12, i * 3);
    item({ kind: 'milestone', label: `Örnek kilometre taşı ${i + 1}`, category: null, phase: i < 2 ? '1' : '2', decision: 'decided', planned: null, actual: null, roomIndex: null, dates: { planned_on: isoDay(year, month, 1), end_on: isoDay(year, month, 15) }, extra: { kod: `KT-${i + 1}` } });
  }
  for (let i = 0; i < 5; i += 1) item({ kind: 'inspection', label: `Örnek kontrol ${i + 1}`, category: 'hizmet', phase: '1', decision: 'decided', inspection: i < 2 ? 'completed' : 'pending', planned: null, actual: null, roomIndex: i, extra: { tamam: i < 2 } });
  for (const record of items) add(collectionFor[record.kind], record, 'household');

  // İlişkiler: located_in her odalı kalem için; depends_on tadilat zinciri; associated_with örnek çiftler.
  const relation = (from, kind, targetId) => add('relations', { id: stableId(tenantId, 'relation', from.id, kind, targetId), tenant_id: tenantId, kind, source_id: from.id, target_id: targetId, provenance: from.provenance }, 'household');
  for (const record of items) if (record.room_id) relation(record, 'located_in', record.room_id);
  for (let i = 1; i < workOrders.length; i += 1) relation(workOrders[i], 'depends_on', workOrders[i - 1].id);
  const purchaseNeeds = items.filter(r => r.kind === 'purchase_need');
  for (let i = 0; i + 1 < 8; i += 2) relation(purchaseNeeds[i], 'associated_with', purchaseNeeds[i + 1].id);

  // Medya: 1 doğrulanmış fotoğraf, 2 aday görsel. Alan adları örnek/geçersiz.
  const media = (index, entity, url, verification, rightsStatus) => add('media_references', { id: stableId(tenantId, 'reference', entity.id, url), tenant_id: tenantId, entity_id: entity.id, url, kind: 'image_candidate', verification, rights_status: rightsStatus, provenance: entity.provenance, label: `Örnek görsel ${index}` }, 'household');
  media(1, purchaseNeeds[1], 'https://example.invalid/ornek-gorsel-1.jpg', 'verified', 'own_photo');
  media(2, purchaseNeeds[2], 'https://example.invalid/ornek-gorsel-2.jpg', 'not_verified', 'unknown');
  media(3, purchaseNeeds[3], 'https://example.invalid/ornek-gorsel-3.webp', 'not_verified', 'unknown');

  // Bütçe gözlemleri: 24 ay × 8 satır, plan ve gerçek ayrı sayfalardan ayrı kayıt.
  const budgetLabels = ['Örnek gider satırı 1', 'Örnek gider satırı 2', 'Örnek gider satırı 3', 'Örnek gider satırı 4', 'Örnek gider satırı 5', 'Örnek gider satırı 6', 'Örnek gider satırı 7', 'Örnek gider satırı 8'];
  for (const [title, basis] of [['Plan', 'planned'], ['Gerçekleşen', 'recorded_aggregate']]) {
    const sheet = sheets[title];
    for (let m = 0; m < 24; m += 1) {
      const [year, month] = addMonths(2026, 1, m);
      const period = `${year}-${String(month).padStart(2, '0')}`;
      for (const [l, label] of budgetLabels.entries()) {
        const rowIndex = l + 2;
        const column = m + 2;
        add('budget_observations', { id: stableId(tenantId, 'observation', sheet.source_key, sheet.sheet_id, rowIndex, column), tenant_id: tenantId, kind: 'budget_observation', label, period, value: { decimal: random.money(1000, 25000), currency: 'TRY' }, basis, payment_evidence: false, provenance: provenance(title, rowIndex, column) }, `budget/${sheet.sheet_id}`);
      }
    }
  }

  // Tahmin: 1 forecast, 20 olay, 24 ay. record_basis forecast; ödeme veya anlaşma iddiası yok.
  const finance = sheets['_Finans web'];
  const forecastId = stableId(tenantId, 'forecast', 'budget', finance.sheet_id, 'synthetic-fingerprint');
  add('forecasts', { id: forecastId, tenant_id: tenantId, kind: 'forecast', record_basis: 'forecast', source_id: sources.budget, fingerprint: sha256('synthetic-forecast'), payload_hash: sha256('synthetic-forecast-payload'), status: 'synthetic', notes: ['Sentetik tahmin; gerçek finans verisi değil'], provenance: provenance('_Finans web', 1) }, 'budget');
  const eventTypes = ['purchase', 'payment', 'borrowing', 'repayment', 'interest', 'fee'];
  for (let i = 0; i < 20; i += 1) {
    const [year, month] = addMonths(2026, 11, Math.floor(i * 24 / 20));
    const date = isoDay(year, month, 1 + ((i * 7) % 27));
    const amount = random.money(1000, 30000);
    add('forecast_events', { id: stableId(tenantId, 'forecast_event', 'budget', finance.sheet_id, `olay-${i + 1}`), tenant_id: tenantId, forecast_id: forecastId, source_id: sources.budget, source_record_id: `olay-${i + 1}`, kind: 'forecast_event', label: `Örnek tahmin olayı ${i + 1}`, occurred_on: date, record_basis: 'forecast', event_type: eventTypes[i % eventTypes.length], certainty: i % 3 === 0 ? 'estimated' : 'planned', source_note: 'Sentetik', cash_change: money(i % 2 ? `-${amount}` : amount), measures: { planned: money(amount) }, provenance: provenance('_Finans web', 40 + i) }, `budget/${date.slice(0, 7)}`);
  }
  for (let m = 0; m < 24; m += 1) {
    const [year, month] = addMonths(2026, 11, m);
    const period = `${year}-${String(month).padStart(2, '0')}`;
    add('forecast_months', { id: stableId(tenantId, 'forecast_month', 'budget', finance.sheet_id, period), tenant_id: tenantId, forecast_id: forecastId, source_id: sources.budget, kind: 'forecast_month', period, record_basis: 'forecast', measures: { opening_balance: money(random.money(0, 50000)), closing_balance: money(random.money(0, 50000)), planned_outflow: money(random.money(1000, 30000)) }, provenance: provenance('_Finans web', 14 + m) }, 'budget');
  }

  // İnceleme kuyruğu: 10 sentetik sorun, kodlar normalize.mjs ile aynı.
  const issueSpecs = [
    ['formula_error', provenance('Plan', 12, 5), { type: 'DIV_ZERO', message: 'Sentetik formül hatası' }],
    ['formula_error', provenance('Gerçekleşen', 9, 7), { type: 'REF', message: 'Sentetik formül hatası' }],
    ['unresolved_room', purchaseNeeds[6].provenance, { value: 'oda_yok' }],
    ['unknown_term', purchaseNeeds[7].provenance, { vocabulary: 'category', value: 'ornek_bilinmeyen' }],
    ['missing_record_id', provenance('app_kalemler', 70), { sheet: 'app_kalemler' }],
    ['invalid_date', purchaseNeeds[8].provenance, { field: 'planlanan_tarih', value: 'örnek' }],
    ['source_only_sheet', provenance('_Finans web', 0 + 1), { reason: 'Derived or unowned table is retained as source, not duplicated budget facts' }],
    ['unresolved_relation', workOrders[0].provenance, { kind: 'depends_on', target: 'IS-99', lookup: 'code' }],
    ['invalid_link', purchaseNeeds[9].provenance, { value: 'örnek bağlantı' }],
    ['unknown_phase', purchaseNeeds[10].provenance, { value: '4' }],
  ];
  for (const [code, p, detail] of issueSpecs) add('issues', { id: stableId(tenantId, 'issue', code, p, detail), tenant_id: tenantId, code, severity: 'review', provenance: p, detail }, p.source_key);

  // Dosyalar: data-platform/index.mjs ile aynı sıralama ve bölümleme.
  const files = [];
  const partitions = new Map();
  const counts = {};
  const file = (relative, bytes, extra) => { files.push({ path: relative, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), ...extra }); return bytes; };
  for (const [collection, entries] of [...collections].sort(([a], [b]) => a.localeCompare(b))) {
    const unique = [...new Map(entries.map(e => [e.record.id, e])).values()];
    if (unique.length !== entries.length) throw new Error(`Yinelenen kimlik: ${collection}`);
    counts[collection] = unique.length;
    for (const [partition, group] of [...Map.groupBy(unique, e => e.partition)].sort(([a], [b]) => a.localeCompare(b))) {
      const records = group.map(e => e.record).sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 0; i < records.length; i += 512) {
        const part = records.slice(i, i + 512);
        const relative = `data/${collection}/${partition}/${String(i / 512).padStart(5, '0')}.json`;
        const bytes = file(relative, canonical({ schemaVersion: 1, collection, records: part }), { kind: 'partition', collection, count: part.length });
        partitions.set(relative, { collection, records: part, bytes });
      }
    }
  }
  const copies = new Map();
  for (const name of ['partition', 'manifest', 'source-manifest']) copies.set(`schemas/${name}.schema.json`, file(`schemas/${name}.schema.json`, await readFile(path.join(dataPlatform, 'schemas', `${name}.schema.json`)), { kind: 'schema' }));
  copies.set('contracts/postgres-mapping.json', file('contracts/postgres-mapping.json', await readFile(path.join(dataPlatform, 'postgres-mapping.json')), { kind: 'contract' }));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const sourceSummary = collections.get('sources').map(({ record }) => ({ key: record.key, source_id: record.id, capture: record.capture })).sort((a, b) => a.key.localeCompare(b.key));
  const content = { schemaVersion: 1, tenant_id: tenantId, files, sources: sourceSummary };
  const manifest = { ...content, generation_id: sha256(canonical(content)), counts, consistency: 'snapshot_capture_not_transaction', currency_policy: 'Unknown values remain null; amounts are decimal strings', storage_policy: 'private_only', synthetic: true };
  return { manifest, partitions, copies };
}

/** Nesli <outputRoot>/<generation_id>/ altına yazar; aynı kökteki eski sentetik nesil klasörlerini kaldırır. */
export async function writeSyntheticGeneration(outputRoot = DEFAULT_OUTPUT) {
  const { manifest, partitions, copies } = await buildSyntheticGeneration();
  const directory = path.join(outputRoot, manifest.generation_id);
  await mkdir(outputRoot, { recursive: true });
  for (const entry of await readdir(outputRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && entry.name !== manifest.generation_id) await rm(path.join(outputRoot, entry.name), { recursive: true });
  }
  await rm(directory, { recursive: true, force: true });
  const write = async (relative, bytes) => { const target = path.join(directory, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); };
  for (const [relative, { bytes }] of partitions) await write(relative, bytes);
  for (const [relative, bytes] of copies) await write(relative, bytes);
  await mkdir(path.join(directory, 'raw'), { recursive: true });
  await writeFile(path.join(directory, 'raw', '.gitkeep'), '');
  await write('manifest.json', canonical(manifest));
  const result = await validateGeneration(directory);
  return { directory, generationId: result.generationId, counts: result.counts, files: result.files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await writeSyntheticGeneration(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT);
  console.log(JSON.stringify({ directory: path.relative(repoRoot, result.directory), generationId: result.generationId, files: result.files, counts: result.counts }, null, 1));
}
