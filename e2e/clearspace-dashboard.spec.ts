import { test, expect, type Page } from '@playwright/test';
import { familyRoutes, mockFamilyRoutes } from './familyMocks';

/**
 * Clearspace kapısı (docs/CLEARSPACE.md): her rotada, gerçek yerleşimde
 * - hiçbir görünür kutunun köşesi 5 px'i aşmaz,
 * - hiçbir görünür metin 14 px'ten küçük değildir,
 * - dolu bir yüzeyin (kart, panel, şerit) içindeki metin ve görsel kenara 8 px'ten fazla yaklaşmaz.
 */
type Audit = { radius: string[]; font: string[]; inset: string[] };

async function audit(page: Page): Promise<Audit> {
  return page.locator('.aile-app').evaluate(root => {
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert], .mantine-Skeleton-root');
    };
    const elements = [...root.querySelectorAll('*')].filter(visible);
    const radius: string[] = [];
    const font: string[] = [];
    const inset: string[] = [];
    for (const el of elements) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) {
        const [x, y = x] = style[corner].split(' ');
        const size = (value: string, basis: number) => value.endsWith('%') ? parseFloat(value) / 100 * basis : parseFloat(value);
        const effective = Math.min(size(x, rect.width), size(y, rect.height), rect.width / 2, rect.height / 2);
        if (effective > 5.01) { radius.push(`${label(el)} ${corner} ${style[corner]}`); break; }
      }
      const ownText = [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (ownText && parseFloat(style.fontSize) < 14) font.push(`${label(el)} ${style.fontSize} "${el.textContent?.trim().slice(0, 30)}"`);
    }
    // A surface is a filled box that differs from what is behind it; controls and table parts carry their own inset.
    const background = (el: Element | null): string => {
      for (let node = el; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
      }
      return 'rgb(255, 255, 255)';
    };
    const skip = 'button, a, input, textarea, select, label, img, svg, canvas, table, thead, tbody, tr, th, td, [role="tab"], [role="option"], [role="switch"], .mantine-Input-input, .mantine-Chip-label, .mantine-Badge-root, .mantine-SegmentedControl-root, .mantine-Checkbox-input, .mantine-Switch-track';
    for (const surface of elements) {
      if (surface.matches(skip) || surface.closest('button, a, label')) continue;
      const own = getComputedStyle(surface).backgroundColor;
      if (!own || own === 'transparent' || /rgba\(.*,\s*0\)$/.test(own) || own === background(surface.parentElement)) continue;
      const box = surface.getBoundingClientRect();
      if (box.width < 120 || box.height < 40) continue;
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let rects: DOMRect[] = [];
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.textContent?.trim() || !node.parentElement || !visible(node.parentElement)) continue;
          const range = document.createRange(); range.selectNodeContents(node); rects = [...range.getClientRects()];
        } else if ((node as Element).matches('img') && visible(node as Element)) rects = [(node as Element).getBoundingClientRect()];
        for (const r of rects) {
          // Content scrolled past the edge belongs to its scroll container, not to the surface inset.
          if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) continue;
          const gap = Math.min(r.left - box.left, box.right - r.right, r.top - box.top, box.bottom - r.bottom);
          if (gap < 7.5) { inset.push(`${label(surface)} ↔ "${(node.textContent ?? '').trim().slice(0, 24) || label(node as Element)}" ${gap.toFixed(1)}px`); break; }
        }
        if (inset.at(-1)?.startsWith(label(surface))) break;
      }
    }
    return { radius: [...new Set(radius)], font: [...new Set(font)], inset: [...new Set(inset)] };
  });
}

for (const route of familyRoutes) {
  test(`clearspace, radius and text floor hold on ${route}`, async ({ page }) => {
    await mockFamilyRoutes(page);
    await page.goto(`/aile/#${route}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const result = await audit(page);
    expect(result.radius, 'köşe > 5 px').toEqual([]);
    expect(result.font, 'yazı < 14 px').toEqual([]);
    expect(result.inset, 'dolu yüzeyde içerik kenara 8 px’ten yakın').toEqual([]);
  });
}
