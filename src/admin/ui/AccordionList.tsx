import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AccordionItem } from '../shell/contracts';
import { Button } from './Button';
import { Icon } from './icons';
import './AccordionList.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/AccordionList/README.md + index.d.ts AccordionListProps; referans
// davranış bundle.js AccordionList. Bir yüzey içinde açılır satırlar; telefonda tablonun yerine geçer (ResponsiveTable
// kurar). Satırın tamamı düğmedir (44+ px hedef): aria-expanded + aria-controls; sağdaki 32 px çerçeveli ok kutusu
// açılabilirliği ilk bakışta gösteren süsleyicidir (aria-hidden). Birden çok satır açık kalabilir; ilk gövdeli satır
// açık gelir (firstOpen), defaultOpenKeys bunu geçersiz kılar; yeni kayıt kümesinde açık satırların hiçbiri yoksa ilk
// gövdeli satır yeniden açılır. Üst satır: caption ya da "N kayıt" + "ayrıntı için satıra dokunun" + "Tümünü aç /
// kapat" (caption verildiğinde ya da 3'ten çok kayıtta). Gruplar ilk görülme sırasıyla birer bölgedir (section +
// başlık + sayım); başlık düzeyi headingLevel (varsayılan h3; sayfada h2 yoksa çağıran 2 verir, başlık sırası
// atlamasın). body yoksa satır düzdür: onOpen varsa düğme ayrıntıya gider.
// antd Collapse kullanılmaz (envanter eşlemesi bilgi amaçlı): Collapse başlığı tek düğme değildir, panel region
// ve ikon konumu tasarımla örtüşmez. Görsel kurallar AccordionList.css (yalnız --aile tokenları); kapalı gövde
// hidden + inert; kapanırken odak gövdedeyse satır başlığına döner (Disclosure ile aynı). Klavye: Enter/Space satır,
// Yukarı/Aşağı/Home/End satır başlıkları arasında (APG accordion, isteğe bağlı tuşlar). Gövdedeki ayrıntı düğmesi her
// satırda aynı görünür adı taşır; aria-describedby satır başlığındaki adı gösterir (düğme listesinde ayırt edilir).
export interface AccordionListProps {
  items: readonly AccordionItem[];
  /** Üst satır metni ("12 alım"); grupsuz listede bölge adı. Verilmezse 3'ten çok kayıtta "N kayıt" yazılır. */
  caption?: string;
  /** İlk gövdeli satır açık başlar (varsayılan true); defaultOpenKeys verilince yoksayılır. */
  firstOpen?: boolean;
  defaultOpenKeys?: readonly string[];
  /** Gövdedeki ayrıntı düğmesinin etiketi; varsayılan "Ayrıntıyı aç". */
  openLabel?: string;
  /** Grup başlıklarının düzeyi (varsayılan 3). Liste h1'in hemen altındaysa 2 verilir: başlık sırası atlamaz. */
  headingLevel?: AccordionHeadingLevel;
  className?: string;
}

export type AccordionHeadingLevel = 2 | 3 | 4 | 5 | 6;

const AYRINTIYI_AC = 'Ayrıntıyı aç';
const DOKUNUN = 'ayrıntı için satıra dokunun';
const HEAD_SELECTOR = 'button.aile-acc-head';
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

interface Row { item: AccordionItem; index: number; expandable: boolean }
interface Group { name: string; rows: Row[] }

const hasBody = (item: AccordionItem) => Array.isArray(item.body) && item.body.length > 0;
const present = (node: ReactNode) => node !== null && node !== undefined && node !== false && node !== '';

