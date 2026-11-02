import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PurchaseNeedRecord, Term, Vocabulary, WorkflowDefinition } from '../../data/types';
import {
  aggregateUsage,
  buildTermTree,
  countTermUsage,
  countTermUsageByKind,
  fieldLabel,
  flattenTermTree,
  kindLabel,
  sectionOptions,
  statusText,
  transitionRows,
  usageText,
  vocabularyLabel,
  workflowStates,
} from './model';

// Sözlükler sayfasının saf mantığı (React yok). Gerçek sentetik nesil (fixtures/generation-synthetic) + küçük elle
// kurulmuş kenar durumları (döngü, yetim, bilinmeyen anahtar). Beklenenler fixture'dan hesaplanır; sabit sayı yok.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, '../../../../fixtures/generation-synthetic');
const GENERATION_ID = readdirSync(FIXTURE_ROOT).find((name) => statSync(join(FIXTURE_ROOT, name)).isDirectory())!;
const records = <T>(rel: string): T[] => (JSON.parse(readFileSync(join(FIXTURE_ROOT, GENERATION_ID, rel), 'utf8')) as { records: T[] }).records;

const VOCABS = records<Vocabulary>('data/vocabularies/global/00000.json');
const TERMS = records<Term>('data/terms/global/00000.json');
const WORKFLOWS = records<WorkflowDefinition>('data/workflows/global/00000.json');
const CATEGORY = VOCABS.find((v) => v.key === 'category')!;
const CATEGORY_TERMS = TERMS.filter((t) => t.vocabulary_id === CATEGORY.id);
const termLabel = (id: string) => TERMS.find((t) => t.id === id)?.label ?? 'Bilinmiyor';
const tr = (a: string, b: string) => a.localeCompare(b, 'tr-TR');

const term = (id: string, label: string, parent: string | null = null): Term => ({
  id, label, code: id, parent_id: parent, legacy: false, vocabulary_id: 'v', tenant_id: 't',
});

describe('buildTermTree', () => {
  it('kategori sözlüğünün her terimini (torunlar dahil) tam bir kez, doğru derinlikte verir', () => {
    const flat = flattenTermTree(buildTermTree(CATEGORY_TERMS));
    expect(flat.map((node) => node.term.id).sort()).toEqual(CATEGORY_TERMS.map((t) => t.id).sort());
    const byId = new Map(CATEGORY_TERMS.map((t) => [t.id, t] as const));
    const depthOf = (t: Term): number => (t.parent_id && byId.has(t.parent_id) ? 1 + depthOf(byId.get(t.parent_id)!) : 0);
    for (const node of flat) expect(node.depth, node.term.label).toBe(depthOf(node.term));
    // Sentetik nesilde iki düzey alt dal var (ör. Mutfak › Küçük ev aletleri › …); torun kaybolmamalı.
    expect(flat.some((node) => node.depth === 2)).toBe(true);
  });

  it('her düzeyde Türkçe alfabe sırası; düz liste ebeveynden hemen sonra çocuklarını verir', () => {
    const roots = buildTermTree(CATEGORY_TERMS);
    expect(roots.map((n) => n.term.label)).toEqual(CATEGORY_TERMS.filter((t) => t.parent_id === null).map((t) => t.label).sort(tr));
    const flat = flattenTermTree(roots);
    flat.forEach((node, index) => {
      if (node.depth === 0) return;
      const parentIndex = flat.findIndex((candidate) => candidate.term.id === node.term.parent_id);
      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(parentIndex).toBeLessThan(index);
      expect(node.parent?.id).toBe(node.term.parent_id);
    });
  });

  it('üstü nesilde olmayan terim köktür; döngüdeki terimler kaybolmaz ve sonsuz döngü olmaz', () => {
    const tree = buildTermTree([term('a', 'Ana'), term('b', 'Bağlı', 'a'), term('y', 'Yetim', 'yok'), term('x', 'Döngü X', 'z'), term('z', 'Döngü Z', 'x')]);
    const flat = flattenTermTree(tree);
    expect(flat.map((n) => n.term.id).sort()).toEqual(['a', 'b', 'x', 'y', 'z']);
    expect(tree.map((n) => n.term.label)).toEqual(expect.arrayContaining(['Ana', 'Yetim']));
    expect(flat.find((n) => n.term.id === 'b')!.depth).toBe(1);
    expect(flat.find((n) => n.term.id === 'y')!.depth).toBe(0);
  });
});

describe('kullanım sayımı', () => {
  const rec = (overrides: Partial<PurchaseNeedRecord>): PurchaseNeedRecord =>
    ({ id: 'r', kind: 'purchase_need', label: 'x', deleted_at: null, category_term_id: null, phase_term_id: null, legacy_status_term_id: null, context_term_ids: [], state_term_ids: {}, ...overrides }) as unknown as PurchaseNeedRecord;

  it('silinmiş kayıt sayılmaz; tüm terim alanları sayılır', () => {
    const usage = countTermUsage([
      rec({ category_term_id: 'k', phase_term_id: 'f', context_term_ids: ['c'], state_term_ids: { decision: 'd', fulfillment: null } as never }),
      rec({ category_term_id: 'k', deleted_at: '2026-10-01T00:00:00Z' }),
    ]);
    expect(Object.fromEntries(usage)).toEqual({ k: 1, f: 1, c: 1, d: 1 });
  });

  it('türlere göre dağılım: toplam ve tür başına sayı, tür Türkçe adıyla', () => {
    const usage = countTermUsageByKind([
      { kind: 'purchase_need', records: [rec({ category_term_id: 'k' }), rec({ category_term_id: 'k' })] },
      { kind: 'work_order', records: [rec({ category_term_id: 'k' })] },
    ]);
    expect(usage.get('k')).toEqual({ total: 3, kinds: [{ kind: 'purchase_need', count: 2 }, { kind: 'work_order', count: 1 }] });
    expect(usage.get('yok')).toBeUndefined();
    expect(usageText(3)).toBe('3 kayıt kullanıyor');
    expect(usageText(1)).toBe('1 kayıt kullanıyor');
    expect(usageText(0)).toBe('Kullanan kayıt yok');
    expect(usageText(null)).toBe('Kullanım bilinmiyor');
  });
});

