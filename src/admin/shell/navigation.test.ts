import { describe, expect, it } from 'vitest';
import { sheetUrl } from '../../dashboard/data';
import {
  adminGroups, adminGroupTitle, adminHelpers, adminLeads, adminNav, adminPages, currentAdminLink, defaultAdminPath,
  externalLinkHint, isRoute, sectionCaption, settingsLink, sheetLink,
} from './navigation';

// Tasarım kaynağı: tasarim-sistemi/components/bundle.js › NAV, NAV_ALT ve Aile.Pages purpose metinleri. Emeklilik planı
// tasarım paketinde yoktur; aynı kalıpla (bölüm Para, rakamsız amaç cümlesi) Hesaplar ve borçlar'dan sonra eklenir
// (docs/EMEKLILIK-PLANI.md).
const DESIGN_NAV = [
  ['genel', 'Genel durum', 'Genel', 'Bu ayın nakdini, yaklaşan ödemeleri ve dikkat isteyen kayıtları tek yerde görün.'],
  ['butce', 'Bütçe ve nakit', 'Para', 'Ayın gelirini, planlanan giderlerini ve kalan nakdi kalem kalem izleyin.'],
  ['odemeler', 'Ödemeler', 'Para', 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.'],
  ['hesaplar', 'Hesaplar ve borçlar', 'Para', 'Hesap bakiyelerini ve kalan borçları, taksit planıyla birlikte görün.'],
  ['emeklilik', 'Emeklilik planı', 'Para', 'Askerlik, Bağ-Kur ve ihya seçeneklerinin emeklilik tarihine ve maliyetine etkisini karşılaştırın.'],
  ['alimlar', 'Alımlar ve eşyalar', 'Alım ve envanter', 'Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.'],
  ['ev', 'Ev ve odalar', 'Ev', 'Her odanın alımlarını, görevlerini ve plan ile gerçek tutarını oda oda izleyin.'],
  ['projeler', 'Projeler ve görevler', 'İşler', 'Ev projelerini ve görevlerini kim, ne zaman ve hangi sırayla yapacak, görün.'],
  ['taraflar', 'Taraflar ve teklifler', 'İşler', 'Satıcıları, ustaları ve gelen teklifleri tek yerde karşılaştırın.'],
  ['raporlar', 'Raporlar', 'Rapor', 'Hazır raporları açın; her rakamın hangi kayıtlardan geldiğini görün.'],
  ['sozlukler', 'Sözlükler ve iş akışları', 'Yapı', 'Kategorileri, odaları, durumları ve durumların hangi sırayla değişeceğini tanımlayın.'],
  ['veri', 'Veri kalitesi ve içe aktarma', 'Yapı', 'E-tablodan gelen veriyi içe aktarın, eşleşmeyen satırları ve çakışmaları çözün.'],
] as const;

describe('admin navigation (tasarım NAV)', () => {
  it('has the 12 page keys in design order (Emeklilik planı after Hesaplar ve borçlar), each routed at /<key>', () => {
    expect(adminPages.map(item => item.key)).toEqual(DESIGN_NAV.map(([key]) => key));
    expect(adminPages.map(item => item.label)).toEqual(DESIGN_NAV.map(([, label]) => label));
    for (const item of adminPages) {
      expect(item.path).toBe(`/${item.key}`);
      expect(item.external).toBeUndefined();
    }
  });

  it('has two helper links: Ayarlar and the external sheet link', () => {
    expect(adminHelpers).toHaveLength(2);
    expect(adminHelpers.map(item => item.key)).toEqual(['ayarlar', 'sheet']);
    expect(adminHelpers[0]).toMatchObject({ path: '/ayarlar', label: 'Ayarlar', icon: 'settings', section: 'Uygulama' });
    expect(settingsLink).toEqual({ path: '/ayarlar', label: 'Ayarlar' });
    expect(adminHelpers[1]).toBe(sheetLink);
    expect(adminNav).toHaveLength(14);
    expect(new Set(adminNav.map(item => item.key)).size).toBe(14);
  });

  it('opens the sheet in a new tab via the dashboard sheetUrl', () => {
    expect(sheetLink.label).toBe('E-tabloyu aç');
    expect(sheetLink.external).toBe(true);
    expect(sheetLink.href).toBe(sheetUrl);
    expect(sheetLink.href.startsWith('https://docs.google.com/spreadsheets/')).toBe(true);
    expect(sheetLink.target).toBe('_blank');
    expect(sheetLink.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    expect(sheetLink.icon).toBe('sheet');
    expect(sheetLink.iconEnd).toBe('external');
    expect(externalLinkHint).toBe('yeni sekmede açılır');
    // The sheet is not a hash route: it never wins route matching.
    expect(currentAdminLink(sheetLink.href)).toBe(adminPages[0]);
    expect(isRoute(sheetLink.href, sheetLink.path)).toBe(false);
  });

  it('leads are the design purpose sentences: one sentence, no figures', () => {
    for (const [key, , , purpose] of DESIGN_NAV) expect(adminLeads[`/${key}`]).toBe(purpose);
    expect(adminLeads['/ayarlar']).toBe('Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin.');
    for (const item of adminNav) {
      const lead = adminLeads[item.path];
      expect(lead, item.key).toBe(item.purpose);
      expect(lead).not.toMatch(/\d/);
      expect(lead.endsWith('.')).toBe(true);
      expect(lead).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('sectionCaption gives the design section for a location, nested paths included', () => {
    for (const [key, , section] of DESIGN_NAV) expect(sectionCaption(`/${key}`)).toBe(section);
    expect(sectionCaption('/alimlar/abc-123')).toBe('Alım ve envanter');
    expect(sectionCaption('/ayarlar')).toBe('Uygulama');
    expect(sectionCaption('/bilinmeyen')).toBe('Genel');
    expect(adminGroupTitle('/butce')).toBe(sectionCaption('/butce'));
  });

  it('Emeklilik planı: /emeklilik, bölüm Para, nested paths stay on the page', () => {
    const item = adminPages.find(page => page.key === 'emeklilik');
    expect(item).toMatchObject({ path: '/emeklilik', label: 'Emeklilik planı', section: 'Para' });
    expect(adminPages.indexOf(item!)).toBe(adminPages.findIndex(page => page.key === 'hesaplar') + 1);
    expect(currentAdminLink('/emeklilik/ihya').key).toBe('emeklilik');
    expect(currentAdminLink('/emeklilikx')).toBe(adminPages[0]);
  });

  it('currentAdminLink is longest-match and falls back to the first page', () => {
    expect(currentAdminLink('/alimlar').key).toBe('alimlar');
    expect(currentAdminLink('/alimlar/123').key).toBe('alimlar');
    expect(currentAdminLink('/alimlarx')).toBe(adminPages[0]);
    expect(currentAdminLink('/ayarlar').key).toBe('ayarlar');
    expect(currentAdminLink('')).toBe(adminPages[0]);
  });

  it('the default route is the first page (Genel durum), the same page unknown locations resolve to', () => {
    expect(defaultAdminPath).toBe('/genel');
    expect(defaultAdminPath).toBe(adminPages[0].path);
    expect(currentAdminLink('/bilinmeyen').path).toBe(defaultAdminPath);
  });

  it('keeps the legacy one-link-per-group shape for the shell', () => {
    expect(adminGroups).toHaveLength(12);
    expect(adminGroups.map(group => group.links[0])).toEqual([...adminPages]);
    expect(adminGroups.every(group => group.links.length === 1 && group.title === group.links[0].label)).toBe(true);
  });
});
