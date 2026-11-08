import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndexes, buildTermTree, paymentLabel, stateLabel, toRecordRow } from './indexes';
import type { GenerationCollections } from './indexes';
import type { MediaReference, PurchaseNeedRecord, Relation, Room, Term, Vocabulary } from './types';

// Sentetik nesil: fixtures/generation-synthetic/<sha256>/ (gerçek nesil Git dışındadır, burada okunmaz).
const FIXTURE_ROOT = join(process.cwd(), 'fixtures', 'generation-synthetic');
const GENERATION_DIR = join(FIXTURE_ROOT, readdirSync(FIXTURE_ROOT).find((d) => /^[0-9a-f]{64}$/.test(d)) ?? '');
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(GENERATION_DIR, rel), 'utf8'));
const records = <R>(rel: string): R[] => (readJson(rel) as { records: R[] }).records;
const manifest = readJson('manifest.json') as { counts: Record<string, number> };

const TENANT = '89bb71d8-2e82-56a2-b231-843cbc783ba2';
const CATEGORY_VOCAB = 'db9d5f13-4d9d-5c73-bf76-2b8895384881';
const GROUP_MUTFAK = '114ce5cc-e0a1-592e-8620-08653c589d17';
const GROUP_KUCUK_EV_ALETLERI = '53723dae-4608-507e-a0a2-f42ac5c5619d';
const MUTFAK_KAHVE = 'd3842420-009f-5296-92a2-81127afdb435';
const GROUP_ELEKTRIK = '379c28ed-e360-5fec-b14c-7795ef8032d1';
const AYDINLATMA_LED = 'b8e3cf3b-c76a-50a3-8fec-62b1335d6805';
const TEKSTIL = '58ea5c0e-fa83-55f8-971d-c9fb9f73f5bc';
const ODA_2 = 'f15f54be-1cf0-522f-ac88-06001d1b39ac';

function loadCollections(): GenerationCollections {
  return {
    purchase_needs: records<PurchaseNeedRecord>('data/purchase_needs/household/00000.json'),
    rooms: records<Room>('data/rooms/household/00000.json'),
    terms: records<Term>('data/terms/global/00000.json'),
    vocabularies: records<Vocabulary>('data/vocabularies/global/00000.json'),
    relations: records<Relation>('data/relations/household/00000.json'),
    media_references: records<MediaReference>('data/media_references/household/00000.json'),
  };
}

const collections = loadCollections();
const indexes = buildIndexes(collections);
const need = (code: string): PurchaseNeedRecord => {
  const found = collections.purchase_needs?.find((r) => r.source_record_id === code);
  if (!found) throw new Error(`fixture kaydı yok: ${code}`);
  return found;
};

function term(id: string, over: Partial<Term>): Term {
  return { id, tenant_id: TENANT, vocabulary_id: 'vocab-x', code: id, label: id.toUpperCase(), parent_id: null, legacy: false, ...over };
}

