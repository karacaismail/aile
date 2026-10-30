export const homeLinks = [
  { path: '/ev', label: 'Alım planı' },
  { path: '/satinalma', label: 'Hazırlık listesi' },
  { path: '/aydinlatma', label: 'Aydınlatma' },
  { path: '/tadilat', label: 'Tadilat' },
  { path: '/yerlesim', label: 'Yerleşim' },
] as const;
export const isRoute = (location: string, path: string) => location === path || location.startsWith(`${path}/`);
export const isPlannerRoute = (location: string) => /^\/(satinalma|aydinlatma|tadilat|yerlesim|butce|ayarlar)(\/|$)/.test(location);
export function familySection(location: string) {
  if (homeLinks.some(link => isRoute(location, link.path))) return 'home';
  if (isRoute(location, '/timeline')) return 'timeline';
  if (isRoute(location, '/arac')) return 'vehicle';
  if (isRoute(location, '/ayarlar')) return 'settings';
  return 'budget';
}
export const plannerPages = [
  { path: '/satinalma', title: 'Hazırlık listesi', description: 'Ölçüleri, teklifleri, siparişleri ve teslimatları takip edin.' },
  { path: '/aydinlatma', title: 'Aydınlatma', description: 'Odaları, ışık katmanlarını ve uygulama sırasını birlikte planlayın.' },
  { path: '/tadilat', title: 'Tadilat', description: 'Yapılacak işleri, ustaları ve kontrol listesini tek yerde izleyin.' },
  { path: '/yerlesim', title: 'Yerleşim', description: 'Oda ölçülerini, eşyaları ve yerleşim ihtiyaçlarını düzenleyin.' },
  { path: '/butce', title: 'Harcama kayıtları', description: 'Gerçekleşen ödemeleri kaydedin ve aylık kayıtları inceleyin.' },
  { path: '/ayarlar', title: 'Ayarlar', description: 'Ev planı ve harcama kayıtlarının bağlantısını yönetin.' },
] as const;

/** Task-oriented entry points only; individual records keep their contextual links. */
type PageLink = { path: string; label: string; nested?: boolean };
export const settingsLink: PageLink = { path: '/ayarlar', label: 'Ayarlar' };
export const directoryGroups: readonly { title: string; links: readonly PageLink[] }[] = [
  { title: 'Bütçe ve ödemeler', links: [
    { path: '/pano', label: 'Genel bütçe' },
    { path: '/timeline', label: 'Ödeme takvimi' },
    { path: '/butce', label: 'Harcama kayıtları' },
  ] },
  { title: 'Ev ve taşınma', links: [
    { path: '/ev', label: 'Alım planı' },
    { path: '/satinalma', label: 'Hazırlık listesi' },
    { path: '/aydinlatma', label: 'Aydınlatma' },
    { path: '/yerlesim', label: 'Yerleşim' },
    { path: '/tadilat', label: 'Tadilat takvimi' },
    { path: '/tadilat/isler', label: 'Yapılacak işler', nested: true },
    { path: '/tadilat/ustalar', label: 'Ustalar', nested: true },
    { path: '/tadilat/kontrol', label: 'Kontrol listesi', nested: true },
  ] },
  { title: 'Araç', links: [
    { path: '/arac', label: 'Araç ve finansman' },
  ] },
] as const;

export function currentDirectoryLink(location: string) {
  const links = [...directoryGroups.flatMap(group => [...group.links]), settingsLink];
  return links.filter(link => isRoute(location, link.path)).sort((a, b) => b.path.length - a.path.length)[0]
    ?? links[0];
}
