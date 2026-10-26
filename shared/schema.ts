// Tek kaynak: sekme adları, sütunlar, enum'lar ve Türkçe etiketler.
// Hem uygulama (src), hem Apps Script (gas), hem tohumlama (scripts) buradan okur.

export const SHEETS = { items: 'app_kalemler', settings: 'app_ayarlar' } as const;
export const SCHEMA_VERSION = 1;

export const TIP = ['satinalma', 'aydinlatma', 'tadilat', 'yerlesim', 'usta', 'kontrol', 'sahne', 'kilometre'] as const;
export const ODA = ['salon', 'cocuk', 'ebeveyn', 'calisma', 'mutfak', 'banyo', 'wc', 'hol', 'balkon1', 'balkon2', 'genel'] as const;
export const KATEGORI = [
  'mobilya', 'tekstil', 'beyaz_esya', 'mutfak', 'aydinlatma_akilli', 'aydinlatma_led', 'elektrik', 'iscilik',
  'boya', 'guvenlik', 'kopek', 'bebek', 'masraf', 'hizmet', 'idari', 'diger',
] as const;
export const FAZ = ['1', '2', '3'] as const;
export const DURUM = ['fikir', 'arastirma', 'karar', 'siparis', 'teslim', 'kuruldu', 'iptal'] as const;
export const BIRIM = ['adet', 'm', 'rulo', 'set'] as const;
export const FIYAT_GUVEN = ['dogrulandi', 'tahmini', 'varsayim'] as const;
export const KATMAN_TUR = ['ana', 'ikincil', 'ucuncul', 'gorev', 'gece', 'dekoratif'] as const;
export const LUX_DUZLEM = ['yatay', 'dikey', 'yer'] as const;
export const CCT_MOD = ['sabit', 'secmeli', 'ayarli', 'rgb'] as const;
export const FLICKER = ['ff', 'bilinmiyor', 'kabul'] as const;
export const KONTROL_CIHAZ = ['hue_dimmer', 'hue_button', 'hue_motion', 'hue_wall_module', 'duvar_anahtari', 'lamba_dugmesi', 'smart_plug'] as const;
export const ADIM = ['kesif', 'elektrik', 'boya', 'profil', 'ampul', 'akilli', 'mobilya', 'ince_ayar'] as const;
export const KIM = ['E', 'B', 'M', 'K'] as const;
export const IS_KIM = ['elektrikci', 'boyaci', 'marangoz', 'nakliye', 'klimaci', 'internet', 'ev_sahibi', 'idari', 'ben'] as const;
export const IZIN_DURUMU = ['gerekmez', 'istenecek', 'istendi', 'alindi', 'reddedildi'] as const;
export const MESLEK = ['elektrik', 'boya', 'marangoz', 'nakliye', 'klima', 'internet', 'diger'] as const;
export const KONTROL_TUR = ['sartname', 'kabul', 'izin', 'ev_secimi'] as const;
export const TETIK = ['dugme', 'dimmer', 'sensor', 'zaman', 'plug'] as const;
export const SENARYO = ['A', 'B', 'C', 'hepsi'] as const;
export const KILOMETRE_TUR = ['tarih', 'bant', 'hedef', 'siparis'] as const;
export const DUVAR = ['K', 'G', 'D', 'B'] as const;
export const KOPEK_ERISIM = ['serbest', 'gece_kapali', 'kapali'] as const;

export type ColumnType = 'metin' | 'uzunmetin' | 'sayi' | 'tarih' | 'tarihsaat' | 'enum' | 'liste' | 'enumliste' | 'bool';

export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  group: string;
  enum?: readonly string[];
}

const c = (key: string, label: string, type: ColumnType, group: string, en?: readonly string[]): ColumnDef => ({ key, label, type, group, enum: en });

