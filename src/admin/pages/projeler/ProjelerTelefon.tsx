import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { Select } from '../../ui/Select';
import {
  FIYAT_YOK, GOREV_KUMELERI, HENUZ_YOK, aralikMetni, projeOzeti, sayi, toplamMetni,
  type GorevKumesi, type GorevSatiri, type Proje, type Toplam,
} from './model';
import { GOREV_SUTUNLARI, gorevGrubu } from './sutunlar';

// Telefon (temel) sunumu: proje listesi → proje ayrıntısı → görevler. Yerel HTML + APG kalıpları (liste içinde düğme
// satırları, ayrıntıda tek h2 ve "Listeye dön"), renk/ölçü yalnız ProjelerPage.css'te --aile tokenlarıyla. Geniş
// profilde ProjelerGenis.wide yüklenirken ve yüklenemezse de bu sunum kullanılır (Adaptive). Kanban/Gantt/tablo,
// sorgu çubuğu ve filtre paneli burada yok; telefon onları indirmez.
//
// Odak: projeye dokununca ayrıntı başlığı (h2, tabIndex -1) odak alır; "Listeye dön" listeyi geri getirip odağı açılan
// projenin satırına döndürür. Ayrıntı "tam sayfa"dır: liste o sırada çizilmez (sayfa diğer bölümleri de gizler).

const PROJELER = 'Projeler';
const PROJE_NOTU = 'Kaynakta ayrı proje kaydı yok; görevler proje aşamasına göre toplanır.';
const LISTEYE_DON = 'Listeye dön';
const PROJE_ASAMASI = 'Proje aşaması';
const GOSTER = 'Göster';

export interface ProjelerTelefonProps {
  projeler: readonly Proje[];
  /** Seçili proje (ayrıntı açık); null → liste. */
  seciliId: string | null;
  onSec(id: string): void;
  onGeri(): void;
}

/** Toplam tutar: biçimli metin (tabular-nums) ya da eksiklik adı; plan ve gerçek ayrı çağrılır. */
function Tutar({ toplam, yok }: { toplam: Toplam; yok: string }) {
  const eksik = toplam.parts.length === 0;
  return (
    <span className="aile-projeler-tutar" data-eksik={eksik ? 'true' : undefined}>
      {toplamMetni(toplam, yok)}
    </span>
  );
}

