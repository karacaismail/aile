import { PURCHASE_CATEGORY_LABELS, type PurchaseCategory } from './purchaseCategoryOptions.ts';
export { PURCHASE_CATEGORIES, PURCHASE_CATEGORY_LABELS, type PurchaseCategory } from './purchaseCategoryOptions.ts';

export interface PurchaseCategoryNode {
  value: PurchaseCategory | `group:${string}`;
  label: string;
  children?: readonly PurchaseCategoryNode[];
}
const leaf = (value: PurchaseCategory, label = PURCHASE_CATEGORY_LABELS[value]): PurchaseCategoryNode => ({ value, label });
const group = (value: `group:${string}`, label: string, children: readonly PurchaseCategoryNode[]): PurchaseCategoryNode => ({ value, label, children });

/** Eski geniş kategoriler kendi yaprağı olarak kalır; kayıtlar adından yeniden sınıflandırılmaz. */
export const PURCHASE_CATEGORY_TREE: readonly PurchaseCategoryNode[] = [
  leaf('mobilya'), leaf('tekstil'), leaf('beyaz_esya'),
  group('group:mutfak', 'Mutfak', [
    group('group:kucuk_ev_aletleri', 'Küçük ev aletleri', [leaf('mutfak_kahve'), leaf('mutfak_kucuk_ev_aleti')]),
    leaf('mutfak_pisirme'), leaf('mutfak_sofra'), leaf('mutfak', 'Diğer mutfak eşyaları'),
  ]),
  group('group:elektrik', 'Elektrik ve aydınlatma', [
    group('group:aydinlatma', 'Aydınlatma', [leaf('aydinlatma_led'), leaf('aydinlatma_akilli')]),
    leaf('elektrik_kablolama'), leaf('elektrik_kontrol'), leaf('elektrik', 'Diğer elektrik malzemesi'),
  ]),
  group('group:duzenleme', 'Düzenleme ve saklama', [leaf('duzenleme_cekmece'), leaf('duzenleme_balkon'), leaf('duzenleme')]),
  leaf('calisma_elektronigi'),
  group('group:banyo_temizlik', 'Banyo ve temizlik', [leaf('banyo_wc'), leaf('temizlik')]),
  leaf('guvenlik'), leaf('kopek'), leaf('bebek'),
  group('group:tadilat', 'Tadilat', [leaf('boya'), leaf('iscilik')]),
  group('group:hizmet_masraf', 'Hizmet ve masraflar', [leaf('masraf'), leaf('hizmet'), leaf('idari')]),
  leaf('diger'),
];

const valuesByNode = new Map<string, readonly PurchaseCategory[]>();
function indexNode(node: PurchaseCategoryNode): readonly PurchaseCategory[] {
  const values = node.children ? node.children.flatMap(indexNode) : [node.value as PurchaseCategory];
  valuesByNode.set(node.value, values);
  return values;
}
PURCHASE_CATEGORY_TREE.forEach(indexNode);

/** Ebeveyn seçimi de mevcut kategori filtresine yalnız kalıcı yaprak kodlarını verir. */
export function categoryValues(value: string): readonly PurchaseCategory[] { return valuesByNode.get(value) ?? []; }
export function categorySelection(selected: readonly string[], value: string): 'none' | 'mixed' | 'all' {
  const values = categoryValues(value);
  const count = values.filter(v => selected.includes(v)).length;
  return count === 0 ? 'none' : count === values.length ? 'all' : 'mixed';
}
export function toggleCategorySelection(selected: readonly string[], value: string): string[] {
  const values = categoryValues(value);
  return [...new Set(categorySelection(selected, value) === 'all' ? selected.filter(v => !values.includes(v as PurchaseCategory)) : [...selected, ...values])];
}
/** optionCounts'in diğer facetlerle daralttığı yaprak sayıları; her kayıt tek yaprakta sayılır. */
export function categoryCount(counts: ReadonlyMap<string, number>, value: string): number {
  return categoryValues(value).reduce((sum, leafValue) => sum + (counts.get(leafValue) ?? 0), 0);
}