export const ITEM_COLUMNS: readonly ColumnDef[] = [
  // Kimlik
  c('id', 'Kimlik', 'metin', 'kimlik'),
  c('tip', 'Tip', 'enum', 'kimlik', TIP),
  c('kod', 'Kod', 'metin', 'kimlik'),
  // Ortak
  c('ad', 'Ad', 'metin', 'ortak'),
  c('oda', 'Oda', 'enum', 'ortak', ODA),
  c('kategori', 'Kategori', 'enum', 'ortak', KATEGORI),
  c('faz', 'Faz', 'enum', 'ortak', FAZ),
  c('durum', 'Durum', 'enum', 'ortak', DURUM),
  c('karar_bekliyor', 'Karar bekliyor', 'bool', 'ortak'),
  c('oncelik', 'Öncelik', 'sayi', 'ortak'),
  c('adet', 'Adet', 'sayi', 'ortak'),
  c('birim', 'Birim', 'enum', 'ortak', BIRIM),
  c('tahmini_tl_min', 'Tahmini TL (min)', 'sayi', 'ortak'),
  c('tahmini_tl_max', 'Tahmini TL (max)', 'sayi', 'ortak'),
  c('gercek_tl', 'Gerçek TL', 'sayi', 'ortak'),
  c('fiyat_guven', 'Fiyat güveni', 'enum', 'ortak', FIYAT_GUVEN),
  c('linkler', 'Linkler', 'liste', 'ortak'),
  c('not', 'Not', 'uzunmetin', 'ortak'),
  c('mevcut', 'Mevcut (elimizde)', 'bool', 'ortak'),
  c('bagli_idler', 'Bağlı kalemler', 'liste', 'ortak'),
  // Satınalma
  c('nereden', 'Nereden', 'metin', 'satinalma'),
  c('siparis_son_tarih', 'Sipariş son tarih', 'tarih', 'satinalma'),
  c('teslim_suresi_gun', 'Teslim süresi (gün)', 'sayi', 'satinalma'),
  c('teslim_tarihi', 'Teslim tarihi', 'tarih', 'satinalma'),
  c('odeme_tarihi', 'Ödeme tarihi', 'tarih', 'satinalma'),
  // Aydınlatma
  c('katman_tur', 'Katman türü', 'enum', 'aydinlatma', KATMAN_TUR),
  c('katman_ad', 'Katman adı', 'metin', 'aydinlatma'),
  c('amac', 'Amaç', 'metin', 'aydinlatma'),
  c('lux_min', 'Lux min', 'sayi', 'aydinlatma'),
  c('lux_max', 'Lux max', 'sayi', 'aydinlatma'),
  c('lux_duzlem', 'Lux düzlemi', 'enum', 'aydinlatma', LUX_DUZLEM),
  c('cct_mod', 'CCT modu', 'enum', 'aydinlatma', CCT_MOD),
  c('cct_min', 'CCT min (K)', 'sayi', 'aydinlatma'),
  c('cct_max', 'CCT max (K)', 'sayi', 'aydinlatma'),
  c('dim_min_pct', 'Dim min (%)', 'sayi', 'aydinlatma'),
  c('cri_min', 'CRI min', 'sayi', 'aydinlatma'),
  c('r9_min', 'R9 min', 'sayi', 'aydinlatma'),
  c('flicker', 'Flicker', 'enum', 'aydinlatma', FLICKER),
  c('kontrol_cihaz', 'Kontrol cihazı', 'enum', 'aydinlatma', KONTROL_CIHAZ),
  c('urun_sinifi', 'Ürün sınıfı', 'metin', 'aydinlatma'),
  c('uzunluk_m', 'Uzunluk (m)', 'sayi', 'aydinlatma'),
  c('w_per_m', 'W/m', 'sayi', 'aydinlatma'),
  c('surucu_model', 'Sürücü modeli', 'metin', 'aydinlatma'),
  c('surucu_w', 'Sürücü (W)', 'sayi', 'aydinlatma'),
  c('montaj_yukseklik_cm', 'Montaj yüksekliği (cm)', 'sayi', 'aydinlatma'),
  c('acikta', 'Açıkta', 'bool', 'aydinlatma'),
  c('adim', 'Adım', 'enum', 'aydinlatma', ADIM),
  c('kim', 'Kim (E/B/M/K)', 'enumliste', 'aydinlatma', KIM),
  // Tadilat / usta / kontrol / sahne / kilometre
  c('is_kim', 'İşi yapan', 'enumliste', 'tadilat', IS_KIM),
  c('planlanan_tarih', 'Planlanan tarih', 'tarih', 'tadilat'),
  c('bitis_tarihi', 'Bitiş tarihi', 'tarih', 'tadilat'),
  c('sure_gun', 'Süre (gün)', 'sayi', 'tadilat'),
  c('bagimlilik', 'Bağımlılık (kodlar)', 'liste', 'tadilat'),
  c('izin_gerekli', 'İzin gerekli', 'bool', 'tadilat'),
  c('izin_durumu', 'İzin durumu', 'enum', 'tadilat', IZIN_DURUMU),
  c('sartname', 'Şartname', 'uzunmetin', 'tadilat'),
  c('meslek', 'Meslek', 'enum', 'usta', MESLEK),
  c('telefon', 'Telefon', 'metin', 'usta'),
  c('myk_no', 'MYK no', 'metin', 'usta'),
  c('myk_dogrulandi', 'MYK doğrulandı', 'bool', 'usta'),
  c('teklif_tl', 'Teklif (TL)', 'sayi', 'usta'),
  c('teklif_sure_gun', 'Teklif süresi (gün)', 'sayi', 'usta'),
  c('garanti_ay', 'Garanti (ay)', 'sayi', 'usta'),
  c('uyum_pct', 'Şartname uyumu (%)', 'sayi', 'usta'),
  c('kontrol_tur', 'Kontrol türü', 'enum', 'kontrol', KONTROL_TUR),
  c('olcum_deger', 'Ölçüm değeri', 'sayi', 'kontrol'),
  c('olcum_birim', 'Ölçüm birimi', 'metin', 'kontrol'),
  c('esik', 'Eşik', 'metin', 'kontrol'),
  c('tamam', 'Tamam', 'bool', 'kontrol'),
  c('tetik', 'Tetik', 'enum', 'sahne', TETIK),
  c('seviyeler', 'Seviyeler (katman:pct:cct)', 'liste', 'sahne'),
  c('senaryo', 'Senaryo', 'enum', 'kilometre', SENARYO),
  c('kilometre_tur', 'Kilometre taşı türü', 'enum', 'kilometre', KILOMETRE_TUR),
  // Yerleşim
  c('en_cm', 'En (cm)', 'sayi', 'yerlesim'),
  c('boy_cm', 'Boy (cm)', 'sayi', 'yerlesim'),
  c('yuk_cm', 'Yükseklik (cm)', 'sayi', 'yerlesim'),
  c('duvar', 'Duvar', 'enum', 'yerlesim', DUVAR),
  c('x_cm', 'X (cm)', 'sayi', 'yerlesim'),
  c('y_cm', 'Y (cm)', 'sayi', 'yerlesim'),
  c('donus', 'Dönüş', 'sayi', 'yerlesim'),
  c('priz_ihtiyaci', 'Priz ihtiyacı', 'sayi', 'yerlesim'),
  c('isik_ihtiyaci', 'Işık ihtiyacı', 'metin', 'yerlesim'),
  c('kanal_m', 'Kanal (m)', 'sayi', 'yerlesim'),
  // Meta
  c('created_at', 'Oluşturma', 'tarihsaat', 'meta'),
  c('updated_at', 'Güncelleme', 'tarihsaat', 'meta'),
  c('deleted_at', 'Silinme', 'tarihsaat', 'meta'),
  c('updated_by', 'Güncelleyen', 'metin', 'meta'),
  c('version', 'Sürüm', 'sayi', 'meta'),
  c('son_op_id', 'Son işlem', 'metin', 'meta'),
  c('son_degisen_alanlar', 'Son değişen alanlar', 'liste', 'meta'),
];

