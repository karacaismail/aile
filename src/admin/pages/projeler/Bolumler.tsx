import { useId, useMemo, type ReactNode } from 'react';
import type { AccordionItem } from '../../shell/contracts';
import { AccordionList } from '../../ui/AccordionList';
import { ErrorState } from '../../ui/ErrorState';
import { LoadingShell } from '../../ui/LoadingShell';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { BILINMIYOR, SONUC, sayi, type KontrolSatiri, type KontrolSonucu, type SablonGorunumu } from './model';
import { KONTROL_SUTUNLARI, kontrolGrubu } from './sutunlar';

// Sayfa bölümleri (telefon ve geniş ortak): Kontroller (geçti / kaldı / eksik ayrı sayılır; telefonda akordeon, geniş
// ekranda tablo — ResponsiveTable karar verir) ve Önerilen görev şablonları (gerçek görev değil). Şablon satırı Türkçe
// adı ve sürümü gösterir; ham makine anahtarı yalnız açılan ayrıntıda, "Teknik anahtar" etiketiyle durur.

const KONTROLLER = 'Kontroller';
const SABLONLAR = 'Önerilen görev şablonları';
const KAYNAKTA_KONTROL_YOK = 'Kaynakta kontrol kaydı yok';
const KAYNAKTA_SABLON_YOK = 'Kaynakta görev şablonu yok';

export function Bolum({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-projeler-bolum" aria-labelledby={id}>
      <div className="aile-projeler-bolum__bas">
        <h2 id={id} className="aile-projeler-bolum__baslik">{title}</h2>
        {lead ? <div className="aile-projeler-bolum__lead aile-ikincil">{lead}</div> : null}
      </div>
      {children}
    </section>
  );
}

interface DurumProps { loading: boolean; error: string | null; onRetry(): void; narrow: boolean }

export function KontrollerBolumu({ satirlar, loading, error, onRetry, narrow }: DurumProps & { satirlar: readonly KontrolSatiri[] }) {
  const sayim = useMemo(() => {
    const out: Record<KontrolSonucu, number> = { gecti: 0, kaldi: 0, eksik: 0, bilinmiyor: 0 };
    for (const row of satirlar) out[row.sonuc] += 1;
    return out;
  }, [satirlar]);

  let icerik: ReactNode;
  if (loading) icerik = <LoadingShell rows={3} narrow={narrow} label="Kontroller yükleniyor" />;
  else if (error) icerik = <ErrorState title="Kontroller okunamadı" message={error} onRetry={onRetry} />;
  else if (satirlar.length === 0) icerik = <p className="aile-projeler-not">{KAYNAKTA_KONTROL_YOK}</p>;
  else {
    icerik = (
      <>
        <ul className="aile-projeler-sayimlar" aria-label="Kontrol sonuçları">
          {(['gecti', 'kaldi', 'eksik'] as const).map(key => (
            <li key={key} className="aile-projeler-sayim">
              <span className="aile-projeler-sayim__etiket aile-kucuk aile-ikincil">{SONUC[key].label}</span>
              <span className="aile-projeler-sayim__deger">{sayi.format(sayim[key])}</span>
            </li>
          ))}
          {sayim.bilinmiyor > 0 ? (
            <li className="aile-projeler-sayim">
              <span className="aile-projeler-sayim__etiket aile-kucuk aile-ikincil">{BILINMIYOR}</span>
              <span className="aile-projeler-sayim__deger">{sayi.format(sayim.bilinmiyor)}</span>
            </li>
          ) : null}
        </ul>
        <ResponsiveTable<KontrolSatiri>
          columns={KONTROL_SUTUNLARI}
          rows={satirlar}
          caption={KONTROLLER}
          mobileCaption={`${sayi.format(satirlar.length)} kontrol`}
          groupBy={kontrolGrubu}
        />
      </>
    );
  }
  return (
    <Bolum title={KONTROLLER} lead="Kontrol yapıldı ile kontrol geçti ayrı alanlardır; eksik sonuç tamamlandı sayılmaz.">
      {icerik}
    </Bolum>
  );
}

function sablonOgesi(sablon: SablonGorunumu): AccordionItem {
  return {
    key: sablon.id,
    title: sablon.baslik,
    meta: `${sablon.surum} · ${sablon.kosul}`,
    body: [
      ['Önce yapılacak', sablon.once.length ? <ul className="aile-projeler-madde">{sablon.once.map((ad, index) => <li key={index}>{ad}</li>)}</ul> : 'Önce yapılacak şablon yok'],
      ['Kabul ölçütleri', sablon.kabul.length ? <ul className="aile-projeler-madde">{sablon.kabul.map((madde, index) => <li key={index}>{madde}</li>)}</ul> : 'Kabul ölçütü yazılmamış'],
      ['Teknik anahtar', <code className="aile-projeler-anahtar">{sablon.anahtar}</code>],
    ],
  };
}

export function SablonlarBolumu({ sablonlar, loading, error, onRetry, narrow }: DurumProps & { sablonlar: readonly SablonGorunumu[] }) {
  const ogeler = useMemo(() => sablonlar.map(sablonOgesi), [sablonlar]);
  let icerik: ReactNode;
  if (loading) icerik = <LoadingShell rows={3} narrow={narrow} label="Şablonlar yükleniyor" />;
  else if (error) icerik = <ErrorState title="Şablonlar okunamadı" message={error} onRetry={onRetry} />;
  else if (sablonlar.length === 0) icerik = <p className="aile-projeler-not">{KAYNAKTA_SABLON_YOK}</p>;
  // Şablonlar kapalı başlar: satır Türkçe ad + sürüm + koşul; ayrıntı (bağımlılık, kabul, teknik anahtar) dokununca.
  else icerik = <AccordionList items={ogeler} caption={`${sayi.format(sablonlar.length)} şablon`} firstOpen={false} />;
  return (
    <Bolum
      title={SABLONLAR}
      lead="Bunlar gerçek görev değil: iş akışının önerdiği şablonlardır (taslak). Görev yalnız kaynakta kayıt olarak eklenince görev listesine girer."
    >
      {icerik}
    </Bolum>
  );
}
