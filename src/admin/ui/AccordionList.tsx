import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AccordionItem } from '../shell/contracts';
import { Button } from './Button';
import { Icon } from './icons';
import './AccordionList.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/AccordionList/README.md + index.d.ts AccordionListProps; referans
// davranış bundle.js AccordionList. Bir yüzey içinde açılır satırlar; telefonda tablonun yerine geçer (ResponsiveTable
// kurar). Satırın tamamı düğmedir (44+ px hedef): aria-expanded + aria-controls; sağdaki 32 px çerçeveli ok kutusu
// açılabilirliği ilk bakışta gösteren süsleyicidir (aria-hidden). Birden çok satır açık kalabilir; ilk gövdeli satır
// açık gelir (firstOpen), defaultOpenKeys bunu geçersiz kılar. Üst satır: caption ya da "N kayıt" + "ayrıntı için
// satıra dokunun" + "Tümünü aç / kapat" (caption verildiğinde ya da 3'ten çok kayıtta). Gruplar ilk görülme sırasıyla
// birer bölgedir (section + h3 + sayım). body yoksa satır düzdür: onOpen varsa düğme ayrıntıya gider.
// antd Collapse kullanılmaz (envanter eşlemesi bilgi amaçlı): Collapse başlığı tek düğme değildir, panel region
// ve ikon konumu tasarımla örtüşmez. Görsel kurallar AccordionList.css (yalnız --aile tokenları); kapalı gövde
// hidden + inert; kapanırken odak gövdedeyse satır başlığına döner (Disclosure ile aynı). Klavye: Enter/Space satır,
// Yukarı/Aşağı/Home/End satır başlıkları arasında (APG accordion, isteğe bağlı tuşlar).
export interface AccordionListProps {
  items: readonly AccordionItem[];
  /** Üst satır metni ("12 alım"); grupsuz listede bölge adı. Verilmezse 3'ten çok kayıtta "N kayıt" yazılır. */
  caption?: string;
  /** İlk gövdeli satır açık başlar (varsayılan true); defaultOpenKeys verilince yoksayılır. */
  firstOpen?: boolean;
  defaultOpenKeys?: readonly string[];
  /** Gövdedeki ayrıntı düğmesinin etiketi; varsayılan "Ayrıntıyı aç". */
  openLabel?: string;
  className?: string;
}

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

export function AccordionList({ items, caption, firstOpen = true, defaultOpenKeys, openLabel = AYRINTIYI_AC, className }: AccordionListProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const rows: Row[] = items.map((item, index) => ({ item, index, expandable: hasBody(item) }));
  const expandable = rows.filter(row => row.expandable);
  const [open, setOpen] = useState<readonly string[]>(() => {
    if (defaultOpenKeys) return defaultOpenKeys;
    const first = expandable[0];
    return firstOpen && first ? [first.item.key] : [];
  });
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

  const renderHead = ({ item, expandable: canExpand }: Row) => (
    <>
      <span className="aile-acc-main">
        <span className="aile-acc-title"><span className="aile-acc-ul">{item.title}</span></span>
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
                {item.onOpen ? <Button variant="secondary" onClick={item.onOpen}>{openLabel}</Button> : null}
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
            <h3 className="aile-acc-gtitle">
              {group.name}
              <span className="aile-acc-gcount aile-kucuk">{group.rows.length}</span>
            </h3>
          ) : null}
          <ul className="aile-acc-list">{group.rows.map(renderRow)}</ul>
        </section>
      ))}
    </div>
  );
}
