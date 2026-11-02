import { useId, type ReactNode } from 'react';
import type { AccordionItem } from '../../shell/contracts';
import { AccordionList } from '../../ui/AccordionList';
import { Icon } from '../../ui/icons';
import { formatMoney } from '../../ui/Money';
import {
  donemAdi,
  gerceklesenMetni,
  gorevMetaMetni,
  gunAdi,
  planMetni,
  sayiMetni,
  tarihMetni,
  toplamMetni,
  type GenelAy,
  type GenelBaglanti,
  type GenelButceSatiri,
  type GenelDikkat,
  type GenelGorev,
  type GenelOdeme,
  type GenelSunumProps,
} from './model';

// Genel durum › telefon temel sunumu (W0: yerel HTML + ARIA APG + --aile-* tokenları; antd, ECharts ve *.wide yok).
// Sıra telefon yolculuğuna göre: özet ölçüler başlıkta (PageHeader) → Yaklaşan ödemeler (7 gün) → Dikkat isteyenler →
// Bütçe (akordeon, ilk satır açık; plan aynası notu) → Bekleyen işler (yerel onay kutusu) → Aylık plan ve gerçek
// (grafik yerine tablo karşılığı: ay başına akordeon). Her blok bir bölgedir (section + h2) ve başlık satırında ilgili
// sayfaya bağlantı taşır. Liste satırları kart değil: tek yüzey, satırlar çizgiyle ayrılır. Eksik bilgi adıyla.
// Gerçekleşen metni ve durum yalnız model (data/actuals.ts spendLabel) üzerinden; yüzde/"harcandı" burada üretilmez.

const TARIH_YOK = 'Tarih yok';
const TUTAR_YOK = 'Tutar yok';
const TARAF_BILINMIYOR = 'Taraf bilinmiyor';
const ETIKET = { plan: 'Planlanan', gercek: 'Gerçekleşen', kalan: 'Kalan' } as const;

function Blok({ title, link, children }: { title: string; link: GenelBaglanti; children: ReactNode }) {
  const id = useId();
  return (
    <section className="aile-genel-blok" aria-labelledby={id}>
      <div className="aile-genel-bas">
        <h2 id={id} className="aile-genel-baslik">{title}</h2>
        <a className="aile-genel-bag" href={link.href}>{link.label}</a>
      </div>
      {children}
    </section>
  );
}

const Bos = ({ text }: { text: string }) => <p className="aile-genel-bos aile-ikincil">{text}</p>;
const Tutar = ({ children }: { children: ReactNode }) => <span className="aile-tutar">{children}</span>;

function OdemeSatiri({ odeme }: { odeme: GenelOdeme }) {
  const tarih = tarihMetni(odeme.date);
  const gun = gunAdi(odeme.date);
  return (
    <li className="aile-genel-satir aile-genel-satir--odeme">
      <span className="aile-genel-tarih">
        {tarih ? <strong>{tarih}</strong> : <span className="aile-ikincil">{TARIH_YOK}</span>}
        {gun ? <span className="aile-kucuk aile-ikincil">{gun}</span> : null}
      </span>
      <span className="aile-genel-satir-ana">
        <span className="aile-genel-ad">{odeme.label}</span>
        <span className="aile-kucuk aile-ikincil">{odeme.party?.trim() || TARAF_BILINMIYOR}</span>
      </span>
      <span className="aile-genel-son">
        {odeme.amount ? <Tutar>{formatMoney(odeme.amount)}</Tutar> : <span className="aile-ikincil">{TUTAR_YOK}</span>}
        <span className="aile-genel-durum aile-kucuk" data-tone={odeme.status.tone}>{odeme.status.label.trim() || 'Bilinmiyor'}</span>
      </span>
    </li>
  );
}

function DikkatSatiri({ item }: { item: GenelDikkat }) {
  return (
    <li>
      <a className="aile-genel-satir aile-genel-satir--sayi" href={item.href}>
        <span className="aile-genel-sayi">{sayiMetni(item.count)}</span>
        <span className="aile-genel-satir-ana">
          <span className="aile-genel-ad">{item.label}</span>
          <span className="aile-kucuk aile-ikincil">{item.page}</span>
        </span>
        <Icon name="chevronRight" className="aile-genel-ok" />
      </a>
    </li>
  );
}

