import { toneForCode, type ChangeOp, type PurchaseNeedRecord, type StateAxis, type Term, type WorkflowDefinition } from '../../data';

// Durum geçişi (iş akışı). Yazma yalnız yerel change set'e (state_change, Geri al); Sheets'e yazma yok. Saf; React yok.

export const BILINMIYOR = 'Bilinmiyor';
const EKSEN_ADI: Record<StateAxis, string> = { decision: 'Karar', fulfillment: 'Tedarik', inspection: 'Kontrol', payment: 'Ödeme' };

/** Satırın birincil durum ekseni (indexes.stateLabel ile aynı öncelik): iptal kararı örter; sonra tedarik; yoksa karar. */
export function durumEkseni(record: PurchaseNeedRecord): StateAxis {
  const snapshot = record.state_snapshot;
  const decision = snapshot?.decision ?? null;
  if (decision && toneForCode(decision) === 'hata') return 'decision';
  if (snapshot?.fulfillment || record.state_term_ids?.fulfillment) return 'fulfillment';
  return 'decision';
}

export type GecisSonucu =
  | { ok: true; axis: StateAxis; from: { code: string | null; term_id: string | null }; to: { code: string; term_id: string } }
  | { ok: false; reason: string };

function durumAdi(record: PurchaseNeedRecord, axis: StateAxis, termsById: ReadonlyMap<string, Term>): string {
  const termId = record.state_term_ids?.[axis] ?? null;
  return (termId ? termsById.get(termId)?.label : undefined) ?? record.state_snapshot?.[axis] ?? BILINMIYOR;
}

/** Kaydın birincil ekseninde hedef terime geçiş: yalnız iş akışında tanımlı ve kanıt istemeyen geçiş kabul edilir. */
export function durumGecisi(record: PurchaseNeedRecord, toTermId: string, workflows: readonly WorkflowDefinition[], terms: readonly Term[]): GecisSonucu {
  const axis = durumEkseni(record);
  const termsById = new Map(terms.map(term => [term.id, term] as const));
  const fromId = record.state_term_ids?.[axis] ?? null;
  const fromCode = record.state_snapshot?.[axis] ?? null;
  const fromLabel = durumAdi(record, axis, termsById);
  const to = termsById.get(toTermId);
  if (!to) return { ok: false, reason: 'Hata: hedef durum sözlükte yok.' };
  const workflow = workflows.find(item => item.key === axis);
  if (!workflow || !Array.isArray(workflow.transitions)) {
    return { ok: false, reason: `Hata: ${EKSEN_ADI[axis]} iş akışı kaynakta tanımlı değil.` };
  }
  const transition = workflow.transitions.find(item => item.from_term_id === fromId && item.to_term_id === toTermId);
  if (!transition) return { ok: false, reason: `Hata: ${fromLabel} → ${to.label} geçişi iş akışında yok.` };
  if (transition.requires_evidence) {
    return { ok: false, reason: `Hata: ${fromLabel} → ${to.label} geçişi kanıt ister; panel bu sürümde kanıt eklemez.` };
  }
  return { ok: true, axis, from: { code: fromCode, term_id: fromId }, to: { code: to.code, term_id: to.id } };
}

/** Birincil eksende iş akışının izin verdiği (kanıt istemeyen) hedef terimler, geçiş sırasıyla. */
export function izinliHedefler(record: PurchaseNeedRecord, workflows: readonly WorkflowDefinition[], termsById: ReadonlyMap<string, Term>): Term[] {
  const axis = durumEkseni(record);
  const fromId = record.state_term_ids?.[axis] ?? null;
  const workflow = workflows.find(item => item.key === axis);
  if (!workflow || !fromId || !Array.isArray(workflow.transitions)) return [];
  const out: Term[] = [];
  for (const transition of workflow.transitions) {
    if (transition.from_term_id !== fromId || transition.requires_evidence || !transition.to_term_id) continue;
    const term = termsById.get(transition.to_term_id);
    if (term && !out.some(item => item.id === term.id)) out.push(term);
  }
  return out;
}

const BOS_ANLIK = { decision: null, fulfillment: null, inspection: null, payment: null };

/** Ham kayıt + bu kaydın etkin yerel opları (changeSet.apply ile aynı kural). */
export function guncelKayit(record: PurchaseNeedRecord, ops: readonly ChangeOp[]): PurchaseNeedRecord {
  if (!ops.length) return record;
  const snapshot = { ...BOS_ANLIK, ...record.state_snapshot };
  const termIds = { ...BOS_ANLIK, ...record.state_term_ids };
  for (const op of ops) {
    if (op.kind !== 'state_change') continue;
    snapshot[op.after.axis] = op.after.code;
    termIds[op.after.axis] = op.after.term_id;
  }
  return { ...record, state_snapshot: snapshot, state_term_ids: termIds };
}
