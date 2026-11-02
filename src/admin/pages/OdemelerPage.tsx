import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Adaptive, lazyWide, useProfile } from '../adaptive';
import { sumMoney as paraTopla, useCollection, useGeneration, type GenerationState } from '../data';
import type { DataStatusProps, DataStatusState, Money as MoneyValue, SortOption, ViewMode } from '../shell/contracts';
import { FilterDrawer } from '../shell/FilterDrawer';
import { PageHeader } from '../shell/PageHeader';
import { Button, EmptyState, ErrorState, LoadingShell } from '../ui';
import { BILINMIYOR } from '../ui/Money';
import {
  BOS_SECIM, degistir, etkinFiltreler, facetler, filtrele, filtreAnahtariMi, GENIS_SAYFA, odemeKaynagi, odemeKaynagiMetni,
  ozet, sayimMetni, SIRALAMALAR, sirala, TELEFON_SAYFA, todayOf, toOdemeRows, TUR_BILINMIYOR, type FiltreAnahtari, type Secimler,
} from './odemeler/model';
import { OdemelerTelefon } from './odemeler/OdemelerTelefon';
import './OdemelerPage.css';

// Tasarım: README.md › Sayfa iskeleti, Veri durumları, Uyarlanır teslim; ekranlar.md › Ödemeler (SayfaOdemeler /
// SayfaOdemelerDar); bundle.js › Pages.Odemeler. W0 uyarlamalı teslim: telefon temel sunumu (OdemelerTelefon: sorgu +
// tarih gruplu akordeon, ilk ekranda 10 satır) her profilde hazırdır; geniş sunum (tablo, zaman çizelgesi, FilterArea)
// pages/odemeler/OdemelerGenis.wide.tsx içinde lazyWide ile yalnız geniş profilde iner. Sorgu, filtre, sıralama ve
// sayfalama durumu bu sayfadadır: profil değişince (döndürme, pencere) girdi kaybolmaz.
// Veri gerçeği (pages/odemeler/model.ts): nesilde `payments` yok → "Kaynakta ödeme kaydı yok" adıyla; liste bütçe tahmin
// olaylarıdır ve ödeme gibi görünmez. Ana eylem "Ödeme kaydet" yazma yolu olmadığı için gerekçesiyle devre dışıdır.

export { isoToDay, toOdemeRow, trToDay, type OdemeRow } from './odemeler/model';

/** Geriye uyumlu dışa aktarım: aynı para birimindeki tutarlar toplanır; boş liste null; karışık birim ya da bozuk tutar
 *  undefined ("Bilinmiyor"). Hesap data/actuals.ts sumMoney'dedir (tam sayı aritmetiği). */
export function sumMoney(values: readonly MoneyValue[]): MoneyValue | null | undefined {
  if (values.length === 0) return null;
  const total = paraTopla(values);
  return total.missing === 0 && total.money ? total.money : undefined;
}

export interface OdemelerPageProps {
  location: string;
  /** Bugünün tarihi (gruplama ve "Tarihi geçti · N gün" için); testte sabitlenir. */
  now?: () => Date;
}

const OdemelerGenis = lazyWide('odemeler-genis', () => import('./odemeler/OdemelerGenis.wide'));

const BOLUM = 'Para';
const BASLIK = 'Ödemeler';
const AMAC = 'Planlanan, yapılan ve geciken ödemeleri tarihleriyle izleyin.';
const NOT = 'Liste bütçe tahmininden gelir: her satır bir tahmin olayıdır, ödeme kaydı değildir.';
const KAYNAK_BOS_BASLIK = 'Kaynakta tahmini ödeme yok';
const KAYNAK_BOS_METIN = 'Nesilde forecast_events koleksiyonu boş. Bütçe tahmini üretilince tahmini ödemeler burada görünür.';

const DATA_STATUS: Readonly<Record<GenerationState, DataStatusState>> = {
  idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error',
};

