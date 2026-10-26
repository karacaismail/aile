// Canlı site doğrulaması: 320×480 ekran görüntüleri + bir kalemde gerçek yazma/geri alma turu.
// Kullanım: node scripts/live-check.mjs <siteUrl> <execUrl> <kalemAdıParçası> <çıktıKlasörü>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [site, exec, needle, outDir = '.tmp-shots'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

async function api(body) {
  const r = await fetch(exec, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  return r.json();
}
async function findItem() {
  const d = await api({ action: 'read' });
  return d.items.find((i) => i.tip === 'satinalma' && !i.deleted_at && i.ad.toLowerCase().includes(needle.toLowerCase()));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 320, height: 480 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'tr-TR' });
const page = await ctx.newPage();
for (const route of ['satinalma', 'aydinlatma', 'tadilat', 'yerlesim']) {
  await page.goto(`${site}#/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/${route}.png` });
}
// Yazma turu
const before = await findItem();
if (!before) { console.log('Kalem bulunamadı:', needle); await browser.close(); process.exit(1); }
console.log('önce:', before.ad, 'durum=', before.durum, 'version=', before.version);
await page.goto(`${site}#/satinalma`, { waitUntil: 'networkidle' });
const box = page.getByRole('checkbox', { name: new RegExp(before.ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' alındı') });
await box.scrollIntoViewIfNeeded();
await box.check();
await page.waitForTimeout(6000);
const mid = await findItem();
console.log('alındı sonrası:', 'durum=', mid.durum, 'version=', mid.version, 'updated_by=', mid.updated_by);
await box.uncheck();
await page.waitForTimeout(6000);
const after = await findItem();
console.log('geri alındı:', 'durum=', after.durum, 'version=', after.version);
await page.screenshot({ path: `${outDir}/satinalma-sonra.png` });
await browser.close();
console.log(mid.durum === 'teslim' && after.durum === 'karar' ? 'CANLI YAZMA OK' : 'CANLI YAZMA BEKLENMEDİK');
