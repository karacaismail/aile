/** Kalıcı değerler tek kategori sütununa yazılır; group: kimlikleri yalnız seçim gruplarıdır. */
export const PURCHASE_CATEGORIES = [
  'mobilya', 'tekstil', 'beyaz_esya', 'mutfak', 'aydinlatma_akilli', 'aydinlatma_led', 'elektrik', 'iscilik',
  'boya', 'guvenlik', 'kopek', 'bebek', 'masraf', 'hizmet', 'idari', 'diger',
  'elektrik_kablolama', 'elektrik_kontrol', 'duzenleme', 'duzenleme_cekmece', 'duzenleme_balkon',
  'calisma_elektronigi', 'mutfak_kucuk_ev_aleti', 'mutfak_kahve', 'mutfak_pisirme', 'mutfak_sofra', 'banyo_wc', 'temizlik',
] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

export const PURCHASE_CATEGORY_LABELS: Record<PurchaseCategory, string> = {
  mobilya: 'Mobilya', tekstil: 'Tekstil', beyaz_esya: 'Beyaz eşya', mutfak: 'Mutfak',
  aydinlatma_akilli: 'Akıllı aydınlatma', aydinlatma_led: 'LED / armatür', elektrik: 'Elektrik malzemesi',
  iscilik: 'İşçilik', boya: 'Boya', guvenlik: 'Güvenlik', kopek: 'Köpek', bebek: 'Bebek',
  masraf: 'Masraf', hizmet: 'Hizmet', idari: 'İdari', diger: 'Diğer',
  elektrik_kablolama: 'Kablo ve tesisat', elektrik_kontrol: 'Anahtar, priz ve kontrol',
  duzenleme: 'Genel düzenleyiciler', duzenleme_cekmece: 'Çekmece düzenleyicileri', duzenleme_balkon: 'Balkon düzenleyicileri',
  calisma_elektronigi: 'Çalışma alanı elektroniği', mutfak_kucuk_ev_aleti: 'Diğer küçük ev aletleri',
  mutfak_kahve: 'Kahve ve espresso ekipmanı', mutfak_pisirme: 'Tencere, tava ve pişirme', mutfak_sofra: 'Sofra ve servis',
  banyo_wc: 'Banyo ve WC gereçleri', temizlik: 'Temizlik gereçleri',
};

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
