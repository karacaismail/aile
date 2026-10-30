import {runFinanceRefresh} from '../src/finance-runner.ts';
import {computeFinance} from '../../finance-engine/compute.mjs';
import {buildCandidate} from '../../finance-sync/candidate.mjs';
import {assertRefreshOwnership, compactOwnership, inputFingerprint} from '../../finance-sync/ownership.mjs';
import {verifyReadback} from '../../finance-sync/readback.mjs';
import {validateCandidateSource} from '../../finance-sync/preflight.mjs';
import {grid, value} from '../../finance-engine/cells.mjs';
import {DurableStateStore, sha256} from './state-store.mjs';
import {FinanceSheetRepository} from './sheet-repository.mjs';
import {HANDLERS, ensureTriggers} from './triggers.mjs';
import {measurePhase} from './timing.mjs';
import {sheetsApi} from './sheets-api.mjs';

export {DurableStateStore, FinanceSheetRepository};
const ENGINE_REV = typeof __FINANCE_ENGINE_REV__ === 'string' ? __FINANCE_ENGINE_REV__ : 'development';
const properties = () => PropertiesService.getScriptProperties();
const stateStore = () => new DurableStateStore({properties: properties(), utilities: Utilities});
const sheetRepository = () => new FinanceSheetRepository({
  spreadsheets: sheetsApi({fetch: (url, options) => UrlFetchApp.fetch(url, options), token: () => ScriptApp.getOAuthToken()}),
  flush: () => SpreadsheetApp.flush(),
});
export const hash = text => sha256(Utilities, text);
// Preserve the existing maintenance/test entry points; services are resolved on call.
export const load = () => stateStore().load();
export const save = state => stateStore().save(state);
export const capture = state => sheetRepository().capture(state);
export const ensureFinanceTriggers = targetId => ensureTriggers(targetId, {scriptApp: ScriptApp, properties: properties()});

function createCandidate(source, state, sourceHash) {
  const now = new Date().toISOString();
  const computed = computeFinance({source, config: state.config.compute, hash, sourceHash, now});
  const native = buildCandidate({source, config: state.config, prior: state.prior, computed, hash, now});
  const control = native.financeManifest.sheets.find(s => s.title === '_Finans kontrol');
  const gateFormula = native.financeManifest.cells.find(c => c.sheetId === control.sheetId && c.row === 1 && c.column === 1)?.entered.formulaValue;
  if (!gateFormula) throw Error('Yeni hesap kaynak koruması eksik.');
  // Keep the gate closed even if a generated rectangle includes B2.
  const requests = JSON.parse(JSON.stringify(native.requests));
  for (const request of requests) {
    const u = request.updateCells;
    if (!u || u.range.sheetId !== control.sheetId) continue;
    const r = 1 - u.range.startRowIndex, c = 1 - u.range.startColumnIndex;
    if (u.rows?.[r]?.values?.[c]) u.rows[r].values[c].userEnteredValue = {boolValue: false};
  }
  return {native, prior: compactOwnership(native, {hash}), generation: native.generationHash, requests, gateFormula};
}

function ports() {
  const lock = LockService.getScriptLock(), store = stateStore(), repository = sheetRepository();
  return {
    lock: () => lock.tryLock(1000), unlock: () => lock.releaseLock(), now: () => new Date().toISOString(),
    load: () => { const state = store.load(); return {...state, config: {...state.config, engineHash: ENGINE_REV}}; },
    save: state => store.save(state), capture: state => repository.capture(state),
    owns: (source, prior) => measurePhase('owns', () => assertRefreshOwnership(source, prior, {hash})),
    fingerprint: (source, state) => inputFingerprint({source, config: state.config, prior: state.prior, hash}),
    isFresh: source => value(grid(source, '_Finans kontrol')[1]?.[1]) === true,
    validateSources: (candidate, source, phase) => {
      const {failures} = validateCandidateSource(candidate.native, source, {phase});
      if (failures.length) throw Error('Kaynak değişikliği: ' + JSON.stringify(failures.slice(0, 5)));
    },
    compute: (source, state, sourceHash) => measurePhase('compute', () => createCandidate(source, state, sourceHash)),
    closeGate: state => repository.gate(state, {boolValue: false}),
    apply: (candidate, state) => repository.apply(candidate, state),
    openGate: (candidate, state) => repository.gate(state, {formulaValue: candidate.gateFormula}),
    verify: (candidate, source) => {
      const result = verifyReadback(candidate.native, source, {hash});
      if (result.failures.length) throw Error('Native doğrulama: ' + JSON.stringify(result.failures.slice(0, 5)));
    },
  };
}

export function financeTimer() {
  const result = runFinanceRefresh(ports());
  console.log(JSON.stringify({result}));
  return result;
}
export function financeEdited(event) {
  if (event?.source?.getId() !== load().targetId) return 'ignored';
  return financeTimer();
}
export function financeChanged(event) {
  // An ordinary edit already has its own immediate ON_EDIT handler.
  if (event?.changeType === 'EDIT') return 'ignored';
  if (event?.source?.getId() !== load().targetId) return 'ignored';
  return financeTimer();
}
export function financeStatus() {
  const s = load();
  const status = {status: s.status ?? 'ready', checkedAt: s.checkedAt ?? null, generation: s.generation ?? null,
    pending: !!s.pending, error: s.lastError ?? null, triggers: ScriptApp.getProjectTriggers()
      .filter(t => HANDLERS.includes(t.getHandlerFunction())).map(t => ({handler: t.getHandlerFunction(), type: String(t.getEventType())}))};
  console.log(JSON.stringify(status));
  return status;
}

/** Called once from a private, reviewed bootstrap; never exposed as a web app. */
export function installFinance(config, prior) {
  if (!config?.targetSpreadsheetId || config.targetSpreadsheetId !== prior?.targetSpreadsheetId) throw Error('Açık hedef ve sahiplik eşleşmesi gerekli.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw Error('Finans otomasyonu meşgul.');
  try {
    const store = stateStore(), state = {targetId: config.targetSpreadsheetId, config, prior};
    const source = capture(state);
    measurePhase('owns', () => assertRefreshOwnership(source, prior, {hash}));
    const existing = store.load({optional: true});
    if (existing && existing.targetId !== state.targetId) throw Error('Farklı bütçe için ayrı betik projesi kurun.');
    if (existing?.pending) throw Error('Bekleyen hesap tamamlanmadan kurulum değiştirilemez.');
    store.save(existing ? {...existing, config, prior, committedFingerprint: undefined} : state);
    ensureFinanceTriggers(state.targetId);
  } finally { lock.releaseLock(); }
  return financeTimer();
}