export function OdemelerPage({ location, now }: OdemelerPageProps) {
  const profil = useProfile();
  const generation = useGeneration();
  const events = useCollection('forecast_events');
  const today = todayOf(now ? now() : new Date());
  const gerekceId = useId();

  const [mod, setMod] = useState<ViewMode>('table');
  const [arama, setArama] = useState('');
  const [siralama, setSiralama] = useState<SortOption>(SIRALAMALAR[0]!);
  const [secim, setSecim] = useState<Secimler>(BOS_SECIM);
  const [sayfa, setSayfa] = useState(1);
  const [filtreAcik, setFiltreAcik] = useState(false);

  const rows = useMemo(() => toOdemeRows(events.rows, today), [events.rows, today]);
  const siraAnahtari = siralama.key === 'tutar' ? 'tutar' : 'tarih';
  const sonuc = useMemo(() => sirala(filtrele(rows, arama, secim), siraAnahtari), [rows, arama, secim, siraAnahtari]);
  const adim = profil === 'phone' ? TELEFON_SAYFA : GENIS_SAYFA;
  const gorunen = useMemo(() => sonuc.slice(0, sayfa * adim), [sonuc, sayfa, adim]);
  const kaynak = odemeKaynagi(generation.manifest);
  const kaynakMetni = odemeKaynagiMetni(kaynak);

  // Sorgu değişince ilk sayfaya dönülür.
  const aramaDegisti = useCallback((value: string) => { setArama(value); setSayfa(1); }, []);
  const siralamaDegisti = useCallback((value: SortOption) => { setSiralama(value); setSayfa(1); }, []);
  const onToggle = useCallback((facetId: string, value: string) => {
    if (!filtreAnahtariMi(facetId)) return;
    setSecim(current => ({ ...current, [facetId]: degistir(current[facetId], value) }));
    setSayfa(1);
  }, []);
  const onClear = useCallback(() => { setSecim(BOS_SECIM); setSayfa(1); }, []);
  const kaldir = useCallback((facet: FiltreAnahtari, value: string) => onToggle(facet, value), [onToggle]);
  const temizle = useCallback((facet: FiltreAnahtari) => { setSecim(current => ({ ...current, [facet]: [] })); setSayfa(1); }, []);

  const turEtiketleri = useMemo(() => new Map(rows.map(row => [row.typeKey, row.type] as const)), [rows]);
  const turEtiketi = useCallback((key: string) => (key === TUR_BILINMIYOR ? BILINMIYOR : turEtiketleri.get(key) ?? key), [turEtiketleri]);
  const etkin = etkinFiltreler(secim, turEtiketi, kaldir, temizle);
  const facets = useMemo(() => facetler(rows, secim), [rows, secim]);

  const yenile = () => void generation.refresh();
  const status: DataStatusProps = {
    state: DATA_STATUS[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: yenile,
  };

  const yukleniyor = events.loading || generation.state === 'idle' || generation.state === 'checking';
  let durum: ReactNode = null;
  if (events.error && rows.length === 0) {
    durum = <ErrorState message={events.error} onRetry={yenile} />;
  } else if (generation.state === 'error' && rows.length === 0) {
    durum = <ErrorState message={generation.message ?? undefined} onRetry={yenile} />;
  } else if (yukleniyor && rows.length === 0) {
    durum = <LoadingShell narrow={profil === 'phone'} />;
  } else if (rows.length === 0) {
    durum = <EmptyState title={KAYNAK_BOS_BASLIK} message={KAYNAK_BOS_METIN} />;
  } else if (sonuc.length === 0) {
    const aramaMetni = arama.trim();
    durum = (
      <EmptyState
        filters={[...etkin, ...(aramaMetni ? [`Arama: ${aramaMetni}`] : [])]}
        onClear={() => { onClear(); setArama(''); }}
      />
    );
  }

  const ortak = {
    arama, onArama: aramaDegisti, siralama, onSiralama: siralamaDegisti, etkinFiltreler: etkin,
    onFiltreler: () => setFiltreAcik(true), durum, satirlar: gorunen, toplam: sonuc.length, sayim: sayimMetni(sonuc), adim,
    onDahaFazla: () => setSayfa(current => current + 1),
  };
  const telefon = (
    <OdemelerTelefon {...ortak} listeAnahtari={`${siralama.key}|${arama}|${JSON.stringify(secim)}`} />
  );

  return (
    <div className="aile-odemeler">
      <PageHeader
        location={location}
        section={BOLUM}
        title={BASLIK}
        purpose={AMAC}
        primary={
          <span className="aile-odemeler-birincil">
            <Button variant="primary" icon="plus" disabled aria-describedby={gerekceId}>Ödeme kaydet</Button>
            <span id={gerekceId} className="aile-kucuk aile-ikincil">{`${kaynakMetni}.`}</span>
          </span>
        }
        status={status}
        summary={yukleniyor && rows.length === 0 ? undefined : ozet(rows, kaynak)}
      />
      {rows.length > 0 ? <p role="note" className="aile-odemeler-not aile-ikincil">{NOT}</p> : null}
      <Adaptive
        phone={telefon}
        wide={<OdemelerGenis {...ortak} mod={mod} onMod={setMod} facets={facets} onToggle={onToggle} onClear={onClear} />}
      />
      {profil !== 'desktop' ? (
        <FilterDrawer
          open={filtreAcik}
          onClose={() => setFiltreAcik(false)}
          resultCount={sonuc.length}
          facets={facets}
          onToggle={onToggle}
          onClear={onClear}
        />
      ) : null}
    </div>
  );
}