describe('alt dallar dahil kullanım', () => {
  it('üst terimin toplamı kendi + tüm alt dallarının doğrudan kullanımıdır; türler birleştirilir; bilinmiyorsa null', () => {
    const roots = buildTermTree([term('a', 'Ana'), term('b', 'Bağlı', 'a'), term('c', 'Torun', 'b'), term('d', 'Boş')]);
    const direct = new Map([
      ['a', { total: 1, kinds: [{ kind: 'purchase_need', count: 1 }] }],
      ['c', { total: 2, kinds: [{ kind: 'work_order', count: 2 }] }],
    ]);
    const usage = aggregateUsage(roots, direct);
    expect(usage.get('a')).toEqual({ direct: 1, total: 3, kinds: [{ kind: 'purchase_need', count: 1 }, { kind: 'work_order', count: 2 }] });
    expect(usage.get('b')).toEqual({ direct: 0, total: 2, kinds: [{ kind: 'work_order', count: 2 }] });
    expect(usage.get('d')).toEqual({ direct: 0, total: 0, kinds: [] });
    expect(aggregateUsage(roots, null).get('a')).toBeNull();
  });
});

describe('iş akışı', () => {
  const byVocab = (key: string) => WORKFLOWS.find((w) => w.vocabulary_id === VOCABS.find((v) => v.key === key)!.id)!;

  it('durumlar başlangıçtan geçiş sırasıyla (derinlik öncelikli) dizilir; başlangıç ve son durumlar işaretlenir', () => {
    const states = workflowStates(byVocab('fulfillment_state'), termLabel);
    expect(states.map((s) => s.label)).toEqual(['Alınacak', 'Sipariş edildi', 'Teslim edildi', 'Kuruldu', 'İptal']);
    expect(states.filter((s) => s.start).map((s) => s.label)).toEqual(['Alınacak']);
    expect(states.filter((s) => s.terminal).map((s) => s.label)).toEqual(['Kuruldu', 'İptal']);
  });

  it('girişsiz durum yoksa (döngü) ilk geçişin kaynağı başlangıçtır; her durum bir kez', () => {
    const task = byVocab('task_state');
    const states = workflowStates(task, termLabel);
    expect(states[0]!.label).toBe(termLabel(task.transitions[0]!.from_term_id!));
    expect(states[0]!.start).toBe(true);
    const ids = new Set(task.transitions.flatMap((t) => [t.from_term_id, t.to_term_id]));
    expect(states).toHaveLength(ids.size);
  });

  it('geçiş satırı Türkçe ad ve kanıt bilgisi taşır; bilinmeyen terim "Bilinmiyor"', () => {
    const rows = transitionRows(byVocab('inspection_state'), termLabel);
    expect(rows.map((r) => [r.dan, r.na, r.kanit])).toEqual([
      ['Kontrol bekliyor', 'Kontrol tamamlandı', true],
      ['Kontrol tamamlandı', 'Kontrol bekliyor', true],
    ]);
    const unknown = transitionRows({ ...byVocab('inspection_state'), transitions: [{ from_term_id: 'yok', to_term_id: 'yok2', requires_evidence: false }] }, termLabel);
    expect(unknown[0]).toMatchObject({ dan: 'Bilinmiyor', na: 'Bilinmiyor', kanit: false });
  });
});

describe('Türkçe adlar', () => {
  it('sözlük, tür, alan ve durum anahtarları Türkçe; bilinmeyen anahtar olduğu gibi (uydurma yok)', () => {
    expect(vocabularyLabel('task_state')).toBe('Görev durumu');
    expect(vocabularyLabel('bilinmeyen')).toBe('bilinmeyen');
    expect(kindLabel('purchase_need')).toBe('Alım');
    expect(kindLabel('work_order')).toBe('İş');
    expect(kindLabel('x_tur')).toBe('x_tur');
    expect(fieldLabel('dates.planned_on')).toBe('Planlanan tarih');
    expect(fieldLabel('label')).toBe('Ad');
    expect(fieldLabel('x.y')).toBe('x.y');
    expect(statusText('proposed_template')).toBe('Önerilen şablon');
    expect(statusText('')).toBe('Bilinmiyor');
  });

  it('bölüm seçenekleri: dolu gruplar sabit sırada, ardından İş akışları ve Görünümler', () => {
    const { options, groups } = sectionOptions(VOCABS);
    expect(options.map((o) => o.label)).toEqual(['Kategoriler', 'Durumlar', 'Finansman', 'Diğer sözlükler', 'İş akışları', 'Görünümler']);
    expect(groups.find((g) => g.key === 'durum')!.vocabs.map((v) => v.key).every((key) => key.endsWith('_state'))).toBe(true);
    expect(sectionOptions([]).options.map((o) => o.key)).toEqual(['akis', 'gorunum']);
  });
});