function groupRows(rows: readonly Row[]): Group[] {
  const groups: Group[] = [];
  const byName = new Map<string, Group>();
  for (const row of rows) {
    const name = row.item.group ?? '';
    let group = byName.get(name);
    if (!group) {
      group = { name, rows: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

export function AccordionList({
  items, caption, firstOpen = true, defaultOpenKeys, openLabel = AYRINTIYI_AC, headingLevel = 3, className,
}: AccordionListProps) {
  const id = useId();
  const GroupHeading = `h${headingLevel}` as const;
  const rootRef = useRef<HTMLDivElement>(null);
  const rows: Row[] = items.map((item, index) => ({ item, index, expandable: hasBody(item) }));
  const expandable = rows.filter(row => row.expandable);
  const [open, setOpen] = useState<readonly string[]>(() => {
    if (defaultOpenKeys) return defaultOpenKeys;
    const first = expandable[0];
    return firstOpen && first ? [first.item.key] : [];
  });
  // Yeni kayıt kümesi (veri gelişi, filtre, dönem): açık satırların hiçbiri kalmadıysa ya da önceki küme boşsa ilk gövdeli
  // satır açılır (firstOpen). Açık satırlardan biri duruyorsa ("daha fazla göster") ya da kullanıcı hepsini kapattıysa
  // durum korunur. Önceki render'ın anahtarlarıyla karşılaştırılır, render sırasında düzeltilir (effect'teki boş kare yok).
  const keySignature = expandable.map(row => row.item.key).join('\u0000');
  const [seenSignature, setSeenSignature] = useState(keySignature);
  if (seenSignature !== keySignature) {
    setSeenSignature(keySignature);
    const present = new Set(expandable.map(row => row.item.key));
    const vanished = open.length > 0 && !open.some(key => present.has(key));
    const arrived = seenSignature === '' && open.length === 0;
    if (vanished || arrived) {
      const first = expandable[0];
      setOpen(firstOpen && first ? [first.item.key] : []);
    }
  }
  const isOpen = (key: string) => open.includes(key);
  const allOpen = expandable.length > 0 && expandable.every(row => isOpen(row.item.key));
  const showBar = Boolean(caption) || items.length > 3;

  // Kapanan gövdede odak kaldıysa satır başlığına taşı: inert olunca odak sessizce body'ye düşmesin.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const active = document.activeElement;
    if (!root || !active) return;
    for (const panel of root.querySelectorAll<HTMLElement>('.aile-acc-panel[hidden]')) {
      if (!panel.contains(active)) continue;
      const head = panel.parentElement?.querySelector<HTMLButtonElement>(HEAD_SELECTOR);
      head?.focus();
      return;
    }
  }, [open]);

  const toggle = (key: string) => setOpen(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  const toggleAll = () => setOpen(allOpen ? [] : expandable.map(row => row.item.key));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(event.key)) return;
    const target = event.target as HTMLElement;
    if (!target.matches(HEAD_SELECTOR)) return;
    const heads = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(HEAD_SELECTOR) ?? []);
    const current = heads.indexOf(target as HTMLButtonElement);
    if (current < 0 || heads.length === 0) return;
    const last = heads.length - 1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : event.key === 'ArrowDown' ? (current === last ? 0 : current + 1)
      : current === 0 ? last : current - 1;
    event.preventDefault();
    heads[next]?.focus();
  };

  const titleId = (index: number) => `${id}-ad-${index}`;

  const renderHead = ({ item, index, expandable: canExpand }: Row) => (
    <>
      <span className="aile-acc-main">
        <span className="aile-acc-title"><span id={titleId(index)} className="aile-acc-ul">{item.title}</span></span>
        {present(item.meta) ? <span className="aile-acc-meta aile-kucuk">{item.meta}</span> : null}
        {present(item.status) ? <span className="aile-acc-status">{item.status}</span> : null}
      </span>
      <span className="aile-acc-end">{present(item.lead) ? <span className="aile-acc-lead">{item.lead}</span> : null}</span>
      {canExpand ? (
        <span className="aile-acc-tog" aria-hidden="true"><Icon name="chevronDown" className="aile-acc-chev" /></span>
      ) : item.onOpen ? (
        <Icon name="chevronRight" className="aile-acc-chev-flat" />
      ) : null}
    </>
  );

  const renderRow = (row: Row) => {
    const { item, index, expandable: canExpand } = row;
    const panelId = `${id}-govde-${index}`;
    const rowOpen = canExpand && isOpen(item.key);
    const head = renderHead(row);
    return (
      <li key={item.key} className="aile-acc-item" data-open={rowOpen ? 'true' : 'false'} data-selected={item.selected ? 'true' : 'false'}>
        {canExpand ? (
          <button type="button" className="aile-acc-head" aria-expanded={rowOpen} aria-controls={panelId} onClick={() => toggle(item.key)}>
            {head}
          </button>
        ) : item.onOpen ? (
          <button type="button" className="aile-acc-head aile-acc-head--flat" onClick={item.onOpen}>{head}</button>
        ) : (
          <div className="aile-acc-head aile-acc-head--flat">{head}</div>
        )}
        {canExpand ? (
          <div id={panelId} className="aile-acc-panel" hidden={!rowOpen} inert={!rowOpen}>
            <div className="aile-acc-inner">
              <div className="aile-acc-body">
                <dl className="aile-acc-dl">
                  {item.body!.map(([label, value], i) => (
                    <div key={i}>
                      <dt className="aile-kucuk">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {/* Her satırda aynı görünür ad ("Ayrıntıyı aç"); hangi kayda ait olduğu satır başlığındaki adla açıklanır. */}
                {item.onOpen ? <Button variant="secondary" onClick={item.onOpen} aria-describedby={titleId(index)}>{openLabel}</Button> : null}
              </div>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div ref={rootRef} className={['aile-acc', className].filter(Boolean).join(' ')} onKeyDown={onKeyDown}>
      {showBar ? (
        <div className="aile-acc-bar">
          <p className="aile-acc-bar-metin aile-kucuk aile-ikincil">
            {caption || `${items.length} kayıt`}
            {expandable.length > 0 ? ` · ${DOKUNUN}` : ''}
          </p>
          {expandable.length > 0 ? (
            <Button variant="quiet" onClick={toggleAll}>{allOpen ? 'Tümünü kapat' : 'Tümünü aç'}</Button>
          ) : null}
        </div>
      ) : null}
      {groupRows(rows).map(group => (
        <section key={group.name || '_'} className="aile-acc-group" aria-label={group.name || caption}>
          {group.name ? (
            <GroupHeading className="aile-acc-gtitle">
              {group.name}
              <span className="aile-acc-gcount aile-kucuk">{group.rows.length}</span>
            </GroupHeading>
          ) : null}
          <ul className="aile-acc-list">{group.rows.map(renderRow)}</ul>
        </section>
      ))}
    </div>
  );
}
