import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { AccordionItem, ActiveFilter, SortOption } from '../../shell/contracts';
import { AccordionList, Button, Select, Tag, TextField } from '../../ui';
import { grupOf, LISTE_ADI, SIRALAMALAR, type OdemeRow, type SiralamaAnahtari } from './model';
import { Sayfalama } from './Sayfalama';
import { GerceklesenTutar, PlanTutari } from './Tutar';

// Telefon (temel) sunumu: yerel HTML + ui temel bileşenleri; antd'ye özgü geniş kod yok (tablo/zaman çizelgesi
// OdemelerGenis.wide.tsx'te). Sıra: sorgu (arama · Filtreler (N) · Sıralama, etkin filtreler) → durum içeriği ya da
// tarih gruplu akordeon liste. Görünüm modu seçimi yok: telefonda tek sunum vardır (tablo akordeona dönüşür), devre dışı
// beş mod ve gerekçeleri 320 px'te ilk ekranı doldururdu. Filtre ve sıralama alttan açılır (FilterDrawer, Select).
// Liste: h2 "Tahmini ödemeler" bölgesi; gruplar Tarihi geçenler · Bu hafta · aylar; ilk satır açık (AccordionList);
// ilk ekranda 10 satır, "N tahmini ödeme daha göster" ile 10'ar artar ve odak yeni gelen ilk satıra geçer.

const ARA = 'Ara';
const ARA_IPUCU = 'Ad, tür veya kimlik kodu';
const SIRALAMA = 'Sıralama';
const SORGU = 'Sorgu';
const ETKIN_FILTRELER = 'Etkin filtreler';
const TUMUNU_TEMIZLE = 'Tümünü temizle';
const SATIR_BASLIGI = 'button[aria-expanded]';

export interface OdemeSorgusuProps {
  arama: string;
  onArama(value: string): void;
  siralama: SortOption;
  onSiralama(sort: SortOption): void;
  etkinFiltreler: readonly ActiveFilter[];
  onFiltreler(): void;
}

/** Telefon sorgu şeridi: arama tam genişlik; Filtreler (N) + Sıralama yan yana, sığmazsa alt alta. */
export function OdemeSorgusu({ arama, onArama, siralama, onSiralama, etkinFiltreler, onFiltreler }: OdemeSorgusuProps) {
  const sec = (key: string) => {
    const secenek = SIRALAMALAR.find(option => option.key === key);
    if (secenek) onSiralama(secenek);
  };
  return (
    <div role="search" aria-label={SORGU} className="aile-odemeler-sorgu">
      <TextField
        label={ARA}
        icon="search"
        type="search"
        inputMode="search"
        value={arama}
        onChange={onArama}
        placeholder={ARA_IPUCU}
        autoComplete="off"
      />
      <div className="aile-odemeler-sorgu__satir">
        <Button variant="secondary" icon="filter" onClick={onFiltreler} aria-haspopup="dialog">
          {`Filtreler (${etkinFiltreler.length})`}
        </Button>
        <Select
          label={SIRALAMA}
          icon="sort"
          hideLabel
          options={SIRALAMALAR.map(option => ({ value: option.key, label: option.label }))}
          value={siralama.key}
          onChange={sec}
          className="aile-odemeler-sorgu__sirala"
        />
      </div>
      {etkinFiltreler.length > 0 ? (
        <div className="aile-odemeler-sorgu__etkin">
          <span className="aile-kucuk aile-ikincil">{ETKIN_FILTRELER}</span>
          {etkinFiltreler.map(filter => (
            <Tag key={filter.id} removable label={filter.label} onRemove={filter.onRemove}>{filter.label}</Tag>
          ))}
          <Button variant="quiet" onClick={() => etkinFiltreler.forEach(filter => filter.onRemove())}>{TUMUNU_TEMIZLE}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** Akordeon gövdesi: etiket–değer listesi (plan ve gerçek ayrı satırlar; tutar ui/Money). */
function ayrinti(row: OdemeRow): [ReactNode, ReactNode][] {
  return [
    ['Tarih', row.dateText],
    ['Planlanan', <PlanTutari row={row} />],
    ['Gerçekleşen', <GerceklesenTutar row={row} />],
    ['Tür', row.type],
    ['Kesinlik', row.certainty],
    ['Kimlik', row.code],
    ['Kaynak', row.source],
  ];
}

export interface OdemeListesiProps {
  /** Görünen (sıralı, sayfalanmış) satırlar. */
  satirlar: readonly OdemeRow[];
  /** Filtrelenmiş toplam. */
  toplam: number;
  /** "20 tahmini ödeme · 1 tarihi geçti" (filtrelenmiş küme). */
  sayim: string;
  siralama: SiralamaAnahtari;
  adim: number;
  onDahaFazla(): void;
  /** Sorgu değişince akordeon yeniden kurulur (yeni sonucun ilk satırı açık gelir). */
  listeAnahtari: string;
}

/** Tarih gruplu akordeon liste; kapalı satır ad, tarih · tür, durum ve planlanan tutarı gösterir. */
export function OdemeListesi({ satirlar, toplam, sayim, siralama, adim, onDahaFazla, listeAnahtari }: OdemeListesiProps) {
  const baslikId = useId();
  const kok = useRef<HTMLElement>(null);
  const odak = useRef<number | null>(null);

  useLayoutEffect(() => {
    const hedef = odak.current;
    if (hedef === null) return;
    odak.current = null;
    kok.current?.querySelectorAll<HTMLButtonElement>(SATIR_BASLIGI)[hedef]?.focus();
  }, [satirlar.length]);

  const items: AccordionItem[] = satirlar.map(row => ({
    key: row.id,
    title: row.label,
    meta: `${row.dateText} · ${row.type}`,
    status: <Tag tone={row.status.tone}>{row.status.label}</Tag>,
    lead: <PlanTutari row={row} />,
    body: ayrinti(row),
    group: grupOf(row, siralama).label,
  }));

  return (
    <section ref={kok} className="aile-odemeler-liste" aria-labelledby={baslikId}>
      <h2 id={baslikId}>{LISTE_ADI}</h2>
      {/* Tablonun telefon biçimi: ResponsiveTable'ın yerleşim kancası (data-layout="accordion") aynen taşınır. */}
      <div className="aile-odemeler-akordeon" data-layout="accordion">
        <AccordionList key={listeAnahtari} items={items} caption={sayim} />
      </div>
      <Sayfalama
        gosterilen={satirlar.length}
        toplam={toplam}
        adim={adim}
        odakYonet={false}
        onDahaFazla={() => { odak.current = satirlar.length; onDahaFazla(); }}
      />
    </section>
  );
}

export interface OdemelerTelefonProps extends OdemeSorgusuProps, Omit<OdemeListesiProps, 'siralama'> {
  /** Hazır olmayan durumun içeriği (yükleniyor, hata, boş); verilirse liste yerine çizilir. */
  durum: ReactNode | null;
}

export function OdemelerTelefon({ durum, siralama, ...props }: OdemelerTelefonProps) {
  return (
    <>
      <OdemeSorgusu {...props} siralama={siralama} />
      {durum ?? <OdemeListesi {...props} siralama={siralama.key === 'tutar' ? 'tutar' : 'tarih'} />}
    </>
  );
}
