// Tip uyumu: Zod'un doğruladığı kayıt (ParsedRecord) panelin alan tipine (types.ts) atanabilmeli; depo ayrıştırılmış kaydı bu
// tiplerle dağıtır. Tip iddiaları `pnpm typecheck` ile denetlenir (test dosyaları tsconfig kapsamında); çalışma zamanı
// iddiaları alan tiplerinin sözleşmedeki zorunluluğunu belgeler.
import { describe, expectTypeOf, it } from 'vitest';
import type { ParsedManifest, ParsedRecord } from './contract';
import type { BudgetObservation, CollectionName, Manifest, Term, WorkflowTransition } from './types';
import type { CollectionRecordMap } from './useGeneration';

type Assignable<K extends CollectionName> = [ParsedRecord<K>] extends [CollectionRecordMap[K]] ? true : false;
type RequiredKey<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? false : true;

describe('types ↔ contract', () => {
  it('her koleksiyonun ayrıştırılmış kaydı panelin kayıt tipine atanabilir', () => {
    expectTypeOf<{ [K in CollectionName]: Assignable<K> }>().toEqualTypeOf<{ [K in CollectionName]: true }>();
    expectTypeOf<ParsedManifest>().toExtend<Manifest>();
  });

  it('BudgetObservation.payment_evidence zorunlu boolean; sözleşme bugün yalnız false üretir', () => {
    expectTypeOf<RequiredKey<BudgetObservation, 'payment_evidence'>>().toEqualTypeOf<true>();
    expectTypeOf<BudgetObservation['payment_evidence']>().toEqualTypeOf<boolean>();
    expectTypeOf<ParsedRecord<'budget_observations'>['payment_evidence']>().toEqualTypeOf<false>();
    expectTypeOf<ParsedRecord<'budget_observations'>['value']['decimal']>().toEqualTypeOf<string>();
    expectTypeOf<ParsedRecord<'budget_observations'>['value']['currency']>().toEqualTypeOf<string | null>();
  });

  it('terim ve iş akışı geçişi sözleşmedeki zorunlu alanları taşır', () => {
    expectTypeOf<RequiredKey<Term, 'parent_id'>>().toEqualTypeOf<true>();
    expectTypeOf<RequiredKey<Term, 'legacy'>>().toEqualTypeOf<true>();
    expectTypeOf<WorkflowTransition['from_term_id']>().toEqualTypeOf<string>();
    expectTypeOf<WorkflowTransition['to_term_id']>().toEqualTypeOf<string>();
  });
});
