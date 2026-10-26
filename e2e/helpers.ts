import type { Page } from '@playwright/test';
import fixture from './fixtures/synthetic.json' with { type: 'json' };

export const FAKE_API = 'https://script.google.com/macros/s/e2e-fake/exec';

export type MockData = { items: Array<Record<string, unknown>>; settings: Array<Record<string, unknown>> };

/** Sahte API (bellekte kalıcı): read → mevcut durum, batch → upsert/delete uygulanır, health → ok. localStorage'a adres yazılır. */
export async function mockApi(page: Page, data: MockData = fixture) {
  const state = { items: structuredClone(data.items), settings: structuredClone(data.settings), rev: 1 };
  await page.addInitScript((url) => {
    localStorage.setItem('aile:apiUrl', url);
    localStorage.setItem('aile:actor', 'e2e');
  }, FAKE_API);
  await page.route('**/macros/s/**', async (route) => {
    const body = route.request().postData() ?? '{}';
    let req: { action?: string; fingerprint?: string; ops?: Array<{ id: string; op: string; table: string; patch?: Record<string, unknown> }> } = {};
    try { req = JSON.parse(body); } catch { /* yok say */ }
    const now = new Date().toISOString();
    const fp = () => `fx-${state.rev}`;
    if (req.action === 'health') return route.fulfill({ json: { ok: true, app: 'aile', schemaVersion: 1, serverTime: now, warnings: [] } });
    if (req.action === 'batch') {
      const results = (req.ops ?? []).map((o) => {
        const list = o.table === 'ayarlar' ? state.settings : state.items;
        let row = list.find((r) => r.id === o.id);
        if (o.op === 'upsert') {
          if (!row) { row = { id: o.id, created_at: now, version: 0 }; list.push(row); }
          for (const [k, v] of Object.entries(o.patch ?? {})) { if (v === null || v === '') delete row[k]; else row[k] = v; }
        } else if (row) {
          if (o.op === 'delete') row.deleted_at = now; else delete row.deleted_at;
        } else {
          return { ok: false, id: o.id, error: 'not_found' };
        }
        row.version = Number(row.version ?? 0) + 1; row.updated_at = now; row.updated_by = 'e2e';
        return { ok: true, id: o.id, row: { ...row } };
      });
      state.rev++;
      const failIdx = results.findIndex((r) => !r.ok);
      return route.fulfill({ json: { ok: failIdx < 0, doneCount: failIdx < 0 ? results.length : failIdx, fingerprint: fp(), serverTime: now, results, error: failIdx < 0 ? undefined : 'not_found' } });
    }
    if (req.fingerprint && req.fingerprint === fp()) return route.fulfill({ json: { ok: true, notModified: true, fingerprint: fp(), serverTime: now, schemaVersion: 1 } });
    return route.fulfill({ json: { ok: true, fingerprint: fp(), serverTime: now, schemaVersion: 1, items: state.items, settings: state.settings } });
  });
}

export const ROUTES = ['#/satinalma', '#/aydinlatma', '#/tadilat', '#/yerlesim', '#/ayarlar'];

/** Yatay taşma: sayfa ve tüm kaydırma kapsayıcıları. */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) bad.push(`document ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue; // bilinçli yatay kaydırıcı
      if (el.hasAttribute('data-allow-overflow')) continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'hidden' && cs.overflowX !== 'clip' && cs.overflow !== 'hidden') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
      }
    }
    return bad.slice(0, 10);
  });
}

/**
 * Görünür etkileşimli öğelerin dokunma hedefleri (≥44×44). Görünmez native input'lar (Switch, Chip, SegmentedControl, Checkbox)
 * dokunulan görünür kutuyla ölçülür; metin girişinin `label[for]` etiketi hedef sayılmaz (girişin kendisi ölçülür).
 */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, [role=button], [role=checkbox], [role=switch], [role=tab], [role=link], [role=radio], .mantine-SegmentedControl-label, label[for]';
    const isNativeToggle = (el: Element | null): el is HTMLInputElement =>
      !!el && el.tagName === 'INPUT' && ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio');
    const labelFor = (el: Element): HTMLElement | null => (el.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`) : null);
    /** Native kutucuk/radyo (çoğu görsel olarak gizli): dokunulan kutu. */
    const toggleTarget = (input: HTMLInputElement): HTMLElement => {
      if (input.closest('.mantine-Switch-root')) return input.closest<HTMLElement>('.mantine-Switch-body') ?? labelFor(input) ?? input;
      if (input.closest('.mantine-SegmentedControl-root') || input.closest('.mantine-Chip-root')) return labelFor(input) ?? input;
      return input.closest<HTMLElement>('label') ?? input.closest<HTMLElement>('.mantine-Checkbox-root') ?? labelFor(input) ?? input.parentElement ?? input;
    };
    const targetOf = (el: HTMLElement): HTMLElement | null => {
      if (el.tagName === 'LABEL' && el.hasAttribute('for')) {
        const ctrl = document.getElementById(el.getAttribute('for') ?? '');
        return isNativeToggle(ctrl) ? toggleTarget(ctrl) : null;
      }
      return isNativeToggle(el) ? toggleTarget(el) : el;
    };
    const out: string[] = [];
    const seen = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('[data-inline-link]') || el.hasAttribute('data-inline-link')) continue;
      const target = targetOf(el);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (cs.opacity === '0' || (cs.position === 'absolute' && cs.clip !== 'auto' && cs.clip !== '')) continue; // sarmalayıcısız, görsel olarak gizli
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) {
        const name = el.getAttribute('aria-label') ?? (target.textContent || el.textContent || '').trim().slice(0, 20);
        out.push(`${el.tagName.toLowerCase()}[${name}] ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out.slice(0, 12);
  });
}