export const SETTING_COLUMNS: readonly ColumnDef[] = [
  c('id', 'Kimlik', 'metin', 'kimlik'),
  c('tip', 'Tip', 'enum', 'kimlik', ['oda', 'tarih', 'liste', 'ayar', 'kolon'] as const),
  c('anahtar', 'Anahtar', 'metin', 'kimlik'),
  c('deger', 'Değer', 'uzunmetin', 'ortak'),
  c('etiket', 'Etiket', 'metin', 'ortak'),
  c('sira', 'Sıra', 'sayi', 'ortak'),
  c('not', 'Not', 'uzunmetin', 'ortak'),
  c('created_at', 'Oluşturma', 'tarihsaat', 'meta'),
  c('updated_at', 'Güncelleme', 'tarihsaat', 'meta'),
  c('deleted_at', 'Silinme', 'tarihsaat', 'meta'),
  c('updated_by', 'Güncelleyen', 'metin', 'meta'),
  c('version', 'Sürüm', 'sayi', 'meta'),
  c('son_op_id', 'Son işlem', 'metin', 'meta'),
  c('son_degisen_alanlar', 'Son değişen alanlar', 'liste', 'meta'),
];

export const ITEM_HEADERS = ITEM_COLUMNS.map((x) => x.key);
export const SETTING_HEADERS = SETTING_COLUMNS.map((x) => x.key);
export const META_KEYS = ['created_at', 'updated_at', 'deleted_at', 'updated_by', 'version', 'son_op_id', 'son_degisen_alanlar'] as const;
export const REQUIRED_ITEM_HEADERS = ['id', 'tip', 'ad', 'updated_at', 'version'] as const;
export const REQUIRED_SETTING_HEADERS = ['id', 'tip', 'anahtar', 'deger', 'updated_at', 'version'] as const;