export function ProjelerTelefon({ projeler, seciliId, onSec, onGeri }: ProjelerTelefonProps) {
  const baslikId = useId();
  const dugmeler = useRef(new Map<string, HTMLButtonElement>());
  const donus = useRef<string | null>(null);
  const secili = seciliId === null ? undefined : projeler.find(proje => proje.id === seciliId);

  // Ayrıntıdan dönünce odak açılan projenin satırına (liste yeniden çizildikten sonra, boyamadan önce).
  useLayoutEffect(() => {
    if (secili || donus.current === null) return;
    dugmeler.current.get(donus.current)?.focus();
    donus.current = null;
  }, [secili]);

  if (secili) {
    return (
      <ProjeAyrintisi
        key={secili.id}
        proje={secili}
        onGeri={() => {
          donus.current = secili.id;
          onGeri();
        }}
      />
    );
  }

  const gorevSayisi = projeler.reduce((toplam, proje) => toplam + proje.gorevler.length, 0);
  return (
    <section className="aile-projeler-bolum aile-projeler-projeler" aria-labelledby={baslikId}>
      <div className="aile-projeler-bolum__bas">
        <h2 id={baslikId} className="aile-projeler-bolum__baslik">{PROJELER}</h2>
        <p className="aile-projeler-bolum__lead aile-ikincil">{PROJE_NOTU}</p>
      </div>
      <p className="aile-projeler-sayim-satiri aile-kucuk aile-ikincil">
        {`${sayi.format(projeler.length)} proje · ${sayi.format(gorevSayisi)} görev`}
      </p>
      <ul className="aile-projeler-liste">
        {projeler.map(proje => (
          <ProjeSatiri
            key={proje.id}
            proje={proje}
            ref={element => {
              if (element) dugmeler.current.set(proje.id, element);
              else dugmeler.current.delete(proje.id);
            }}
            onSec={() => onSec(proje.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function ProjeSatiri({ proje, onSec, ref }: { proje: Proje; onSec(): void; ref: (element: HTMLButtonElement | null) => void }) {
  const id = useId();
  const adId = `${id}-ad`;
  const ozetId = `${id}-ozet`;
  const aralikId = `${id}-aralik`;
  const tutarId = `${id}-tutar`;
  return (
    <li className="aile-projeler-liste__oge">
      <button
        ref={ref}
        type="button"
        className="aile-projeler-proje"
        aria-labelledby={adId}
        aria-describedby={`${ozetId} ${aralikId} ${tutarId}`}
        data-proje-ad={proje.ad}
        onClick={onSec}
      >
        <span className="aile-projeler-proje__ana">
          <span id={adId} className="aile-projeler-proje__ad">{proje.ad}</span>
          <span id={ozetId} className="aile-projeler-proje__meta aile-kucuk aile-ikincil">{projeOzeti(proje)}</span>
          <span id={aralikId} className="aile-projeler-proje__meta aile-projeler-tarih aile-kucuk aile-ikincil">{aralikMetni(proje.baslangic, proje.bitis)}</span>
          <span id={tutarId} className="aile-projeler-proje__tutarlar">
            <span className="aile-projeler-olcu">
              <span className="aile-projeler-olcu__etiket aile-kucuk aile-ikincil">Planlanan</span>
              <Tutar toplam={proje.planlanan} yok={FIYAT_YOK} />
            </span>
            <span className="aile-projeler-olcu">
              <span className="aile-projeler-olcu__etiket aile-kucuk aile-ikincil">Gerçekleşen</span>
              <Tutar toplam={proje.gerceklesen} yok={HENUZ_YOK} />
            </span>
          </span>
        </span>
        <Icon name="chevronRight" className="aile-projeler-proje__ok" />
      </button>
    </li>
  );
}

function eksikNotu(toplam: Toplam, sozcuk: string): string | null {
  return toplam.eksik > 0 && toplam.parts.length > 0 ? `${sayi.format(toplam.eksik)} ${sozcuk}` : null;
}

function ProjeAyrintisi({ proje, onGeri }: { proje: Proje; onGeri(): void }) {
  const baslikId = useId();
  const baslik = useRef<HTMLHeadingElement>(null);
  const [kume, setKume] = useState<GorevKumesi>('tum');

  // Tam sayfa ayrıntı açılınca odak başlığa (ekran okuyucu yeri duyar, kaydırma başa gelir).
  useEffect(() => {
    baslik.current?.focus();
  }, []);

  const secenekler = useMemo(
    () => GOREV_KUMELERI.map(item => {
      const adet = proje.gorevler.filter(item.test).length;
      return { value: item.key, label: `${item.label} (${sayi.format(adet)})`, disabled: adet === 0 && item.key !== 'tum', note: adet === 0 ? 'Bu durumda görev yok' : undefined };
    }),
    [proje.gorevler],
  );
  const satirlar = useMemo<GorevSatiri[]>(() => {
    const test = GOREV_KUMELERI.find(item => item.key === kume)?.test ?? (() => true);
    return proje.gorevler.filter(test);
  }, [proje.gorevler, kume]);

  const planNotu = eksikNotu(proje.planlanan, 'fiyatsız');
  const gercekNotu = eksikNotu(proje.gerceklesen, 'henüz yok');

  return (
    <section className="aile-projeler-ayrinti" aria-labelledby={baslikId}>
      <div className="aile-projeler-ayrinti__geri">
        <Button variant="quiet" icon="back" onClick={onGeri}>{LISTEYE_DON}</Button>
      </div>
      <div className="aile-projeler-ayrinti__kimlik">
        <p className="aile-projeler-ayrinti__ust aile-kucuk aile-ikincil">{PROJE_ASAMASI}</p>
        <h2 id={baslikId} ref={baslik} tabIndex={-1} data-focus-line="" className="aile-projeler-ayrinti__baslik">{proje.ad}</h2>
        <p className="aile-projeler-ayrinti__meta aile-kucuk aile-ikincil">
          <span>{projeOzeti(proje)}</span>
          <span aria-hidden="true">{' · '}</span>
          <span className="aile-projeler-tarih">{aralikMetni(proje.baslangic, proje.bitis)}</span>
        </p>
      </div>
      <dl className="aile-projeler-tutarlar">
        <div className="aile-projeler-tutarlar__sutun">
          <dt className="aile-kucuk aile-ikincil">Planlanan</dt>
          <dd>
            <Tutar toplam={proje.planlanan} yok={FIYAT_YOK} />
            {planNotu ? <span className="aile-projeler-tutarlar__not aile-kucuk aile-ikincil">{planNotu}</span> : null}
          </dd>
        </div>
        <div className="aile-projeler-tutarlar__sutun">
          <dt className="aile-kucuk aile-ikincil">Gerçekleşen</dt>
          <dd>
            <Tutar toplam={proje.gerceklesen} yok={HENUZ_YOK} />
            {gercekNotu ? <span className="aile-projeler-tutarlar__not aile-kucuk aile-ikincil">{gercekNotu}</span> : null}
          </dd>
        </div>
      </dl>
      <div className="aile-projeler-ayrinti__gorevler">
        <div className="aile-projeler-ayrinti__gorev-bas">
          <h3 className="aile-projeler-ayrinti__h3">Görevler</h3>
          <Select label={GOSTER} options={secenekler} value={kume} onChange={value => setKume(value as GorevKumesi)} className="aile-projeler-goster" />
        </div>
        {satirlar.length === 0 ? (
          <p className="aile-projeler-not aile-ikincil">Bu seçimde görev yok.</p>
        ) : (
          <ResponsiveTable<GorevSatiri>
            narrow
            columns={GOREV_SUTUNLARI}
            rows={satirlar}
            caption="Görevler"
            mobileCaption={`${sayi.format(satirlar.length)} görev`}
            groupBy={gorevGrubu}
          />
        )}
      </div>
    </section>
  );
}
