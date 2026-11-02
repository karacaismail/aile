import type { CSSProperties, KeyboardEvent } from 'react';
import { eksikTarih, type GanttPlan } from '../model';
import './Gantt.css';

// Gantt (yalnız geniş: tablet ve masaüstü; telefon bu modülü indirmez — wide/ klasörü tek `wide` parçasına gider).
// Tasarım: bundle.js › Pages.Projeler Gantt (haftalık ızgara: ad sütunu solda yapışkan 280 px / dar 148 px, hafta
// 64 / 56 px, "Bu hafta" sütunu bilgi yüzeyi; proje satırı kalın, altında görevleri). Tarih sürüklemeyle değişmez;
// yatay kaydırma yalnız çizelgenin içinde (sayfa kaymaz). Çubuk sözcükle de adlandırılır (role="img" + aria-label).

const GANTT_ETIKET = 'Gantt çizelgesi, yana kaydırılabilir';
const BU_HAFTA = 'Bu hafta';
const GECIKTI = 'Gecikti';
const TARIHSIZ = 'Tarihsiz';

export interface GanttProps { plan: GanttPlan; narrow: boolean }

/** Ölçülemezse (ör. yerleşimsiz ortam) bir adım: geniş hafta sütunu (Gantt.css --aile-projeler-gantt-hafta). */
const HAFTA_ADIMI = 64;

/**
 * Klavyeyle yana kaydırma: ←/→ bir hafta sütunu, Home/End baş/son. WebKit odaklı kaydırma kabını oklarla kendiliğinden
 * kaydırmaz; davranış her motorda aynı olsun diye bu tuşlar burada işlenir ve tarayıcının kendi kaydırması tüketilir
 * (iki kez kaymaz). ↑/↓ ve değiştiricili tuşlar sayfaya kalır. Kaydırma anlıktır (hareket yok).
 */
function yanaKaydir(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const kap = event.currentTarget;
  const adim = kap.querySelector('.aile-projeler-gantt__hafta')?.getBoundingClientRect().width || HAFTA_ADIMI;
  switch (event.key) {
    case 'ArrowRight': kap.scrollLeft += adim; break;
    case 'ArrowLeft': kap.scrollLeft = Math.max(0, kap.scrollLeft - adim); break;
    case 'Home': kap.scrollLeft = 0; break;
    case 'End': kap.scrollLeft = kap.scrollWidth - kap.clientWidth; break;
    default: return;
  }
  event.preventDefault();
}

export function Gantt({ plan, narrow }: GanttProps) {
  const { weeks, dated } = plan;
  // Proje satırları yalnız başlıktır; tarihsiz listede görevler adıyla durur (proje tekrar edilmez).
  const undated = plan.undated.filter(row => !row.group);
  const style = { '--aile-projeler-hafta-sayisi': weeks.length } as CSSProperties;
  const dar = narrow ? 'true' : 'false';
  return (
    <div className="aile-projeler-gantt-alan" data-narrow={dar}>
      {/* Kaydırma kapsayıcısı odaklanır (klavyeyle yana kaydırma). Tek alt çizgiyi kaydırmayan sarmalayıcı çizer
          (admin.css [data-focus-line]:has(:focus-visible), yalnız klavye modunda); kabın içinde kırpılmaz. */}
      <div className="aile-projeler-gantt-kap" data-focus-line="">
        <div className="aile-projeler-gantt" role="region" aria-label={GANTT_ETIKET} tabIndex={0} data-narrow={dar} onKeyDown={yanaKaydir}>
          {dated.length === 0 ? (
            <p className="aile-projeler-not">Çizelgede gösterilecek başlangıç ve bitiş tarihli görev yok.</p>
          ) : (
            <table className="aile-projeler-gantt__tablo" style={style}>
              <caption className="aile-projeler-gizli">Gantt çizelgesi</caption>
              <thead>
                <tr>
                  <th scope="col" className="aile-projeler-gantt__ad aile-projeler-gantt__baslik">Proje ve görev</th>
                  {weeks.map(week => (
                    <th key={week.label + week.start.getTime()} scope="col" className="aile-projeler-gantt__hafta" data-current={week.current ? 'true' : undefined}>
                      <span>{week.label}</span>
                      {week.current ? <span className="aile-projeler-gantt__simdi aile-kucuk">{BU_HAFTA}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dated.map(bar => (
                  <tr key={bar.id} data-kind={bar.group ? 'proje' : 'gorev'}>
                    <th scope="row" className="aile-projeler-gantt__ad" data-gantt-ad={bar.label} data-kind={bar.group ? 'proje' : 'gorev'}>
                      <span className="aile-projeler-gantt__etiket">{bar.label}</span>
                      {bar.meta ? <span className="aile-projeler-gantt__meta aile-kucuk aile-ikincil">{bar.meta}</span> : null}
                    </th>
                    <td className="aile-projeler-gantt__iz" colSpan={weeks.length}>
                      <span className="aile-projeler-gantt__izgara">
                        <span
                          role="img"
                          aria-label={`${bar.group ? 'Proje ' : ''}${bar.label}: ${bar.startText} – ${bar.endText}`}
                          className="aile-projeler-gantt__cubuk"
                          data-kind={bar.group ? 'proje' : 'gorev'}
                          data-tone={bar.tone ?? 'notr'}
                          data-late={bar.late ? 'true' : undefined}
                          style={{ gridColumn: `${bar.startWeek + 1} / ${bar.endWeek + 2}` }}
                        >
                          {/* Tasarım: proje çubuğu aralığı yazar, görev çubuğu yalnız "Gecikti"yi; tarih her çubuğun adında. */}
                          <span aria-hidden="true">{bar.late ? GECIKTI : bar.group ? `${bar.startText} – ${bar.endText}` : ''}</span>
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <section className="aile-projeler-tarihsiz" aria-label={TARIHSIZ}>
        <h3 className="aile-projeler-tarihsiz__baslik">{TARIHSIZ}</h3>
        {undated.length === 0 ? (
          <p className="aile-ikincil aile-projeler-not">Tarihsiz kayıt yok</p>
        ) : (
          <ul className="aile-projeler-tarihsiz__liste">
            {undated.map(row => (
              <li key={row.id}>
                <span className="aile-projeler-tarihsiz__ad">{row.label}</span>
                <span className="aile-kucuk aile-ikincil">{[row.meta, eksikTarih(row)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="aile-projeler-not aile-ikincil">
        {narrow
          ? 'Çizelge yana kayar; proje ve görev adları solda sabit kalır.'
          : 'Tarihi değiştirmek sürüklemeye bağlı değildir; kaydın tarih alanlarıyla yapılır.'}
      </p>
    </div>
  );
}