function GorevSatiri({ gorev, onToggle }: { gorev: GenelGorev; onToggle?: GenelSunumProps['onToggleTask'] }) {
  const meta = gorevMetaMetni(gorev);
  return (
    <li>
      <label className={gorev.done ? 'aile-genel-gorev aile-genel-gorev--bitti' : 'aile-genel-gorev'} data-focus-line="">
        <input
          type="checkbox"
          className="aile-genel-gorev-girdi"
          checked={gorev.done}
          disabled={!onToggle}
          onChange={event => onToggle?.(gorev.id, event.target.checked)}
        />
        <span className="aile-genel-kutu" aria-hidden="true">
          <Icon name="check" className="aile-genel-kutu-isaret" />
        </span>
        <span className="aile-genel-satir-ana">
          <span className="aile-genel-gorev-ad">{gorev.label}</span>
          {meta ? <span className="aile-kucuk aile-ikincil">{meta}</span> : null}
        </span>
      </label>
    </li>
  );
}

/** Akordeon başlığındaki durum sözcüğü ("Kaynakta yazılı", "Henüz yok", "%N harcandı"). */
const Durum = ({ text }: { text: string }) => <span className="aile-genel-durum aile-kucuk">{text}</span>;

function butceOgesi(satir: GenelButceSatiri): AccordionItem {
  const govde: [ReactNode, ReactNode][] = [
    [ETIKET.plan, <Tutar key="p">{planMetni(satir.planned)}</Tutar>],
    [ETIKET.gercek, <Tutar key="g">{gerceklesenMetni(satir.recorded)}</Tutar>],
  ];
  if (satir.remaining) govde.push([ETIKET.kalan, <Tutar key="k">{toplamMetni(satir.remaining)}</Tutar>]);
  return { key: satir.id, title: satir.label, status: <Durum text={satir.spend.text} />, body: govde };
}

function ayOgesi(ay: GenelAy): AccordionItem {
  return {
    key: ay.donem,
    title: donemAdi(ay.donem, 'kisa'),
    status: <Durum text={ay.spend.text} />,
    body: [
      [ETIKET.plan, <Tutar key="p">{planMetni(ay.planned)}</Tutar>],
      [ETIKET.gercek, <Tutar key="g">{gerceklesenMetni(ay.recorded)}</Tutar>],
    ],
  };
}

export function GenelTelefon({ gorunum, onToggleTask }: GenelSunumProps) {
  const { odemeler, dikkat, butce, gorevler, aylik } = gorunum;
  return (
    <div className="aile-genel-telefon" data-testid="genel-telefon">
      <Blok title={odemeler.title} link={odemeler.link}>
        {odemeler.items.length ? (
          <ul className="aile-genel-liste">{odemeler.items.map(odeme => <OdemeSatiri key={odeme.id} odeme={odeme} />)}</ul>
        ) : <Bos text={odemeler.empty} />}
      </Blok>
      <Blok title={dikkat.title} link={dikkat.link}>
        {dikkat.items.length ? (
          <ul className="aile-genel-liste">{dikkat.items.map(item => <DikkatSatiri key={item.id} item={item} />)}</ul>
        ) : <Bos text={dikkat.empty} />}
      </Blok>
      <Blok title={butce.title} link={butce.link}>
        {butce.note ? <p className="aile-genel-not aile-kucuk" role="note">{butce.note}</p> : null}
        {butce.items.length ? (
          <AccordionList items={butce.items.map(butceOgesi)} caption={`${sayiMetni(butce.items.length)} kalem`} />
        ) : <Bos text={butce.empty} />}
      </Blok>
      <Blok title={gorevler.title} link={gorevler.link}>
        {gorevler.items.length ? (
          <ul className="aile-genel-liste">{gorevler.items.map(gorev => <GorevSatiri key={gorev.id} gorev={gorev} onToggle={onToggleTask} />)}</ul>
        ) : <Bos text={gorevler.empty} />}
      </Blok>
      <Blok title={aylik.title} link={aylik.link}>
        {aylik.items.length ? (
          <AccordionList items={aylik.items.map(ayOgesi)} caption={`${sayiMetni(aylik.items.length)} ay · Planlanan ve Gerçekleşen`} />
        ) : <Bos text={aylik.empty} />}
      </Blok>
    </div>
  );
}
