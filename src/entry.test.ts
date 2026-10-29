import { expect, it } from 'vitest';
import { timelineEntryUrl } from './entry';

it('canonicalizes the public Timeline path without starting the budget route', () => {
  for (const path of ['/aile/timeline', '/aile/timeline/', '/aile/timeline/index.html']) expect(timelineEntryUrl(path, '/aile/')).toBe('/aile/#/timeline');
  expect(timelineEntryUrl('/aile/', '/aile/')).toBeNull();
  expect(timelineEntryUrl('/other/timeline/', '/aile/')).toBeNull();
});
