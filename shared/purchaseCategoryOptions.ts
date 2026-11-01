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
