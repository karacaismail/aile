import { gviz } from './fixtures';
// Synthetic source metadata only; never copy a personal Sheet here.
export const syntheticBridgeMetadata = () => [
  ['finance-bridge-v1'], ['TRUE'], ['TRUE'], ['a'.repeat(64)],
  ['Koşullu hesap'], ['Örnek kaynak kapsamı; gerçekleşmiş ödeme değildir.'], ['3'],
];
export const syntheticBridgeInflows = () => ({
  labels: ['Ay', 'Plan finansman ve iç aktarım', 'Güncel finansman ve iç aktarım'],
  rows: [['2098-11', 500, 700], ['2098-12', 0, 0], ['2099-01', 100, 200]],
});
export function syntheticBridgeResponse(url: string, fresh = true): string | undefined {
  const params = new URL(url).searchParams;
  if (params.get('sheet') !== '_Web verisi' || !params.get('range')?.startsWith('AN')) return;
  if (params.get('range') === 'AN10:AP36') {
    const table = syntheticBridgeInflows();
    return gviz(table.rows, table.labels);
  }
  const metadata = syntheticBridgeMetadata();
  if (!fresh) metadata[1][0] = 'FALSE';
  return gviz(metadata);
}
