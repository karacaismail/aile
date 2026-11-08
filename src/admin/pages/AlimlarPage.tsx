import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useWideModule } from '../adaptive';
import {
  FACETS,
  MISSING_LABELS,
  UNKNOWN,
  createViewCatalog,
  readViewDefinitions,
  toneForCode,
  useChangeSet,
  useCollection,
  useGeneration,
  useQuery,
  useRows,
  type DateField,
  type FacetId,
  type MissingValue,
} from '../data';
import { useDevice } from '../device';
import {
  VIEW_LABELS,
  VIEW_MODES,
  type ActiveFilter,
  type DataStatusProps,
  type FilterFacet,
  type FilterOption,
  type PageHeaderSummary,
  type RecordRow,
  type ResponsiveColumn,
  type SortOption,
  type StatusLabel,
  type ViewMode,
} from '../shell/contracts';
import { FilterDrawer } from '../shell/FilterDrawer';
import { RANGE_KEYS } from '../shell/FilterPanel';
import { PageHeader } from '../shell/PageHeader';
import { QueryBar } from '../shell/QueryBar';
import { Button } from '../ui/Button';
import { DetailPanel } from '../ui/DetailPanel';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Kanban } from '../ui/Kanban';
import { LoadingShell } from '../ui/LoadingShell';
import { Money } from '../ui/Money';
import { PivotStack } from '../ui/PivotStack';
import { ResponsiveTable } from '../ui/ResponsiveTable';
import { Select } from '../ui/Select';
import { StatusText } from '../ui/StatusText';
import { Timeline } from '../ui/Timeline';
import type { DetailPanelProps } from '../ui/DetailPanel';
import { AlimListesi } from './alimlar/AlimListesi';
import { useAyniIcerik, useKararliSatirlar } from './alimlar/kararli';
import { paraEkle, toplamMetni, type ParaToplami } from './alimlar/para';
import { baskaParaVar, bilinmeyenSonda, pivotHesapla, pivotYiginSatirlari } from './alimlar/pivot';
import {
  ACIK_BOYUTLAR, RANGE_PREFIXES, SIRALAR, TARIH_TURLERI, VARSAYILAN_SIRA, VARSAYILAN_TARIH, VARSAYILAN_ZAMAN, ZAMAN_ALANLARI,
  sorguAst, type Secimler, type Siralama, type ZamanAlani,
} from './alimlar/query';
import { KONUM, buildAlimlarHash, currentHash, parseAlimlarHash } from './alimlar/url';
import { AlimlarGenis, AlimlarPivotTablo } from './alimlar/wide';
import { BILINMIYOR, durumGecisi, guncelKayit, izinliHedefler } from './alimlar/workflow';
import './AlimlarPage.css';

export { buildAlimlarHash, parseAlimlarHash, type AlimlarUrlState } from './alimlar/url';
export { durumEkseni, durumGecisi, type GecisSonucu } from './alimlar/workflow';
export { pivotHesapla } from './alimlar/pivot';

// Alımlar ve eşyalar. Tasarım: README › Sayfa iskeleti (başlık → özet ≤3 → sorgu çubuğu → filtreler → ayrıntı) ve
// Uyarlanır teslim; ekranlar.md (EkranListeDar/EkranAyrintiDar/SayfaAlimlarDar önce, sonra EkranListe/Tablo/Kanban/
// Zaman, SayfaAlimlarPivot, EkranAyrinti); bundle.js Aile.Pages.Alimlar.
// Telefon önce: temel sunum liste + arama + filtre alt sayfası (FilterDrawer) + tam ekran ayrıntı (üstten başlar,
// "Listeye dön" ile liste konumu ve odak geri gelir) + durum değiştir alt sayfası (DetailPanel › Select) ve Geri al.
// Bildirim kullanıcının baktığı yerde görünür: sayfada alta yapışık durum bölgesi (güvenli alan dahil), ayrıntı katmanı
// açıkken katmanın altlığı. Tablo/Kanban/Zaman
// çizelgesi ui/ bileşenlerinin telefon biçimiyle (akordeon, duruma göre gruplu dikey Kanban listesi; yana kayan pano
// yalnız genişte) gelir; Pivot telefonda PivotStack.
// Geniş-özel kod alimlar/*.wide.tsx'te ve lazyWide ile yüklenir (telefon indirmez): masaüstü yerleşimi (filtre paneli
// 272 / şerit 56, ayrıntı sağda 384) ve pivot tablosu. Başlık ve sorgu çubuğu geniş modül gelince yeniden kurulmaz.
// Veri: purchase_needs (useQuery: FACETS + facetCounts), modlar view_definitions'tan (desteklenmeyen mod gerekçesiyle
// devre dışı), durum geçişleri workflows'tan; yazma yalnız yerel change set (state_change, Geri al). Sheets'e yazma ve
// yeni kayıt ekleme bu dilimde yok; "Alım ekle" devre dışı ve nedeni yazılı. Plan ve gerçek tek sayıda birleşmez.
// Çizim maliyeti: satır nesneleri ve liste/başlık/sorgu öğeleri kararlı tutulur; yerel değişiklik yalnız değişen satırı
// çizer (tam pakette "Durumu değiştir" testinin 5 sn'yi aşmasının kök nedeni 28 satırın her değişiklikte çizilmesiydi).