describe('indexes: byId ve ilişkiler (sentetik nesil)', () => {
  it('byId yüklenen koleksiyonların toplamı kadar kayıt içerir', () => {
    const expected = ['purchase_needs', 'rooms', 'terms', 'vocabularies', 'relations', 'media_references']
      .map((c) => manifest.counts[c])
      .reduce((a, b) => a + b, 0);
    expect(indexes.byId.size).toBe(expected);
    expect(indexes.byId.get(need('kalem-027').id)?.kind).toBe('purchase_need');
  });

  it('roomsById 6 oda, termsById 91 terim', () => {
    expect(indexes.roomsById.size).toBe(manifest.counts.rooms);
    expect(indexes.roomsById.get(ODA_2)?.label).toBe('Örnek oda 2');
    expect(indexes.termsById.size).toBe(manifest.counts.terms);
  });

  it('relationsBySource / byTarget bütün ilişkileri kaybetmeden gruplar', () => {
    const total = (m: ReadonlyMap<string, readonly Relation[]>) => [...m.values()].reduce((n, xs) => n + xs.length, 0);
    expect(total(indexes.relationsBySource)).toBe(manifest.counts.relations);
    expect(total(indexes.relationsByTarget)).toBe(manifest.counts.relations);
    expect(indexes.relationsBySource.size).toBe(49);
    expect(indexes.relationsByTarget.size).toBe(17);
    const located = indexes.relationsBySource.get(need('kalem-027').id) ?? [];
    expect(located.map((r) => r.kind)).toContain('located_in');
    expect(located.find((r) => r.kind === 'located_in')?.target_id).toBe(ODA_2);
    // Odaya gelen ilişkiler aynı kayıtları ters yönden bulur.
    expect(indexes.relationsByTarget.get(ODA_2)?.some((r) => r.source_id === need('kalem-027').id)).toBe(true);
  });

  it('termsByVocabulary sözlük key → kod → terim', () => {
    expect(indexes.termsByVocabulary.size).toBe(manifest.counts.vocabularies);
    expect(indexes.termsByVocabulary.get('category')?.get('mutfak_sofra')?.label).toBe('Sofra ve servis');
    expect(indexes.termsByVocabulary.get('payment_state')?.get('paid')?.label).toBe('Ödendi');
    expect(indexes.termsByVocabulary.get('yok')).toBeUndefined();
  });

  it('mediaByEntity varlık kimliğine göre gruplar', () => {
    expect(indexes.mediaByEntity.get(need('kalem-003').id)).toHaveLength(1);
    expect(indexes.mediaByEntity.get(need('kalem-027').id)).toBeUndefined();
  });
});

describe('indexes: termTree', () => {
  const tree = indexes.termTree;

  it('kök terimler ve çocuklar', () => {
    const roots = tree.roots(CATEGORY_VOCAB);
    expect(roots).toHaveLength(14);
    expect(roots.every((t) => t.parent_id === null)).toBe(true);
    expect(tree.children(GROUP_MUTFAK).map((t) => t.code).sort()).toEqual(['group:kucuk_ev_aletleri', 'mutfak', 'mutfak_pisirme', 'mutfak_sofra']);
    expect(tree.children(TEKSTIL)).toEqual([]);
    expect(tree.parent(MUTFAK_KAHVE)?.id).toBe(GROUP_KUCUK_EV_ALETLERI);
    expect(tree.parent(GROUP_MUTFAK)).toBeNull();
  });

  it('ancestors yakından uzağa, descendants torunları da kapsar', () => {
    expect(tree.ancestors(MUTFAK_KAHVE).map((t) => t.id)).toEqual([GROUP_KUCUK_EV_ALETLERI, GROUP_MUTFAK]);
    expect(tree.ancestors(GROUP_MUTFAK)).toEqual([]);
    const desc = tree.descendants(GROUP_MUTFAK).map((t) => t.id);
    expect(desc).toContain(GROUP_KUCUK_EV_ALETLERI);
    expect(desc).toContain(MUTFAK_KAHVE);
    // 4 çocuk (group:kucuk_ev_aletleri, mutfak_pisirme, mutfak, mutfak_sofra) + 2 torun (mutfak_kucuk_ev_aleti, mutfak_kahve)
    expect(desc).toHaveLength(6);
  });

  it('parent kapsar: covers üst terimin alt terimleri için doğru, kendisi için doğru, yabancı için yanlış', () => {
    expect(tree.covers(GROUP_ELEKTRIK, AYDINLATMA_LED)).toBe(true);
    expect(tree.covers(GROUP_MUTFAK, MUTFAK_KAHVE)).toBe(true);
    expect(tree.covers(GROUP_MUTFAK, GROUP_MUTFAK)).toBe(true);
    expect(tree.covers(GROUP_MUTFAK, TEKSTIL)).toBe(false);
    expect(tree.covers(MUTFAK_KAHVE, GROUP_MUTFAK)).toBe(false);
    expect(tree.rejected).toEqual([]);
  });

  it('döngü reddedilir: döngüyü kapatan kenar kesilir, ancestors sonlanır', () => {
    const cyclic = buildTermTree([
      term('a', { parent_id: 'b' }),
      term('b', { parent_id: 'a' }),
      term('c', { parent_id: 'a' }),
      term('d', { parent_id: 'd' }),
    ]);
    expect(cyclic.rejected.map((r) => r.reason).sort()).toEqual(['cycle', 'self_parent']);
    expect(cyclic.ancestors('c').length).toBeLessThanOrEqual(2);
    expect(cyclic.ancestors('c').map((t) => t.id)[0]).toBe('a');
    expect(cyclic.descendants('a').map((t) => t.id)).toContain('c');
    expect(cyclic.roots('vocab-x').map((t) => t.id)).toContain('d');
    // Döngüde kalan iki terimden tam biri kök olur; kesilen kenar rapordadır.
    const cycleRejection = cyclic.rejected.find((r) => r.reason === 'cycle');
    expect(['a', 'b']).toContain(cycleRejection?.term_id);
    expect(cyclic.roots('vocab-x').filter((t) => t.id === 'a' || t.id === 'b')).toHaveLength(1);
  });

  it('eksik ve sözlük dışı üst terim reddedilir, terim kök sayılır', () => {
    const t = buildTermTree([
      term('x', { parent_id: 'missing' }),
      term('y', { vocabulary_id: 'vocab-y' }),
      term('z', { parent_id: 'y' }),
    ]);
    expect(t.rejected.map((r) => [r.term_id, r.reason])).toEqual([
      ['x', 'missing_parent'],
      ['z', 'cross_vocabulary'],
    ]);
    expect(t.roots('vocab-x').map((r) => r.id).sort()).toEqual(['x', 'z']);
    expect(t.parent('z')).toBeNull();
  });
});

