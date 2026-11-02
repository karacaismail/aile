import type { ResponsiveColumn } from '../../shell/contracts';
import { Money } from '../../ui/Money';
import { StatusText } from '../../ui/StatusText';
import { BILINMIYOR, FIYAT_YOK, GECIKTI, HENUZ_YOK, SONUC, tarihVeyaYok, type GorevSatiri, type KontrolSatiri } from './model';

// Görev ve kontrol sütunları: telefon (ResponsiveTable → akordeon) ve geniş modül aynı tanımı kullanır. Sütun rolleri
// (m) akordeonun kapalı satırını kurar: ad (title), kod · tür (meta), durum (status), planlanan (lead); gerisi açılınca.
// Plan ve gerçek ayrı sütundur; eksik bilgi adıyla ("Fiyat yok", "Henüz yok", "Bilinmiyor", "Tarih yok").

/** Proje ayrıntısındaki görevler (telefon): proje zaten başlıkta, ayrı sütun yok. */
export const GOREV_SUTUNLARI: readonly ResponsiveColumn<GorevSatiri>[] = [
  { key: 'label', title: 'Görev', minWidth: 200, m: 'title', render: row => row.label },
  { key: 'kod', title: 'Kod · Tür', minWidth: 160, m: 'meta', render: row => `${row.kod} · ${row.tur}` },
  { key: 'status', title: 'Durum', minWidth: 144, m: 'status', render: row => <StatusText label={row.status.label} tone={row.status.tone} /> },
  { key: 'planned', title: 'Planlanan', align: 'right', minWidth: 128, m: 'lead', render: row => <Money value={row.planned} label={FIYAT_YOK} /> },
  { key: 'actual', title: 'Gerçekleşen', align: 'right', minWidth: 128, render: row => <Money value={row.actual} label={HENUZ_YOK} /> },
  { key: 'room', title: 'Oda', minWidth: 128, render: row => row.room ?? BILINMIYOR },
  { key: 'owner', title: 'Sorumlu', minWidth: 128, render: row => row.owner ?? BILINMIYOR },
  { key: 'startOn', title: 'Başlangıç', minWidth: 112, render: row => tarihVeyaYok(row.startOn) },
  { key: 'endOn', title: 'Bitiş', minWidth: 112, render: row => (row.gecikti ? `${tarihVeyaYok(row.endOn)} · ${GECIKTI}` : tarihVeyaYok(row.endOn)) },
];

/** Bütün görevler (geniş): Proje sütunu kimlik ve tutarlardan sonra. */
export const GOREV_SUTUNLARI_GENIS: readonly ResponsiveColumn<GorevSatiri>[] = [
  ...GOREV_SUTUNLARI.slice(0, 5),
  { key: 'proje', title: 'Proje', minWidth: 160, render: row => row.projeAdi },
  ...GOREV_SUTUNLARI.slice(5),
];

export const KONTROL_SUTUNLARI: readonly ResponsiveColumn<KontrolSatiri>[] = [
  { key: 'label', title: 'Kontrol', minWidth: 200, m: 'title', render: row => row.label },
  { key: 'kod', title: 'Kod', minWidth: 112, m: 'meta', render: row => row.kod },
  { key: 'sonuc', title: 'Sonuç', minWidth: 112, m: 'status', render: row => <StatusText label={SONUC[row.sonuc].label} tone={SONUC[row.sonuc].tone} /> },
  { key: 'durum', title: 'Kontrol durumu', minWidth: 160, render: row => <StatusText label={row.status.label} tone={row.status.tone} /> },
  { key: 'room', title: 'Oda', minWidth: 128, render: row => row.room ?? BILINMIYOR },
];

/** Telefonda grup başlığı: geciken grup üstte (ResponsiveTable "gecik" içeren grubu öne alır). */
export const gorevGrubu = (row: GorevSatiri) => (row.gecikti ? `${GECIKTI} · ${row.status.label}` : row.status.label);
export const kontrolGrubu = (row: KontrolSatiri) => SONUC[row.sonuc].label;