export type Tip = (typeof TIP)[number];
export type Oda = (typeof ODA)[number];
export type Faz = (typeof FAZ)[number];
export type Durum = (typeof DURUM)[number];

/** Uygulama içi satır tipi: sütun anahtarı → değer (tipine göre number | string | boolean | string[]). */
export interface Item {
  id: string;
  tip: Tip;
  ad: string;
  kod?: string;
  oda?: Oda;
  kategori?: (typeof KATEGORI)[number];
  faz?: Faz;
  durum?: Durum;
  karar_bekliyor?: boolean;
  oncelik?: number;
  adet?: number;
  birim?: (typeof BIRIM)[number];
  tahmini_tl_min?: number;
  tahmini_tl_max?: number;
  gercek_tl?: number;
  fiyat_guven?: (typeof FIYAT_GUVEN)[number];
  linkler?: string[];
  not?: string;
  mevcut?: boolean;
  bagli_idler?: string[];
  nereden?: string;
  siparis_son_tarih?: string;
  teslim_suresi_gun?: number;
  teslim_tarihi?: string;
  odeme_tarihi?: string;
  katman_tur?: (typeof KATMAN_TUR)[number];
  katman_ad?: string;
  amac?: string;
  lux_min?: number;
  lux_max?: number;
  lux_duzlem?: (typeof LUX_DUZLEM)[number];
  cct_mod?: (typeof CCT_MOD)[number];
  cct_min?: number;
  cct_max?: number;
  dim_min_pct?: number;
  cri_min?: number;
  r9_min?: number;
  flicker?: (typeof FLICKER)[number];
  kontrol_cihaz?: (typeof KONTROL_CIHAZ)[number];
  urun_sinifi?: string;
  uzunluk_m?: number;
  w_per_m?: number;
  surucu_model?: string;
  surucu_w?: number;
  montaj_yukseklik_cm?: number;
  acikta?: boolean;
  adim?: (typeof ADIM)[number];
  kim?: string[];
  is_kim?: string[];
  planlanan_tarih?: string;
  bitis_tarihi?: string;
  sure_gun?: number;
  bagimlilik?: string[];
  izin_gerekli?: boolean;
  izin_durumu?: (typeof IZIN_DURUMU)[number];
  sartname?: string;
  meslek?: (typeof MESLEK)[number];
  telefon?: string;
  myk_no?: string;
  myk_dogrulandi?: boolean;
  teklif_tl?: number;
  teklif_sure_gun?: number;
  garanti_ay?: number;
  uyum_pct?: number;
  kontrol_tur?: (typeof KONTROL_TUR)[number];
  olcum_deger?: number;
  olcum_birim?: string;
  esik?: string;
  tamam?: boolean;
  tetik?: (typeof TETIK)[number];
  seviyeler?: string[];
  senaryo?: (typeof SENARYO)[number];
  kilometre_tur?: (typeof KILOMETRE_TUR)[number];
  en_cm?: number;
  boy_cm?: number;
  yuk_cm?: number;
  duvar?: (typeof DUVAR)[number];
  x_cm?: number;
  y_cm?: number;
  donus?: number;
  priz_ihtiyaci?: number;
  isik_ihtiyaci?: string;
  kanal_m?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
  updated_by?: string;
  version?: number;
  son_op_id?: string;
  son_degisen_alanlar?: string[];
}

export interface Setting {
  id: string;
  tip: 'oda' | 'tarih' | 'liste' | 'ayar' | 'kolon';
  anahtar: string;
  deger?: string;
  etiket?: string;
  sira?: number;
  not?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
  updated_by?: string;
  version?: number;
  son_op_id?: string;
  son_degisen_alanlar?: string[];
}

