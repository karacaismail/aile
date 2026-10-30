/** One synchronous Apps Script invocation. No browser mutation endpoint. */
export interface FinanceSnapshot { targetId: string; [key: string]: unknown }
export interface FinanceCandidate {
  prior: unknown;
  generation: string;
  requests: unknown[];
  gateFormula: string;
  [key: string]: unknown;
}
export interface FinanceState {
  targetId: string;
  config: unknown;
  prior: unknown;
  committedFingerprint?: string;
  generation?: string;
  pending?: { fingerprint: string; prior: unknown; generation: string };
  status?: 'running' | 'committed' | 'retry';
  checkedAt?: string;
  lastError?: string;
}
export interface FinancePorts {
  lock(): boolean;
  unlock(): void;
  now(): string;
  load(): FinanceState;
  save(state: FinanceState): void;
  capture(state: FinanceState): FinanceSnapshot;
  owns(source: FinanceSnapshot, prior: unknown): void;
  fingerprint(source: FinanceSnapshot, state: FinanceState): string;
  isFresh(source: FinanceSnapshot): boolean;
  validateSources(candidate: FinanceCandidate, source: FinanceSnapshot, phase: 'before' | 'after'): void;
  compute(source: FinanceSnapshot, state: FinanceState, fingerprint: string): FinanceCandidate;
  closeGate(state: FinanceState): void;
  apply(candidate: FinanceCandidate, state: FinanceState): void;
  openGate(candidate: FinanceCandidate, state: FinanceState): void;
  verify(candidate: FinanceCandidate, source: FinanceSnapshot): void;
}

export function runFinanceRefresh(p: FinancePorts): 'busy' | 'unchanged' | 'committed' | 'retry' {
  if (!p.lock()) return 'busy';
  let state: FinanceState | undefined;
  let publicationStarted = false;
  try {
    state = p.load();
    const capture = () => {
      const snapshot = p.capture(state!);
      if (snapshot.targetId !== state!.targetId) throw new Error('Hedef bütçe dosyası eşleşmiyor.');
      return snapshot;
    };
    const source = capture();
    // A timed-out atomic batch either wrote the complete new ownership or none of it.
    // Do not accept arbitrary mixtures: those can be user edits, not recovery data.
    if (state.pending) {
      try { p.owns(source, state.pending.prior); state = { ...state, prior: state.pending.prior }; }
      catch { p.owns(source, state.prior); }
    } else p.owns(source, state.prior);
    const fingerprint = p.fingerprint(source, state);
    if (!state.pending && fingerprint === state.committedFingerprint && p.isFresh(source)) return 'unchanged';
    const candidate = p.compute(source, state, fingerprint);
    const fresh = capture();
    p.owns(fresh, state.prior);
    p.validateSources(candidate, fresh, 'before');
    if (p.fingerprint(fresh, state) !== fingerprint) throw new Error('Hesaplama sırasında kaynak değişti; yeniden hesaplanacak.');
    state = { ...state, pending: { fingerprint, prior: candidate.prior, generation: candidate.generation }, status: 'running', checkedAt: p.now(), lastError: undefined };
    p.save(state); // Durable recovery information precedes the first output write.
    publicationStarted = true;
    p.closeGate(state);
    p.apply(candidate, state);
    const written = capture();
    p.owns(written, candidate.prior);
    p.validateSources(candidate, written, 'after');
    if (p.fingerprint(written, { ...state, prior: candidate.prior }) !== fingerprint) throw new Error('Yazım sırasında kaynak değişti; sonuç kapalı tutuluyor.');
    p.openGate(candidate, state);
    const verified = capture();
    p.owns(verified, candidate.prior);
    if (p.fingerprint(verified, { ...state, prior: candidate.prior }) !== fingerprint) throw new Error('Doğrulama sırasında kaynak değişti.');
    p.verify(candidate, verified);
    const committed: FinanceState = { ...state, prior: candidate.prior, pending: undefined, committedFingerprint: fingerprint, generation: candidate.generation, status: 'committed', checkedAt: p.now(), lastError: undefined };
    p.save(committed);
    return 'committed';
  } catch (error) {
    if (state) {
      if (publicationStarted || state.pending) p.closeGate(state);
      p.save({ ...state, status: 'retry', checkedAt: p.now(), lastError: error instanceof Error ? error.message : String(error) });
    }
    return 'retry';
  } finally { p.unlock(); }
}