describe('indexes: stateLabel / paymentLabel', () => {
  it('fikir → notr, kuruldu → olumlu, iptal → hata, karar bekliyor → uyari, araştırılıyor → bilgi', () => {
    expect(stateLabel(need('kalem-027'), indexes)).toEqual({ label: 'Fikir', tone: 'notr' });
    expect(stateLabel(need('kalem-010'), indexes)).toEqual({ label: 'Kuruldu', tone: 'olumlu' });
    expect(stateLabel(need('kalem-016'), indexes)).toEqual({ label: 'İptal', tone: 'hata' });
    expect(stateLabel(need('kalem-029'), indexes)).toEqual({ label: 'Karar bekliyor', tone: 'uyari' });
    expect(stateLabel(need('kalem-008'), indexes)).toEqual({ label: 'Araştırılıyor', tone: 'bilgi' });
  });

  it('karar verildi + alınacak: teslimat ekseni öne çıkar', () => {
    expect(stateLabel(need('kalem-015'), indexes)).toEqual({ label: 'Alınacak', tone: 'notr' });
    expect(stateLabel(need('kalem-015'), indexes, 'decision')).toEqual({ label: 'Karar verildi', tone: 'olumlu' });
  });

  it('ödeme ekseni ayrıdır: ödendi olumlu, planlandı notr, yoksa undefined', () => {
    expect(paymentLabel(need('kalem-010'), indexes)).toEqual({ label: 'Ödendi', tone: 'olumlu' });
    expect(paymentLabel(need('kalem-027'), indexes)).toEqual({ label: 'Planlandı', tone: 'notr' });
    expect(paymentLabel(need('kalem-008'), indexes)).toBeUndefined();
  });

  it('terim yoksa snapshot koduna düşer; hepsi boşsa "Bilinmiyor"', () => {
    const base = need('kalem-027');
    const orphan: PurchaseNeedRecord = {
      ...base,
      state_term_ids: { decision: 'yok-terim', fulfillment: null, inspection: null, payment: null },
      state_snapshot: { decision: 'cancelled', fulfillment: null, inspection: null, payment: null },
    };
    expect(stateLabel(orphan, indexes)).toEqual({ label: 'cancelled', tone: 'hata' });
    const empty: PurchaseNeedRecord = {
      ...base,
      state_term_ids: { decision: null, fulfillment: null, inspection: null, payment: null },
      state_snapshot: { decision: null, fulfillment: null, inspection: null, payment: null },
    };
    expect(stateLabel(empty, indexes)).toEqual({ label: 'Bilinmiyor', tone: 'notr' });
  });
});