export const LABELS: Record<string, Record<string, string>> = {
  tip: { satinalma: 'Satınalma', aydinlatma: 'Aydınlatma', tadilat: 'Tadilat', yerlesim: 'Yerleşim', usta: 'Usta', kontrol: 'Kontrol', sahne: 'Sahne', kilometre: 'Kilometre taşı' },
  oda: { salon: 'Salon', cocuk: 'Çocuk odası', ebeveyn: 'Ebeveyn odası', calisma: 'Çalışma odası', mutfak: 'Mutfak', banyo: 'Banyo', wc: 'WC', hol: 'Hol / antre', balkon1: 'Balkon 1', balkon2: 'Balkon 2', genel: 'Genel' },
  kategori: { mobilya: 'Mobilya', tekstil: 'Tekstil', beyaz_esya: 'Beyaz eşya', mutfak: 'Mutfak', aydinlatma_akilli: 'Akıllı aydınlatma', aydinlatma_led: 'LED / armatür', elektrik: 'Elektrik malzemesi', iscilik: 'İşçilik', boya: 'Boya', guvenlik: 'Güvenlik', kopek: 'Köpek', bebek: 'Bebek', masraf: 'Masraf', hizmet: 'Hizmet', idari: 'İdari', diger: 'Diğer' },
  faz: { '1': 'Önce', '2': 'Yerleşme', '3': 'Bebek' },
  fazUzun: { '1': 'Taşınma öncesi (≤18 Şub)', '2': 'Yerleşme (19 Şub – Bayram)', '3': 'Bebek hazırlığı (Nis–Eyl)' },
  durum: { fikir: 'Fikir', arastirma: 'Araştırma', karar: 'Karar', siparis: 'Sipariş', teslim: 'Teslim', kuruldu: 'Kuruldu', iptal: 'İptal' },
  birim: { adet: 'adet', m: 'm', rulo: 'rulo', set: 'set' },
  fiyat_guven: { dogrulandi: 'Doğrulandı', tahmini: 'Tahmini', varsayim: 'Varsayım' },
  katman_tur: { ana: 'Ana', ikincil: 'İkincil', ucuncul: 'Üçüncül', gorev: 'Görev', gece: 'Gece', dekoratif: 'Dekoratif' },
  lux_duzlem: { yatay: 'Yatay', dikey: 'Dikey', yer: 'Yer' },
  cct_mod: { sabit: 'Sabit', secmeli: 'Seçmeli', ayarli: 'Ayarlı', rgb: 'RGB' },
  flicker: { ff: 'Flicker-free', bilinmiyor: 'Bilinmiyor', kabul: 'Kabul (dekoratif)' },
  kontrol_cihaz: { hue_dimmer: 'Hue Dimmer', hue_button: 'Hue Smart Button', hue_motion: 'Hue Motion', hue_wall_module: 'Hue Wall Switch Module', duvar_anahtari: 'Duvar anahtarı', lamba_dugmesi: 'Lamba düğmesi', smart_plug: 'Smart Plug' },
  adim: { kesif: 'Keşif', elektrik: 'Elektrik', boya: 'Boya', profil: 'Profil', ampul: 'Ampul', akilli: 'Akıllı', mobilya: 'Mobilya', ince_ayar: 'İnce ayar' },
  kim: { E: 'Elektrikçi', B: 'Boyacı', M: 'Marangoz', K: 'Kendim' },
  is_kim: { elektrikci: 'Elektrikçi', boyaci: 'Boyacı', marangoz: 'Marangoz', nakliye: 'Nakliye', klimaci: 'Klimacı', internet: 'İnternet', ev_sahibi: 'Ev sahibi', idari: 'İdari', ben: 'Ben' },
  izin_durumu: { gerekmez: 'Gerekmez', istenecek: 'İstenecek', istendi: 'İstendi', alindi: 'Alındı', reddedildi: 'Reddedildi' },
  meslek: { elektrik: 'Elektrik', boya: 'Boya', marangoz: 'Marangoz', nakliye: 'Nakliye', klima: 'Klima', internet: 'İnternet', diger: 'Diğer' },
  kontrol_tur: { sartname: 'Şartname', kabul: 'Kabul testi', izin: 'Yazılı izin', ev_secimi: 'Ev seçimi' },
  tetik: { dugme: 'Düğme', dimmer: 'Dimmer', sensor: 'Sensör', zaman: 'Zaman', plug: 'Smart Plug' },
  senaryo: { A: 'A: anahtar ≤ 8 Ocak', B: 'B: anahtar 29 Oca – 12 Şub', C: 'C: anahtar 19 Şubat', hepsi: 'Hepsi' },
  kilometre_tur: { tarih: 'Tarih', bant: 'Bant', hedef: 'Hedef', siparis: 'Sipariş' },
  duvar: { K: 'Kuzey', G: 'Güney', D: 'Doğu', B: 'Batı' },
  kopek_erisim: { serbest: 'Serbest', gece_kapali: 'Gece kapalı', kapali: 'Kapalı' },
};

export function label(field: string, value: string | undefined | null): string {
  if (value == null || value === '') return '';
  return LABELS[field]?.[value] ?? value;
}

export function columnByKey(columns: readonly ColumnDef[]): Map<string, ColumnDef> {
  return new Map(columns.map((col) => [col.key, col]));
}

export const ITEM_COLUMN_MAP = columnByKey(ITEM_COLUMNS);
export const SETTING_COLUMN_MAP = columnByKey(SETTING_COLUMNS);
