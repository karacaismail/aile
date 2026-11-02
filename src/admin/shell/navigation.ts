import { sheetUrl } from '../../dashboard/data';
import type { IconName } from '../ui/icons';
import type { NavGroup, NavLink } from './contracts';

// Tasarım kaynağı: tasarim-sistemi/components/bundle.js › NAV (11 sayfa), NAV_ALT (Ayarlar, E-tabloyu aç) ve
// Aile.Pages'teki section/purpose metinleri. Sayfa anahtarı = hash yolu (/<key>); sıra tasarımdaki sıradır.
export type AdminPageKey =
  | 'genel' | 'butce' | 'odemeler' | 'hesaplar' | 'alimlar' | 'ev'
  | 'projeler' | 'taraflar' | 'raporlar' | 'sozlukler' | 'veri';
export type AdminHelperKey = 'ayarlar' | 'sheet';
export type AdminNavKey = AdminPageKey | AdminHelperKey;

/** Menü öğesi: NavLink + tasarım bölümü, amaç cümlesi ve isteğe bağlı simgeler. */
export interface AdminNavItem extends NavLink {
  key: AdminNavKey;
  /** h1 üstündeki küçük bölüm adı (tasarım `section`). */
  section: string;
  /** Sayfanın amacı; tek cümle, rakamsız (veri sonra gelir). */
  purpose: string;
  icon?: IconName;
  iconEnd?: IconName;
  external?: boolean;
}

/** Dış bağlantı: hash yolu değil, yeni sekmede açılan tam URL. */
export interface AdminExternalLink extends AdminNavItem {
  external: true;
  href: string;
  target: '_blank';
  rel: string;
}

/** Ekran okuyucu ve ipucu metni; Menu README: "yeni sekmede açılır". */
export const externalLinkHint = 'yeni sekmede açılır';

const page = (key: AdminPageKey, label: string, section: string, purpose: string): AdminNavItem =>
  ({ key, path: `/${key}`, label, section, purpose });

export const adminPages: readonly AdminNavItem[] = [
  page('genel', 'Genel durum', 'Genel', 'Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.'),
  page('butce', 'Bütçe ve nakit', 'Para', 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.'),
  page('odemeler', 'Ödemeler', 'Para', 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.'),
  page('hesaplar', 'Hesaplar ve borçlar', 'Para', 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.'),
  page('alimlar', 'Alımlar ve eşyalar', 'Alım ve envanter', 'Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.'),
  page('ev', 'Ev ve odalar', 'Ev', 'Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.'),
  page('projeler', 'Projeler ve görevler', 'İşler', 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.'),
  page('taraflar', 'Taraflar ve teklifler', 'İşler', 'Satıcıları, ustaları ve gelen teklifleri tek yerde karşılaştırın.'),
  page('raporlar', 'Raporlar', 'Rapor', 'Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.'),
  page('sozlukler', 'Sözlükler ve iş akışları', 'Yapı', 'Kategorileri, odaları, durumları ve durumların hangi sırayla değişeceğini tanımlayın.'),
  page('veri', 'Veri kalitesi ve içe aktarma', 'Yapı', 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.'),
];

/** Eski kabuk sözleşmesi: yalnız yol + etiket (scaffold testi birebir eşitlik bekler). */
export const settingsLink: NavLink = { path: '/ayarlar', label: 'Ayarlar' };

const settingsItem: AdminNavItem = {
  ...settingsLink, key: 'ayarlar', section: 'Uygulama', icon: 'settings',
  purpose: 'Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.',
};

/** "E-tabloyu aç": kaynak e-tablo, yeni sekmede. Kimlik VITE_BUDGET_SHEET_ID'den gelir (src/dashboard/data.ts). */
export const sheetLink: AdminExternalLink = {
  key: 'sheet', path: sheetUrl, href: sheetUrl, label: 'E-tabloyu aç', section: 'Uygulama',
  purpose: 'Kaynak e-tabloyu yeni sekmede açar; panel ondan okur, ona yazmaz.',
  icon: 'sheet', iconEnd: 'external', external: true, target: '_blank', rel: 'noopener noreferrer',
};

/** Ayırıcıdan sonraki yardımcı öğeler: Ayarlar · E-tabloyu aç. */
export const adminHelpers: readonly AdminNavItem[] = [settingsItem, sheetLink];
export const adminNav: readonly AdminNavItem[] = [...adminPages, ...adminHelpers];

// Information architecture of the admin workspace: one top-level link per page, settings as helper.
export const adminGroups: readonly NavGroup[] = adminPages.map(item => ({ title: item.label, links: [item] }));
/** Açılış ve bilinmeyen konumların yönlendiği sayfa: ilk sayfa (Genel durum); currentAdminLink'in geri dönüşüyle aynı. */
export const defaultAdminPath = adminPages[0].path;

/** Hash yolu olan öğeler; dış bağlantı hiçbir konumla eşleşmez. */
const routable: readonly AdminNavItem[] = adminNav.filter(item => !item.external);

/** True when `location` is the link path itself or a nested path below it. */
export function isRoute(location: string, path: string) {
  return !isExternal(path) && (location === path || location.startsWith(`${path}/`));
}

const isExternal = (path: string) => !path.startsWith('/');

/** Longest matching link for a hash location; unknown locations fall back to the first page. */
export function currentAdminLink(location: string): AdminNavItem {
  let match: AdminNavItem | undefined;
  for (const item of routable) if (isRoute(location, item.path) && (!match || item.path.length > match.path.length)) match = item;
  return match ?? adminPages[0];
}

/** Küçük bölüm adı (h1 üstündeki caption); iç içe yollar üst sayfanın bölümünü alır. */
export function sectionCaption(location: string) {
  return currentAdminLink(location).section;
}

/** @deprecated Eski ad; sectionCaption ile aynı. */
export const adminGroupTitle = sectionCaption;

/** Yol → amaç cümlesi. Purpose sentences only; no counts or figures, since data arrives later. */
export const adminLeads: Record<string, string> = Object.fromEntries(adminNav.map(item => [item.path, item.purpose]));
