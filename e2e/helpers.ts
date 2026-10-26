import type { Page } from '@playwright/test';
import fixture from './fixtures/synthetic.json' with { type: 'json' };

export const FAKE_API = 'https://script.google.com/macros/s/e2e-fake/exec';

/** Sahte API (bellekte kalıcı): read → mevcut durum, batch → upsert/delete uygulanır, health → ok. localStorage'a adres yazılır. */
export async function mockApi(page: Page, data: typeof fixture = fixture) {
  const state = { items: structuredClone(data.items) as Array<Record<string, unknown>>, settings: structuredClone(data.settings) as Array<Record<string, unknown>>, rev: 1 };
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

/** Görünür etkileşimli öğelerin dokunma hedefleri (≥44×44). */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, [role=button], [role=checkbox], [role=switch], [role=tab], [role=link], [role=radio]';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('[data-inline-link]') || el.hasAttribute('data-inline-link')) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (cs.opacity === '0' || cs.position === 'absolute' && (cs.clip !== 'auto' && cs.clip !== '') ) continue; // görsel olarak gizli native input
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      // Görünmez native input'lar (Mantine Checkbox/Switch) sarmalayıcı etiketle ölçülür
      let target: HTMLElement = el;
      if ((el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') || el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'radio') {
        target = el.closest('label') ?? el.parentElement ?? el;
      }
      const tr = target.getBoundingClientRect();
      if (tr.width < 44 - 0.5 || tr.height < 44 - 0.5) {
        out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? ''}] ${Math.round(tr.width)}x${Math.round(tr.height)}`);
      }
    }
    return out.slice(0, 12);
  });
}