describe('indexes: toRecordRow', () => {
  it('kod, ad, oda, kategori, durum, ödeme, tutarlar ve tarihler', () => {
    const row = toRecordRow(need('kalem-027'), indexes);
    expect(row).toMatchObject({
      id: need('kalem-027').id,
      code: 'kalem-027',
      label: 'Örnek lambader',
      kind: 'purchase_need',
      room: 'Örnek oda 2',
      category: 'Sofra ve servis',
      status: { label: 'Fikir', tone: 'notr' },
      payment: { label: 'Planlandı', tone: 'notr' },
      planned: { amount: '700.00', currency: 'TRY' },
      actual: null,
      photo: null,
    });
    expect(row.dates).toEqual({ planned: '2026-12-26' });
    expect(row.owner).toBeUndefined();
  });

  it('fotoğraf yalnız verified medya ile gelir; not_verified "Fotoğraf yok" (null) kalır', () => {
    expect(toRecordRow(need('kalem-003'), indexes).photo).toEqual({ url: 'https://example.invalid/ornek-gorsel-1.jpg', verified: true });
    expect(toRecordRow(need('kalem-004'), indexes).photo).toBeNull();
    expect(toRecordRow(need('kalem-005'), indexes).photo).toBeNull();
  });

  it('plan ve gerçek ayrı kalır; eksik tutar null olur, sıfıra veya diğerine dönüşmez', () => {
    const paid = toRecordRow(need('kalem-010'), indexes);
    expect(paid.planned).toEqual({ amount: '38600.00', currency: 'TRY' });
    expect(paid.actual).toEqual({ amount: '36600.00', currency: 'TRY' });
    const noPlan = toRecordRow(need('kalem-029'), indexes);
    expect(noPlan.planned).toBeNull();
    expect(noPlan.actual).toBeNull();
    const noAmounts = toRecordRow({ ...need('kalem-029'), amounts: {} } as PurchaseNeedRecord, indexes);
    expect(noAmounts.planned).toBeNull();
    expect(noAmounts.actual).toBeNull();
  });

  it('oda: room_id yoksa located_in ilişkisinden, o da yoksa undefined', () => {
    expect(toRecordRow(need('kalem-029'), indexes).room).toBeUndefined();
    const viaRelation: PurchaseNeedRecord = { ...need('kalem-027'), room_id: null };
    expect(toRecordRow(viaRelation, indexes).room).toBe('Örnek oda 2');
    expect(toRecordRow(need('kalem-029'), indexes).payment).toBeUndefined();
  });

  it('kod yoksa id kullanılır; ad yoksa "Bilinmiyor"', () => {
    const base = need('kalem-027');
    // label yoksa attributes.ad, o da yoksa source_attributes.ad; hepsi yoksa "Bilinmiyor".
    const viaSource: PurchaseNeedRecord = { ...base, label: undefined, attributes: {} };
    expect(toRecordRow(viaSource, indexes).label).toBe('Örnek lambader');
    const bare: PurchaseNeedRecord = { ...base, source_record_id: undefined, label: undefined, attributes: {}, source_attributes: {} };
    const row = toRecordRow(bare, indexes);
    expect(row.code).toBe(bare.id);
    expect(row.label).toBe('Bilinmiyor');
  });
});
