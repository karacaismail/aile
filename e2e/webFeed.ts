/** One Sheet tab now carries every web feed. Mocks keep naming the feed, not the tab. */
export function feedName(url: URL): string | null {
  const sheet = url.searchParams.get('sheet');
  if (sheet !== '_Web verisi') return sheet;
  const range = url.searchParams.get('range') ?? '';
  if (range.startsWith('AN')) return '_Finans aylık';
  if (range.startsWith('V')) return '_Timeline web';
  return '_Finans web';
}