const KIND = 'purchase_need';
const KONUM_BOLUM = 'Alım ve envanter';
const BASLIK = 'Alımlar ve eşyalar';
const AMAC = 'Ev için alınacak ve alınmış her şeyi plan ve gerçek tutarıyla izleyin.';
const EKLE_NOTU = 'Yeni alım kaynak e-tabloya eklenir; panel bu sürümde yalnız durum değişikliğini yerel olarak tutar.';

const FIYAT_YOK = 'Fiyat yok';
const HENUZ_YOK = 'Henüz yok';
const KAYNAKTA_YOK = 'Kaynakta alım kaydı yok';
const SONUCLAR = 'Sonuçlar';
/** Ayrıntıyı açabilen öğeler: satır düğmesi, tablo satırı (tabIndex 0), kart ve bağlantılar. */
const ODAKLANABILIR = 'button, a[href], [tabindex]:not([tabindex="-1"])';
const KANBAN_ETIKET = 'Duruma göre alımlar';
/** Kanban notu sunumu anlatır (ui/Kanban): telefonda duruma göre gruplu dikey liste, genişte yana kayan pano. */
const KANBAN_NOT_DAR = 'duruma göre gruplu';
const KANBAN_NOT_GENIS = 'pano yana kayar';
/** DetailPanel'in geri alma eyleminin erişilebilir adı (ui/DetailPanel UNDO; rol/ad genel sözleşmedir). */
const GERI_AL = 'Geri al';
/** Sonuç bölgesinde seçili kaydın işareti: liste satırı ve zaman çizelgesi aria-current, tablo aria-selected, akordeon data-selected. */
const SECILI_ISARET = '[aria-current="true"], [aria-selected="true"], [data-selected="true"]';

const DEFAULT_MODE: ViewMode = 'listing';
/** view_definitions okunamazsa ya da hiçbir mod tanımlı değilse en temel iki görünüm. */
const TEMEL_MODLAR: readonly ViewMode[] = ['listing', 'table'];

const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

// --- Tablo sütunları -------------------------------------------------------------------------------------------
const durumMetni = (status: StatusLabel | undefined) =>
  status ? <StatusText label={status.label} tone={status.tone} /> : <span className="aile-alimlar-eksik">{BILINMIYOR}</span>;

const SUTUNLAR: readonly ResponsiveColumn<RecordRow>[] = [
  { key: 'label', title: 'Alım', minWidth: 200, m: 'title', render: row => <span className="aile-alimlar-ad">{row.label}</span> },
  { key: 'code', title: 'Kimlik', minWidth: 120, m: 'meta', render: row => row.code },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 136, m: 'lead', render: row => <Money value={row.planned} label={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 152, m: 'body', render: row => <Money value={row.actual} label={HENUZ_YOK} /> },
  { key: 'status', title: 'Durum', minWidth: 160, m: 'status', render: row => durumMetni(row.status) },
  { key: 'room', title: 'Oda', minWidth: 136, m: 'meta', render: row => row.room ?? BILINMIYOR },
  { key: 'payment', title: 'Ödeme durumu', minWidth: 152, m: 'body', render: row => durumMetni(row.payment) },
  { key: 'owner', title: 'Sorumlu', minWidth: 128, m: 'body', render: row => row.owner ?? BILINMIYOR },
  { key: 'category', title: 'Kategori', minWidth: 192, m: 'hide', render: row => row.category ?? BILINMIYOR },
];

// --- Veri durumu --------------------------------------------------------------------------------------------------
function dataStatus(generation: ReturnType<typeof useGeneration>): DataStatusProps {
  const state: DataStatusProps['state'] =
    generation.state === 'ready' ? 'fresh' : generation.state === 'stale' ? 'stale' : generation.state === 'error' ? 'error' : 'checking';
  const props: DataStatusProps = { state, onRefresh: () => void generation.refresh() };
  if (generation.lastReadAt) props.lastReadAt = generation.lastReadAt;
  if (generation.generationId) props.generationId = generation.generationId;
  if (generation.lastGoodAt) props.lastGoodAt = generation.lastGoodAt;
  if (generation.message) props.message = generation.message;
  return props;
}

interface Bildirim { tone: 'bilgi' | 'hata'; text: string }

/** Sayfanın kaydırma kabı: en yakın kaydırılabilir ata; yoksa belge. Tam ekran ayrıntı üstten başlar, dönüşte konum geri gelir. */
function kaydirmaKabi(from: Element | null): Element | null {
  if (typeof document === 'undefined') return null;
  for (let element = from?.parentElement ?? null; element; element = element.parentElement) {
    // Önce ucuz ölçü: taşmayan atada stil hesaplanmaz (getComputedStyle pahalıdır).
    if (element.scrollHeight <= element.clientHeight) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return element;
  }
  return document.scrollingElement;
}

