import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { gviz } from '../src/dashboard/fixtures';
import { financeWireResponseTable, syntheticJourneyFinance } from '../src/finance/fixtures';

// Two consecutive steps on the same day are the tightest boundary. The line and
// breathing room supplement the surface hierarchy: neither colour nor shadow alone.
// At 1424px the wide page's flow container reaches 48em; exercise its neighbours.
for (const [width, height] of [[320, 740], [360, 800], [375, 812], [390, 844], [667, 375], [768, 1024], [1423, 900], [1424, 900], [1425, 900], [1440, 900]] as const) {
  test(`step and source boundaries remain readable at ${width}`, async ({ page }, testInfo) => {
    await page.route('**/gviz/tq?*', route => {
      const wire = financeWireResponseTable(route.request().url(), syntheticJourneyFinance());
      return route.fulfill({ contentType: 'application/json', body: gviz(wire.rows, wire.labels) });
    });
    await page.setViewportSize({ width, height });
    await page.goto('/aile/#/timeline');
    await expect(page.getByRole('article')).toHaveCount(7);
    await page.evaluate(() => document.fonts.ready);
    const first = page.getByRole('article', { name: /^1\. adım/ });
    if (width === 320) {
      const amount = await first.locator('.timeline-purchase-amount dd').boundingBox();
      expect(amount!.y + amount!.height, 'the first amount stays in the initial viewport').toBeLessThanOrEqual(height);
    }
    await first.locator('.timeline-step-links').evaluate(el => el.scrollIntoView({ block: 'center' }));
    if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`boundary-${width}.png`) });
    const measured = await page.evaluate(() => {
      const lum = (color: string) => {
        const c = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      };
      const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
      const surfaceOf = (node: Element | null): string => { while (node) { const color = getComputedStyle(node).backgroundColor; if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color; node = node.parentElement; } return 'rgb(255, 255, 255)'; };
      const [first, next] = [...document.querySelectorAll<HTMLElement>('.timeline-step')];
      const [day, nextDay] = [...document.querySelectorAll<HTMLElement>('.timeline-day')];
      const dayRule = getComputedStyle(nextDay, '::before');
      const dayBottom = day.getBoundingClientRect().bottom, nextDayTop = nextDay.getBoundingClientRect().top;
      const dayRuleTop = nextDayTop + parseFloat(dayRule.top), dayRuleHeight = parseFloat(dayRule.height);
      const firstBox = first.getBoundingClientRect(), nextBox = next.getBoundingClientRect();
      const divider = getComputedStyle(next, '::before'), surface = getComputedStyle(document.querySelector('.timeline-journey')!).backgroundColor;
      const ruleTop = nextBox.top + parseFloat(divider.top), ruleHeight = parseFloat(divider.height);
      const source = first.querySelector<HTMLElement>('[data-step-part="source"]')!, sourceStyle = getComputedStyle(source);
      const sourceBox = source.getBoundingClientRect(), accounts = first.querySelector<HTMLElement>('.timeline-account-breakdown')!;
      const result = first.querySelector<HTMLElement>('.timeline-result')!;
      const smallText = [...first.querySelectorAll('*')].filter(el => el.textContent?.trim() && el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 14).length;
      return {
        stepGap: nextBox.top - firstBox.bottom,
        dayGap: nextDayTop - dayBottom,
        dayDivider: dayRule.content !== 'none' && dayRuleHeight >= 1 && dayRuleTop > dayBottom && dayRuleTop + dayRuleHeight < nextDayTop,
        dayDividerContrast: dayRule.content === 'none' ? 0 : contrast(dayRule.backgroundColor, surface),
        dividerVisible: divider.content !== 'none' && ruleHeight >= 1 && ruleTop > firstBox.bottom && ruleTop + ruleHeight < nextBox.top,
        dividerContrast: divider.content === 'none' ? 0 : contrast(divider.backgroundColor, surface),
        stepShadow: getComputedStyle(next).boxShadow,
        sourceRule: parseFloat(sourceStyle.borderTopWidth), sourceRuleContrast: contrast(sourceStyle.borderTopColor, surfaceOf(source)),
        sourceSpacing: parseFloat(sourceStyle.paddingTop), sourceAfterAccounts: sourceBox.top >= accounts.getBoundingClientRect().bottom,
        resultToAccounts: accounts.getBoundingClientRect().top - result.getBoundingClientRect().bottom,
        smallText, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    const measurementsPath = testInfo.outputPath('measurements.json');
    await writeFile(measurementsPath, JSON.stringify({ width, height, browser: testInfo.project.name, ...measured }, null, 2));
    await testInfo.attach('boundary-measurements', { path: measurementsPath, contentType: 'application/json' });
    expect.soft(measured.stepGap, 'separate steps need a clear reading pause').toBeGreaterThanOrEqual(40);
    expect.soft(measured.dividerVisible, 'a divider occupies the gap, not a card edge').toBe(true);
    expect.soft(measured.dividerContrast, 'the inter-step divider is distinguishable from the canvas').toBeGreaterThanOrEqual(3);
    expect.soft(measured.stepShadow).not.toBe('none');
    expect.soft(measured.dayGap, 'a new date gets more space than another step on the same day').toBeGreaterThanOrEqual(48);
    expect.soft(measured.dayDivider).toBe(true);
    expect.soft(measured.dayDividerContrast).toBeGreaterThanOrEqual(3);
    expect.soft(measured.sourceRule, 'the account section ends before provenance begins').toBeGreaterThanOrEqual(1);
    expect.soft(measured.sourceRuleContrast).toBeGreaterThanOrEqual(3);
    expect.soft(measured.sourceSpacing).toBeGreaterThanOrEqual(16);
    expect.soft(measured.sourceAfterAccounts).toBe(true);
    expect.soft(measured.resultToAccounts, 'separate the outcome from its account breakdown').toBeGreaterThanOrEqual(20);
    expect.soft(measured.smallText).toBe(0);
    expect.soft(measured.overflow).toBe(false);
    const transfer = page.getByRole('article', { name: /^2\. adım/ });
    for (const part of ['facts', 'after', 'accounts', 'source']) await expect(transfer.locator(`[data-step-part="${part}"]`)).toBeVisible();
    if (width === 320 || width === 1440) {
      await transfer.locator('.timeline-result').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: testInfo.outputPath(`sections-${width}.png`) });
      await transfer.locator('.timeline-step-links').evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`day-boundary-${width}.png`) });
    }
  });
}
