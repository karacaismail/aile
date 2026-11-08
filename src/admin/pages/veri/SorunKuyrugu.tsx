import { useMemo, useRef, useState } from 'react';
import type { Issue } from '../../data';
import type { ResponsiveColumn } from '../../shell/contracts';
import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/Disclosure';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { Tag } from '../../ui/Tag';
import { sayi } from './bicim';
import { SAYFA_BOYUTU, aralikMetni, etkiMetni, hucreAdresi, kaynakAnahtari, sayfaDilimi, sorunDurumu, sorunGruplari, type SayfaDilimi, type SorunGrubu } from './sorunlar';
import './SorunKuyrugu.css';

// Çözülecek sorunlar kuyruğu: türe göre gruplar (Disclosure, APG disclosure) ve grup başına SAYFA_BOYUTU'luk dilim.
// Gerçek nesilde kuyruk yüzlerce kayıttır (469 formül hatası); tek tabloda ~36 bin karakter üretiyordu. Kuyruk tek
// sayfaya sığıyorsa bütün gruplar açık, sığmıyorsa yalnız ilk (en ağır/kalabalık) grup açık gelir.
// Her satırın başlığı kaynak hücre adresidir ("Gerçekleşen · G9"). Telefonda ResponsiveTable düz liste (açılma yok:
// ayrıntı satırın kendisinde), genişte tablo (Hücre · Kaynak · Etki · Durum); tablette sığmazsa yine liste.
// Sayfa değişince odak grubun başlığına taşınır: yeni dilim baştan okunur, ekran okuyucu aralığı da duyar.

const SUTUNLAR: readonly ResponsiveColumn<Issue>[] = [
  { key: 'hucre', title: 'Hücre', minWidth: 184, m: 'title', render: hucreAdresi },
  { key: 'kaynak', title: 'Kaynak', minWidth: 120, m: 'meta', render: kaynakAnahtari },
  { key: 'etki', title: 'Etki', minWidth: 288, m: 'meta', render: issue => etkiMetni(issue.detail) },
  {
    key: 'durum', title: 'Durum', minWidth: 168, m: 'status',
    render: issue => {
      const durum = sorunDurumu(issue.severity);
      return <Tag tone={durum.tone}>{durum.label}</Tag>;
    },
  },
];

function Sayfalayici({ ad, dilim, onGit }: { ad: string; dilim: SayfaDilimi; onGit(sayfa: number): void }) {
  const ilk = dilim.sayfa === 0;
  const son = dilim.sayfa >= dilim.sayfaSayisi - 1;
  return (
    <nav className="aile-veri-sayfalayici" aria-label={`${ad} sayfaları`}>
      <p className="aile-veri-aralik" aria-live="polite">{aralikMetni(dilim)}</p>
      <div className="aile-veri-sayfa-dugmeleri">
        <Button disabled={ilk} onClick={() => onGit(dilim.sayfa - 1)}>Önceki sayfa</Button>
        <Button disabled={son} onClick={() => onGit(dilim.sayfa + 1)}>Sonraki sayfa</Button>
      </div>
    </nav>
  );
}

function Grup({ grup, acik }: { grup: SorunGrubu; acik: boolean }) {
  const [sayfa, setSayfa] = useState(0);
  const kok = useRef<HTMLDivElement>(null);
  const dilim = sayfaDilimi(grup.sorunlar.length, sayfa);
  const satirlar = useMemo(() => grup.sorunlar.slice(Math.max(0, dilim.ilk - 1), dilim.son), [grup.sorunlar, dilim.ilk, dilim.son]);
  const sayfali = dilim.sayfaSayisi > 1;
  const git = (yeni: number) => {
    setSayfa(yeni);
    kok.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
  };
  return (
    <div ref={kok} className="aile-veri-grup" data-kod={grup.kod}>
      <Disclosure title={grup.ad} meta={`${sayi(grup.sorunlar.length)} kayıt`} defaultOpen={acik}>
        {/* Liste yazısı aynı zamanda listenin bölge adıdır (AccordionList): grup adı olmadan sekiz grup "1 kayıt" adlı
            sekiz bölge üretir, landmark listesinde ayırt edilemez. Grup adları tekildir (sorunGruplari türe göre). */}
        <ResponsiveTable<Issue>
          caption={grup.ad}
          mobileCaption={`${grup.ad} · ${sayfali ? aralikMetni(dilim) : sayi(grup.sorunlar.length)} kayıt`}
          columns={SUTUNLAR}
          rows={satirlar}
          mobileMode="list"
        />
        {sayfali ? <Sayfalayici ad={grup.ad} dilim={dilim} onGit={git} /> : null}
      </Disclosure>
    </div>
  );
}

export function SorunKuyrugu({ sorunlar }: { sorunlar: readonly Issue[] }) {
  const gruplar = useMemo(() => sorunGruplari(sorunlar), [sorunlar]);
  const hepsiAcik = sorunlar.length <= SAYFA_BOYUTU;
  return (
    <div className="aile-veri-gruplar">
      {gruplar.map((grup, index) => <Grup key={grup.kod} grup={grup} acik={hepsiAcik || index === 0} />)}
    </div>
  );
}