/**
 * Seçili kaydın sonuç bölgesindeki etkileşim öğesi. Açan öğe bilinmediğinde (sayfa yeniden kuruldu, seçim hash'ten geldi)
 * ya da belgeden düştüğünde (geniş yerleşim ya da sağlayıcı geçidi listeyi yeniden kurdu) odak buraya döner.
 */
function seciliSatirOgesi(kok: Element | null): HTMLElement | null {
  const bolge = kok?.querySelector(`section[aria-label="${SONUCLAR}"]`);
  const isaretli = bolge?.querySelector<HTMLElement>(SECILI_ISARET);
  if (!isaretli) return null;
  return isaretli.matches(ODAKLANABILIR) ? isaretli : isaretli.querySelector<HTMLElement>(ODAKLANABILIR);
}

// --- Sayfa ----------------------------------------------------------------------------------------------------------
export interface AlimlarPageProps {
  /** Rota yolu (hash konumu); varsayılan "/alimlar". */
  location?: string;
}

export function AlimlarPage({ location = KONUM }: AlimlarPageProps) {
  const device = useDevice();
  const masaustu = device === 'desktop';
  // Masaüstü yerleşimi geniş modüldedir; veri yüklenirken paralel indirilir. Hazır değilken (ya da yüklenemezse) temel
  // sunum kullanılır: filtreler çekmecede, ayrıntı çekmecede.
  const genisDurum = useWideModule(AlimlarGenis.resource, masaustu);
  const genisYerlesim = masaustu && genisDurum.status === 'ready';
  const generation = useGeneration();
  const changeSet = useChangeSet();
  const notId = useId();
  const kok = useRef<HTMLDivElement>(null);

  const kayitlar = useCollection('purchase_needs');
  const odalar = useCollection('rooms');
  const terimler = useCollection('terms');
  const akislar = useCollection('workflows');
  const gorunumler = useCollection('view_definitions');
  const tumSatirlar = useRows(KIND);

  // --- Durum (ilk değer URL'den) ---
  const [ilk] = useState(() => parseAlimlarHash(currentHash(), location));
  const [mode, setMode] = useState<ViewMode>(ilk?.mode ?? DEFAULT_MODE);
  const [search, setSearch] = useState(ilk?.search ?? '');
  const [sira, setSira] = useState<Siralama>(() => SIRALAR.find(option => option.key === ilk?.sort) ?? VARSAYILAN_SIRA);
  const [secimler, setSecimler] = useState<Secimler>(() => ({ ...(ilk?.facets ?? {}) }) as Secimler);
  const [tarihTuru, setTarihTuru] = useState<DateField>(() => (ilk?.dateType as DateField | null) ?? VARSAYILAN_TARIH);
  const [zamanAlani, setZamanAlani] = useState<ZamanAlani>(() => (ilk?.timelineField as ZamanAlani | null) ?? VARSAYILAN_ZAMAN);
  const [secili, setSecili] = useState<string | null>(ilk?.id ?? null);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  const filtreDugmesi = useRef<HTMLElement | null>(null);
  /** Gövdede son tıklanan odaklanabilir öğe (yakalama aşamasında, düğmenin onClick'inden önce): çekmeceyi açan düğme. */
  const govdeTiklanan = useRef<HTMLElement | null>(null);

  // --- Görünüm kataloğu: hangi modlar anlamlı ---
  const katalog = useMemo(() => {
    const records = gorunumler.rows.filter(row => !row.deleted_at);
    return createViewCatalog(readViewDefinitions({ schemaVersion: 1, collection: 'view_definitions', records }));
  }, [gorunumler.rows]);
  const katalogHazir = !gorunumler.loading;
  const destek = useMemo(() => {
    const tanimli = katalogHazir && !gorunumler.error ? katalog.supportedModes(KIND) : [];
    const modes = tanimli.length ? tanimli : [...TEMEL_MODLAR];
    const reasons: Partial<Record<ViewMode, string>> = {};
    for (const key of VIEW_MODES) {
      if (modes.includes(key)) continue;
      const full = gorunumler.error
        ? 'görünüm tanımları okunamadı.'
        : katalog.unsupportedReason(KIND, key) ?? '';
      reasons[key] = full.replace(`${VIEW_LABELS[key]} kullanılamaz: `, '');
    }
    return { modes, reasons };
  }, [katalog, katalogHazir, gorunumler.error]);
  const etkinMod: ViewMode = destek.modes.includes(mode) ? mode : destek.modes.includes(DEFAULT_MODE) ? DEFAULT_MODE : destek.modes[0]!;

  // --- Sorgu ---
  const sorgu = useQuery(KIND, sorguAst(search, secimler, tarihTuru, sira));
  const rows = useKararliSatirlar(sorgu.rows);

  const termsById = useMemo(() => new Map(terimler.rows.map(term => [term.id, term] as const)), [terimler.rows]);
  const roomsById = useMemo(() => new Map(odalar.rows.map(room => [room.id, room.label ?? room.code] as const)), [odalar.rows]);

  const secenekAdi = useCallback(
    (facetId: FacetId, value: string): string => {
      if (value === UNKNOWN) return BILINMIYOR;
      if (facetId === 'missing') return MISSING_LABELS[value as MissingValue] ?? value;
      if (facetId === 'room') return roomsById.get(value) ?? value;
      if (facetId === 'category' || facetId === 'phase' || facetId === 'context' || facetId === 'procurement' || facetId === 'payment') {
        return termsById.get(value)?.label ?? value;
      }
      return value;
    },
    [roomsById, termsById],
  );

  const facetListesi = useMemo<FilterFacet[]>(() => {
    const out: FilterFacet[] = [];
    for (const def of FACETS) {
      if (def.kind === 'date') {
        out.push({
          id: def.id,
          label: def.label,
          kind: 'date',
          options: TARIH_TURLERI,
          selected: [...(tarihTuru !== VARSAYILAN_TARIH ? [tarihTuru] : []), ...(secimler.date ?? [])],
        });
        continue;
      }
      if (def.kind === 'amount') {
        out.push({ id: def.id, label: `${def.label} (planlanan)`, kind: 'amount', options: [], selected: secimler.amount ?? [] });
        continue;
      }
      const counts = sorgu.counts[def.id as Exclude<FacetId, 'date' | 'amount'>] ?? {};
      const keys = new Set(Object.keys(counts));
      const options: FilterOption[] = [...keys]
        .map(value => {
          const option: FilterOption = { value, label: secenekAdi(def.id, value), count: counts[value] ?? 0 };
          if (def.kind === 'tree') {
            const parent = termsById.get(value)?.parent_id;
            if (parent && keys.has(parent)) option.parent = parent;
          }
          return option;
        })
        .sort((a, b) => bilinmeyenSonda(a.label, b.label));
      if (!options.length) continue;
      out.push({ id: def.id, label: def.label, kind: def.kind, options, selected: secimler[def.id] ?? [] });
    }
    return out;
  }, [sorgu.counts, secimler, tarihTuru, secenekAdi, termsById]);
  // Yerel durum değişikliği sayımları yeniden üretir; içerik aynıysa filtre paneli yeniden çizilmez.
  const facets = useAyniIcerik(facetListesi);

  const toggle = useCallback((facetId: string, value: string) => {
    const id = facetId as FacetId;
    if (id === 'date' && TARIH_TURLERI.some(option => option.value === value)) {
      setTarihTuru(value as DateField);
      return;
    }
    if (id === 'date' || id === 'amount') {
      const prefix = RANGE_PREFIXES.find(item => value.startsWith(item));
      if (!prefix) return;
      setSecimler(prev => {
        const kept = (prev[id] ?? []).filter(entry => !entry.startsWith(prefix));
        return { ...prev, [id]: value.length > prefix.length ? [...kept, value] : kept };
      });
      return;
    }
    setSecimler(prev => {
      const list = prev[id] ?? [];
      return { ...prev, [id]: list.includes(value) ? list.filter(item => item !== value) : [...list, value] };
    });
  }, []);

  const temizle = useCallback(() => {
    setSecimler({});
    setSearch('');
  }, []);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (search.trim()) list.push({ id: 'ara', label: `Arama: ${search.trim()}`, onRemove: () => setSearch('') });
    for (const def of FACETS) {
      const values = secimler[def.id] ?? [];
      for (const value of values) {
        let label: string;
        if (def.id === 'date' || def.id === 'amount') {
          const prefix = RANGE_PREFIXES.find(item => value.startsWith(item));
          if (!prefix) continue;
          const shown = value.slice(prefix.length);
          label =
            prefix === RANGE_KEYS.baslangic ? `Başlangıç: ${shown}` :
            prefix === RANGE_KEYS.bitis ? `Bitiş: ${shown}` :
            prefix === RANGE_KEYS.enAz ? `En az (planlanan): ${shown} ₺` : `En çok (planlanan): ${shown} ₺`;
        } else {
          label = `${def.label}: ${secenekAdi(def.id, value)}`;
        }
        list.push({ id: `${def.id}:${value}`, label, onRemove: () => toggle(def.id, def.id === 'date' || def.id === 'amount' ? value.slice(0, value.indexOf('=') + 1) : value) });
      }
    }
    return list;
  }, [search, secimler, secenekAdi, toggle]);

  // --- URL eşitleme ---
  const hashMode = katalogHazir ? etkinMod : mode;
  useEffect(() => {
    const current = currentHash();
    if (current && current !== '#' && current !== '#/' && parseAlimlarHash(current, location) === null) return;
    const next = buildAlimlarHash(
      {
        id: secili,
        mode: hashMode === DEFAULT_MODE ? null : hashMode,
        search: search.trim(),
        sort: sira.key === VARSAYILAN_SIRA.key ? null : sira.key,
        facets: secimler,
        dateType: tarihTuru === VARSAYILAN_TARIH ? null : tarihTuru,
        timelineField: zamanAlani === VARSAYILAN_ZAMAN ? null : zamanAlani,
      },
      location,
    );
    if (current === next) return;
    const url = new URL(window.location.href);
    url.hash = next;
    window.history.replaceState(window.history.state, '', url.href);
  }, [location, secili, hashMode, search, sira, secimler, tarihTuru, zamanAlani]);

  useEffect(() => {
    const onHashChange = () => {
      const state = parseAlimlarHash(currentHash(), location);
      if (!state) return;
      setSecili(state.id);
      setMode(state.mode ?? DEFAULT_MODE);
      setSearch(state.search);
      setSira(SIRALAR.find(option => option.key === state.sort) ?? VARSAYILAN_SIRA);
      setSecimler({ ...state.facets } as Secimler);
      setTarihTuru((state.dateType as DateField | null) ?? VARSAYILAN_TARIH);
      setZamanAlani((state.timelineField as ZamanAlani | null) ?? VARSAYILAN_ZAMAN);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [location]);

  // --- Ayrıntı, odak ve kaydırma ---
  // Açan öğe: sonuç bölgesinde tıklanan odaklanabilir öğe (yakalama aşamasında, satırın onClick'inden önce kaydedilir),
  // yoksa odaklı öğe. WebKit/Safari düğmeye tıklayınca düğmeyi odaklamaz; activeElement body ya da odaklanabilir bir
  // ata (main, tabIndex -1) olur. Klavyeyle açılışta (tablo satırında Enter) tuş basımı kaydı sıfırlar, odaklı öğe kullanılır.
  // Tam ekran ayrıntıda (telefon, tablet) liste gizlenir: listenin kaydırma konumu saklanır, ayrıntı üstten başlar;
  // dönüşte konum geri yüklenir ve odak açan satıra (kaydırmadan) döner.
  const acan = useRef<HTMLElement | null>(null);
  const tiklanan = useRef<HTMLElement | null>(null);
  const odakGeri = useRef(false);
  const listeKonumu = useRef<number | null>(null);
  const masaustuRef = useRef(masaustu);
  masaustuRef.current = masaustu;
  const tiklamaKaydet = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    tiklanan.current = event.target instanceof Element ? event.target.closest<HTMLElement>(ODAKLANABILIR) : null;
  }, []);
  const tiklamaSifirla = useCallback(() => { tiklanan.current = null; }, []);
  const ac = useCallback((row: RecordRow) => {
    const active = document.activeElement;
    acan.current = tiklanan.current ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    tiklanan.current = null;
    listeKonumu.current = masaustuRef.current ? null : kaydirmaKabi(kok.current)?.scrollTop ?? null;
    setBildirim(null);
    setSecili(row.id);
  }, []);
  const kapat = useCallback(() => {
    // Dar ekranda tam sayfa kapanınca liste görünür olur, odak burada döner. Masaüstünde Drawer de açıldığı andaki
    // odaklı öğeye döndürür; Safari'de o öğe body olduğundan dönüş burada da yapılır (aynı öğeyse etkisizdir).
    // Açan öğe bilinmiyor ya da belgeden düştüyse (liste yeniden kuruldu) seçili kaydın satırı kullanılır; seçim
    // işareti kapanınca kalkacağı için öğe şimdi bulunur.
    if (!acan.current?.isConnected) acan.current = seciliSatirOgesi(kok.current);
    odakGeri.current = true;
    setBildirim(null);
    setSecili(null);
  }, []);

  const seciliSatir = secili ? tumSatirlar.find(row => row.id === secili) : undefined;
  const detayAcik = Boolean(seciliSatir);
  const tamSayfa = detayAcik && !masaustu;
  const tamSayfaId = tamSayfa ? seciliSatir!.id : null;

  useLayoutEffect(() => {
    if (!tamSayfaId) return;
    const kap = kaydirmaKabi(kok.current);
    if (kap) kap.scrollTop = 0;
  }, [tamSayfaId]);
  useLayoutEffect(() => {
    if (secili !== null || listeKonumu.current === null) return;
    const kap = kaydirmaKabi(kok.current);
    if (kap) kap.scrollTop = listeKonumu.current;
  }, [secili]);
  useEffect(() => {
    if (secili !== null || !odakGeri.current) return;
    odakGeri.current = false;
    const geriYuklendi = listeKonumu.current !== null;
    listeKonumu.current = null;
    if (acan.current?.isConnected) acan.current.focus(geriYuklendi ? { preventScroll: true } : undefined);
  }, [secili]);

  // Durum değişince yeni beliren "Geri al" görünür alana gelir (en yakın kenar; odak taşınmaz). Kısa yükseklikte (yatay
  // telefon) bildirim ayrıntı katmanının altlığına girince kayan gövde kısalır; gövdenin altındaki durum seçiminin hemen
  // ardından gelen eylem altlığın arkasında kalırdı. Bildirim ve eylem aynı çizimde yerindedir (yerleşim efekti).
  useLayoutEffect(() => {
    if (bildirim?.tone !== 'bilgi' || !secili) return;
    const ayrinti = Array.from(kok.current?.querySelectorAll('[role="dialog"][data-record]') ?? []).find(el => el.getAttribute('data-record') === secili);
    const geriAl = Array.from(ayrinti?.querySelectorAll('button') ?? []).find(dugme => dugme.textContent?.trim() === GERI_AL);
    geriAl?.scrollIntoView({ block: 'nearest' });
  }, [bildirim, secili]);

  const seciliHam = secili ? kayitlar.rows.find(record => record.id === secili) : undefined;
  const bekleyen = secili ? changeSet.pendingFor(secili) : [];
  const seciliKayit = seciliHam ? guncelKayit(seciliHam, bekleyen) : undefined;
  const hedefler = seciliKayit ? izinliHedefler(seciliKayit, akislar.rows, termsById) : [];
  const durumSecenekleri: StatusLabel[] = seciliSatir
    ? [seciliSatir.status, ...hedefler.map(term => ({ label: term.label, tone: toneForCode(term.code) }))]
    : [];

  const durumDegistir = async (next: StatusLabel) => {
    if (!seciliKayit || !seciliSatir || next.label === seciliSatir.status.label) return;
    const hedef = hedefler.find(term => term.label === next.label);
    if (!hedef) {
      setBildirim({ tone: 'hata', text: `Hata: ${seciliSatir.status.label} → ${next.label} geçişi iş akışında yok.` });
      return;
    }
    const sonuc = durumGecisi(seciliKayit, hedef.id, akislar.rows, terimler.rows);
    if (!sonuc.ok) {
      setBildirim({ tone: 'hata', text: sonuc.reason });
      return;
    }
    try {
      await changeSet.add({
        recordId: seciliKayit.id,
        kind: 'state_change',
        before: { axis: sonuc.axis, code: sonuc.from.code, term_id: sonuc.from.term_id },
        after: { axis: sonuc.axis, code: sonuc.to.code, term_id: sonuc.to.term_id },
      });
      setBildirim({ tone: 'bilgi', text: `Durum yerel olarak değişti: ${seciliSatir.status.label} → ${hedef.label}. Değişiklik kaynağa yazılmadı.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setBildirim({ tone: 'hata', text: text.startsWith('Hata: ') ? text : `Hata: ${text}` });
    }
  };

  const sonOp = bekleyen.length ? bekleyen[bekleyen.length - 1] : undefined;
  const geriAl = async () => {
    if (!sonOp) return;
    const sonuc = await changeSet.undo(sonOp.opId);
    setBildirim(sonuc.ok ? { tone: 'bilgi', text: 'Değişiklik geri alındı.' } : { tone: 'hata', text: `Hata: ${sonuc.reason}` });
  };

  const kaynak = useMemo(() => {
    if (!seciliHam) return [];
    const list: { label: string; value: string }[] = [];
    const provenance = seciliHam.provenance;
    if (provenance?.sheet_title) list.push({ label: 'Sayfa', value: provenance.sheet_title });
    if (provenance && Number.isFinite(provenance.row)) list.push({ label: 'Satır', value: sayi.format(provenance.row) });
    if (seciliHam.source_record_id) list.push({ label: 'Kaynak kimliği', value: seciliHam.source_record_id });
    if (generation.generationId) list.push({ label: 'Nesil', value: generation.generationId.slice(0, 12) });
    if (bekleyen.length) list.push({ label: 'Yerel değişiklik', value: `${sayi.format(bekleyen.length)} bekleyen; kaynağa yazılmadı` });
    return list;
  }, [seciliHam, generation.generationId, bekleyen.length]);

  // --- Özet: Planlanan · Gerçekleşen · Fiyatı eksik (plan ve gerçek ayrı girdiler) ---
  const ozet = useMemo<PageHeaderSummary[]>(() => {
    const plan: ParaToplami = new Map();
    const gercek: ParaToplami = new Map();
    let planSayisi = 0;
    let gercekSayisi = 0;
    let fiyatsiz = 0;
    for (const row of tumSatirlar) {
      if (paraEkle(plan, row.planned)) planSayisi += 1;
      else fiyatsiz += 1;
      if (paraEkle(gercek, row.actual)) gercekSayisi += 1;
    }
    return [
      { label: 'Planlanan', value: toplamMetni(plan, FIYAT_YOK), note: `${sayi.format(planSayisi)} kayıt` },
      { label: 'Gerçekleşen', value: toplamMetni(gercek, HENUZ_YOK), note: `${sayi.format(gercekSayisi)} kayıt` },
      { label: 'Fiyatı eksik', value: sayi.format(fiyatsiz), note: 'kayıt' },
    ];
  }, [tumSatirlar]);
  const summary = useAyniIcerik(ozet);

  // --- Durumlar ---
  const manifestYok = generation.manifest === null;
  const pageError = manifestYok && generation.state === 'error';
  const pageLoading = manifestYok && !pageError;
  const yukleniyor = sorgu.loading || terimler.loading || odalar.loading;
  const hata = sorgu.error ?? kayitlar.error;
  const kaynaktaYok = !yukleniyor && !hata && sorgu.total === 0;
  const ozetGoster = !(yukleniyor || hata || manifestYok || kaynaktaYok);

  // --- Kararlı öğeler: seçim ve yerel değişiklik bunları yeniden çizdirmez ---
  const durumBilgisi = useMemo(() => dataStatus(generation), [generation]);
  const header = useMemo(
    () => (
      <PageHeader
        location={location}
        section={KONUM_BOLUM}
        title={BASLIK}
        purpose={AMAC}
        primary={
          <Button variant="primary" icon="plus" disabled aria-describedby={notId}>
            Alım ekle
          </Button>
        }
        status={durumBilgisi}
        summary={ozetGoster ? summary : undefined}
      >
        <p id={notId} className="aile-alimlar-not aile-kucuk aile-ikincil">{EKLE_NOTU}</p>
      </PageHeader>
    ),
    [location, notId, durumBilgisi, ozetGoster, summary],
  );

  const siralamaSec = useCallback((option: SortOption) => setSira(SIRALAR.find(item => item.key === option.key) ?? VARSAYILAN_SIRA), []);
  // Çekmece kapanınca odak açan düğmeye döner. WebKit/Safari düğmeye tıklayınca onu odaklamaz (activeElement body ya da
  // odaklanabilir bir ata olur): açan öğe tıklamadan bilinir; klavyeyle (Enter/Space) etkinleştirme de click üretir.
  const govdeTiklamaKaydet = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    govdeTiklanan.current = event.target instanceof Element ? event.target.closest<HTMLElement>(ODAKLANABILIR) : null;
  }, []);
  const filtreAc = useCallback(() => {
    const active = document.activeElement;
    filtreDugmesi.current = govdeTiklanan.current ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    govdeTiklanan.current = null;
    setFiltreAcik(true);
  }, []);
  const filtreKapat = useCallback(() => setFiltreAcik(false), []);
  const sonucSayisi = rows.length;

  const sorguCubugu = useMemo(
    () => (
      <QueryBar
        mode={etkinMod}
        onModeChange={setMode}
        supported={destek.modes}
        unsupportedReason={destek.reasons}
        search={search}
        onSearchChange={setSearch}
        sort={sira}
        sortOptions={SIRALAR}
        onSort={siralamaSec}
        activeFilters={activeFilters}
        onOpenFilters={filtreAc}
        resultCount={sonucSayisi}
      />
    ),
    [etkinMod, destek, search, sira, siralamaSec, activeFilters, filtreAc, sonucSayisi],
  );

  const openKeys = ACIK_BOYUTLAR[etkinMod];
  const filtreCekmecesi = useMemo(
    () => (
      <FilterDrawer
        open={filtreAcik}
        onClose={filtreKapat}
        resultCount={sonucSayisi}
        facets={facets}
        onToggle={toggle}
        onClear={temizle}
        openKeys={openKeys}
        returnFocusTo={filtreDugmesi}
      />
    ),
    [filtreAcik, filtreKapat, sonucSayisi, facets, toggle, temizle, openKeys],
  );

  // --- Sonuçlar (mod içeriği). genis: masaüstü yerleşimi (liste başlığı, ayrıntı açıkken sıkı satır). ---
  const icerik = useCallback(
    (genis: boolean): ReactNode => {
      if (rows.length === 0) return <EmptyState filters={activeFilters} onClear={temizle} />;
      if (etkinMod === 'table') {
        return (
          <ResponsiveTable<RecordRow>
            columns={SUTUNLAR}
            rows={rows}
            caption={BASLIK}
            mobileCaption={`${sayi.format(rows.length)} kayıt`}
            selectedKey={secili ?? undefined}
            onRowClick={ac}
            openLabel="Ayrıntıyı aç"
          />
        );
      }
      if (etkinMod === 'kanban') {
        return (
          <>
            <p className="aile-alimlar-not aile-ikincil">{`${sayi.format(rows.length)} kayıt · ${device === 'phone' ? KANBAN_NOT_DAR : KANBAN_NOT_GENIS}`}</p>
            <Kanban items={rows} selectedKey={secili ?? undefined} onOpen={ac} label={KANBAN_ETIKET} />
          </>
        );
      }
      if (etkinMod === 'timeline') {
        return (
          <>
            <div className="aile-alimlar-arac">
              <Select
                label="Tarih alanı"
                options={ZAMAN_ALANLARI}
                value={zamanAlani}
                onChange={value => setZamanAlani(value as ZamanAlani)}
                className="aile-alimlar-secim"
              />
            </div>
            <Timeline items={rows} dateField={zamanAlani} selectedKey={secili ?? undefined} onOpen={ac} />
          </>
        );
      }
      if (etkinMod === 'pivot') {
        const pivot = pivotHesapla(rows);
        const yigin = (
          <>
            {baskaParaVar(rows) ? <p className="aile-alimlar-not aile-ikincil">Telefon özeti yalnız TRY tutarlarını gösterir; diğer para birimleri tabloda ayrı yazılır.</p> : null}
            <PivotStack
              columns={pivot.sutunlar}
              rows={pivotYiginSatirlari(pivot)}
              caption={`${sayi.format(pivot.satirlar.length - 1)} oda · ${sayi.format(pivot.sutunlar.length)} durum`}
              totalLabel="Genel toplam"
            />
          </>
        );
        return (
          <>
            <p className="aile-alimlar-not aile-ikincil">
              Satırlar: Oda · Sütunlar: Durum · Değer: Plan ve gerçek ayrı; satır ve sütun toplamı her ölçü için ayrı hesaplanır.
            </p>
            <AlimlarPivotTablo pivot={pivot} wideFallback={yigin} />
          </>
        );
      }
      return <AlimListesi rows={rows} seciliId={secili} dar={!genis || detayAcik} baslik={genis && !detayAcik} onAc={ac} />;
    },
    [rows, activeFilters, temizle, etkinMod, secili, ac, zamanAlani, detayAcik, device],
  );
  const sonucBolgesi = useCallback(
    (genis: boolean) => (
      <section className="aile-alimlar-sonuc" aria-label={SONUCLAR} onClickCapture={tiklamaKaydet} onKeyDownCapture={tiklamaSifirla}>
        {icerik(genis)}
      </section>
    ),
    [icerik, tiklamaKaydet, tiklamaSifirla],
  );
  const sonucDar = useMemo(() => sonucBolgesi(false), [sonucBolgesi]);
  const sonucGenis = useMemo(() => (masaustu ? sonucBolgesi(true) : null), [masaustu, sonucBolgesi]);

  // Durum bölgesi hep çizilir (canlı bölge önce var olmalı); bildirim kullanıcının baktığı yerde görünür. Sayfada alta
  // yapışıktır; ayrıntı katman olarak açıkken (telefon/tablet tam ekran, geniş modül yokken masaüstü örtülü panel) katmanın
  // altlığına (DetailPanel footer) taşınır: katman sayfanın üstündedir (aria-modal), dışarıdaki bölge arkada kalır ve
  // okunmaz. Bölge ayrıntıyla birlikte açılır, metin sonra gelir; tek yerde çizilir (iki kopya yok).
  const bildirimYuvasi = (altlik: boolean) => (
    <div className={altlik ? 'aile-alimlar-bildirim-yuva aile-alimlar-bildirim-yuva--altlik' : 'aile-alimlar-bildirim-yuva'}>
      <div role="status">
        {bildirim?.tone === 'bilgi' ? <p className="aile-alimlar-bildirim" data-tone="bilgi">{bildirim.text}</p> : null}
      </div>
      <div role="alert">
        {bildirim?.tone === 'hata' ? <p className="aile-alimlar-bildirim" data-tone="hata">{bildirim.text}</p> : null}
      </div>
    </div>
  );

  if (pageError) {
    return (
      <div className="aile-alimlar">
        <div className="aile-alimlar-govde">
          {header}
          <ErrorState title="Nesil okunamadı" message={generation.message ?? 'Hata: nesil manifesti okunamadı.'} onRetry={() => void generation.refresh()} />
        </div>
      </div>
    );
  }
  if (pageLoading || yukleniyor) {
    return (
      <div className="aile-alimlar">
        <div className="aile-alimlar-govde">
          {header}
          <LoadingShell rows={6} narrow={device === 'phone'} label="Alımlar yükleniyor" />
        </div>
      </div>
    );
  }
  if (hata) {
    return (
      <div className="aile-alimlar">
        <div className="aile-alimlar-govde">
          {header}
          <ErrorState title="Alımlar okunamadı" message={hata} onRetry={() => void generation.refresh()} />
        </div>
      </div>
    );
  }
  if (kaynaktaYok) {
    return (
      <div className="aile-alimlar">
        <div className="aile-alimlar-govde">
          {header}
          <EmptyState
            title={KAYNAKTA_YOK}
            message="Nesilde purchase_needs koleksiyonu boş ya da yok. Panel alım uydurmaz; kaynak e-tabloya kayıt eklenince burada görünür."
          />
        </div>
      </div>
    );
  }

  const detay: DetailPanelProps | null = seciliSatir
    ? {
      row: seciliSatir,
      source: kaynak,
      onClose: kapat,
      statusOptions: durumSecenekleri,
      onChangeStatus: changeSet.ready && seciliKayit ? next => void durumDegistir(next) : undefined,
      onUndo: changeSet.ready && sonOp ? () => void geriAl() : undefined,
    }
    : null;

  /** Ayrıntı sayfanın kendi katmanında (geniş yerleşimde ayrıntı AlimlarGenis'in sağ sütununda, akışta). */
  const katmanDetay = detay && !genisYerlesim ? detay : null;

  const darGovde = (
    <>
      {sonucDar}
      {filtreCekmecesi}
    </>
  );

  return (
    <div ref={kok} className="aile-alimlar" data-device={device}>
      <div className="aile-alimlar-govde" hidden={tamSayfa} onClickCapture={govdeTiklamaKaydet}>
        {header}
        {sorguCubugu}
        {masaustu ? (
          <AlimlarGenis
            mode={etkinMod}
            facets={facets}
            onToggle={toggle}
            onClear={temizle}
            openKeys={openKeys}
            filtreSayisi={activeFilters.length}
            sonuclar={sonucGenis}
            detay={detay}
            wideFallback={darGovde}
          />
        ) : darGovde}
      </div>
      {katmanDetay ? <DetailPanel key={katmanDetay.row.id} {...katmanDetay} footer={bildirimYuvasi(true)} /> : bildirimYuvasi(false)}
    </div>
  );
}
