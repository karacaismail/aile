import { describe, expect, it, vi } from 'vitest';
import { runFinanceRefresh, type FinancePorts, type FinanceState } from './finance-runner';

function fixture() {
  let input = 'one'; let owner = 'old'; let gate = true;
  let state: FinanceState = { targetId: 'synthetic-book', config: {}, prior: 'old', committedFingerprint: 'zero' };
  const events: string[] = [];
  const ports: FinancePorts = {
    lock: () => true, unlock: vi.fn(), now: () => '2030-01-01T00:00:00.000Z',
    load: () => state, save: s => { state = s; },
    capture: () => ({ targetId: 'synthetic-book', input, owner }),
    owns: (s, prior) => { if (s.owner !== prior) throw Error('ownership'); },
    fingerprint: s => String(s.input),
    isFresh: () => gate,
    validateSources: () => {},
    compute: () => { events.push('compute'); return { prior: 'new', generation: 'generation-one', requests: [], gateFormula: '=TRUE' }; },
    closeGate: () => { gate = false; events.push('close'); },
    apply: () => { owner = 'new'; events.push('apply'); },
    openGate: () => { gate = true; events.push('open'); },
    verify: () => { if (!gate) throw Error('closed'); events.push('verify'); },
  };
  return { ports, events, state: () => state, gate: () => gate, input: (v:string) => { input=v; }, owner: (v:string) => { owner=v; } };
}

describe('automatic finance publication', () => {
  it('passes the already verified input fingerprint to calculation without rehashing the workbook', () => {
    const f=fixture();const compute=vi.fn(f.ports.compute);f.ports.compute=compute;
    expect(runFinanceRefresh(f.ports)).toBe('committed');
    expect(compute.mock.calls[0]?.[2]).toBe('one');
  });
  it('publishes one coherent generation and unchanged input performs no writes', () => {
    const f = fixture();
    expect(runFinanceRefresh(f.ports)).toBe('committed');
    expect(f.events).toEqual(['compute', 'close', 'apply', 'open', 'verify']);
    f.events.length = 0;
    expect(runFinanceRefresh(f.ports)).toBe('unchanged');
    expect(f.events).toEqual([]);
  });
  it('rejects a source edit during calculation before writing', () => {
    const f = fixture(); const compute = f.ports.compute;
    f.ports.compute = (...args) => { const c=compute(...args); f.input('two'); return c; };
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.events).toEqual(['compute']);
    expect(f.state().committedFingerprint).toBe('zero');
  });
  it('keeps publication closed after a post-write edit, then recovers on the next trigger', () => {
    const f=fixture(); const apply=f.ports.apply;
    f.ports.apply = (...args) => { apply(...args); f.input('two'); };
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.gate()).toBe(false);
    expect(f.state().pending).toBeDefined();
    f.ports.apply=apply;
    expect(runFinanceRefresh(f.ports)).toBe('committed');
    expect(f.state().committedFingerprint).toBe('two');
  });
  it('recovers a request that committed but timed out without accepting a manual output edit', () => {
    const f=fixture(); const apply=f.ports.apply;
    f.ports.apply = (...args) => { apply(...args); throw Error('timeout'); };
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.gate()).toBe(false);
    f.owner('manual'); f.ports.apply=apply;
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.state().committedFingerprint).toBe('zero');
    expect(f.gate()).toBe(false);
  });
  it('does not run against another workbook and always releases its lock', () => {
    const f=fixture(); f.ports.capture=()=>({targetId:'other'});
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.events).toEqual([]);
    expect(f.ports.unlock).toHaveBeenCalledOnce();
  });
  it('closes the gate when native readback fails', () => {
    const f=fixture(); f.ports.verify=()=>{throw Error('native mismatch');};
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.gate()).toBe(false);
    expect(f.state().pending).toBeDefined();
  });
  it('retains recovery information if the final state commit fails', () => {
    const f=fixture(); const save=f.ports.save;
    f.ports.save=s=>{if(s.status==='committed')throw Error('storage unavailable');save(s);};
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.state().pending).toBeDefined();
    expect(f.state().committedFingerprint).toBe('zero');
    expect(f.gate()).toBe(false);
    f.ports.save=save;
    expect(runFinanceRefresh(f.ports)).toBe('committed');
  });
  it('recalculates formula-only source value changes when the native guard becomes stale', () => {
    const f=fixture();expect(runFinanceRefresh(f.ports)).toBe('committed');
    f.ports.isFresh=()=>false;f.events.length=0;
    expect(runFinanceRefresh(f.ports)).toBe('committed');
    expect(f.events).toContain('compute');
  });
  it('rejects a recalculated source dependency even when its entered formula is unchanged', () => {
    const f=fixture();f.ports.validateSources=()=>{throw Error('dependency changed');};
    expect(runFinanceRefresh(f.ports)).toBe('retry');
    expect(f.events).toEqual(['compute']);
  });
});
