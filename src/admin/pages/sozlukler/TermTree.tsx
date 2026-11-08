import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Term } from '../../data';
import { Icon } from '../../ui/icons';
import { Tag } from '../../ui/Tag';
import { BILINMIYOR, kindBreakdown, usageText, type TermNode, type TermUsage } from './model';
import './TermTree.css';

// Telefon (temel) sunumu: sözlük terimleri iç içe açılır liste (APG Disclosure; tablo yerine akordeon, ilk kök açık).
// Yerel HTML + ARIA; antd yok. Her düğüm başlığı tam genişlik bir <button> (44 px, coarse girişte 48 px):
// aria-expanded + aria-controls; ad Türkçe etiket, altında kullanım ve alt sayısı. Panel: e-tablo kodu (alias), üst
// terim, kullanan kayıt (türlere göre), eylem ve alt terimler (aynı yapı, bir düzey içeride). Kapalı panel hidden + inert
// ve içeriği çizilmez (aria-controls hedefi kalır): 36 terimlik ağaçta DOM ve ilk çizim telefonda küçük kalır.
// Klavye (APG tree gezinmesiyle aynı tuşlar): Aşağı/Yukarı görünür başlıklar arasında, Home/End ilk/son, Sağ kapalıysa
// açar açıksa ilk alta iner, Sol açıksa kapatır kapalıysa üste çıkar; Enter/Space düğmenin kendisi. Odak çizgisi
// admin.css [data-focus-line] (tek alt çizgi, yalnız klavye modunda); çizgi başlığın altındaki boşluğa düşer.

export interface TermNoun {
  /** Başlıktaki sayım: "4 alt kategori". */
  child: string;
  /** Paneldeki etiket: "Üst kategori". */
  parent: string;
  /** Alt yoksa paneldeki etiket: "Alt kategori". */
  children: string;
}

export const CATEGORY_NOUN: TermNoun = { child: 'alt kategori', parent: 'Üst kategori', children: 'Alt kategori' };
export const TERM_NOUN: TermNoun = { child: 'alt terim', parent: 'Üst terim', children: 'Alt terim' };

export interface TermTreeProps {
  /** Sözlüğün Türkçe adı; liste "<ad> ağacı" adını alır. */
  label: string;
  nodes: readonly TermNode[];
  /** Alt dallar dahil kullanım; null = sayılamadı ("Bilinmiyor"). */
  usage: ReadonlyMap<string, TermUsage | null>;
  noun: TermNoun;
  renderAction(term: Term): ReactNode;
}

const HEAD = 'button[data-sz-dugum]';
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft']);
export const panelIdOf = (term: Term) => `aile-sz-dugum-${term.id}`;

export function TermTree({ label, nodes, usage, noun, renderAction }: TermTreeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(nodes[0] ? [nodes[0].term.id] : []));
  const toggle = (id: string, next?: boolean) =>
    setOpen((previous) => {
      const isOpen = previous.has(id);
      const want = next ?? !isOpen;
      if (want === isOpen) return previous;
      const copy = new Set(previous);
      if (want) copy.add(id);
      else copy.delete(id);
      return copy;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (!target.matches(HEAD)) return;
    const heads = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(HEAD) ?? []).filter((head) => !head.closest('[hidden]'));
    const index = heads.indexOf(target as HTMLButtonElement);
    if (index < 0) return;
    const id = target.dataset.szDugum!;
    const expanded = target.getAttribute('aria-expanded') === 'true';
    let focus: HTMLButtonElement | null | undefined;
    switch (event.key) {
      case 'ArrowDown': focus = heads[index + 1]; break;
      case 'ArrowUp': focus = heads[index - 1]; break;
      case 'Home': focus = heads[0]; break;
      case 'End': focus = heads[heads.length - 1]; break;
      case 'ArrowRight':
        if (!expanded) toggle(id, true);
        else if (heads[index + 1]?.dataset.szUst === id) focus = heads[index + 1];
        break;
      case 'ArrowLeft': {
        if (expanded) {
          toggle(id, false);
          break;
        }
        const parentId = target.dataset.szUst;
        focus = parentId ? heads.find((head) => head.dataset.szDugum === parentId) : undefined;
        break;
      }
      default: break;
    }
    event.preventDefault();
    focus?.focus();
  };

  const renderNode = (node: TermNode): ReactNode => {
    const { term, children, parent } = node;
    const isOpen = open.has(term.id);
    const panelId = panelIdOf(term);
    const termUsage = usage.has(term.id) ? usage.get(term.id)! : null;
    const meta = `${usageText(termUsage?.total ?? null)}${children.length ? ` · ${children.length} ${noun.child}` : ''}`;
    const usageDetail = termUsage === null
      ? BILINMIYOR
      : termUsage.total === 0
        ? 'Yok'
        : `${termUsage.total} (${kindBreakdown(termUsage.kinds)})`;
    return (
      <li key={term.id} className="aile-sz-dugum" data-open={isOpen ? 'true' : 'false'}>
        <div className="aile-sz-dugum-ust">
          <button
            type="button"
            className="aile-sz-dugum-bas"
            aria-expanded={isOpen}
            aria-controls={panelId}
            data-focus-line=""
            data-sz-dugum={term.id}
            data-sz-ust={parent?.id}
            onClick={() => toggle(term.id)}
          >
            <span className="aile-sz-dugum-ana">
              <span className="aile-sz-dugum-ad">{term.label}</span>{' '}
              <span className="aile-sz-dugum-meta aile-kucuk">{meta}</span>
            </span>
            {term.legacy ? <>{' '}<Tag>Eski</Tag></> : null}
            <span className="aile-sz-dugum-ok" aria-hidden="true"><Icon name="chevronDown" /></span>
          </button>
        </div>
        <div id={panelId} className="aile-sz-dugum-govde" hidden={!isOpen} inert={!isOpen}>
          {isOpen ? (
            <>
              <dl className="aile-sz-dugum-dl">
                <div>
                  <dt className="aile-kucuk">E-tablo kodu</dt>
                  <dd><code className="aile-sz-kod">{term.code}</code></dd>
                </div>
                <div>
                  <dt className="aile-kucuk">{noun.parent}</dt>
                  <dd>{parent ? parent.label : 'Yok'}</dd>
                </div>
                <div>
                  <dt className="aile-kucuk">Kullanan kayıt</dt>
                  <dd className="aile-sz-sayi">{usageDetail}</dd>
                </div>
                {children.length === 0 ? (
                  <div>
                    <dt className="aile-kucuk">{noun.children}</dt>
                    <dd>Yok</dd>
                  </div>
                ) : null}
              </dl>
              <div className="aile-sz-dugum-eylem">{renderAction(term)}</div>
              {children.length ? (
                <ul className="aile-sz-agac-liste aile-sz-agac-liste--ic" aria-label={`${term.label} altındakiler`}>
                  {children.map(renderNode)}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div ref={rootRef} className="aile-sz-agac" onKeyDown={onKeyDown}>
      <ul className="aile-sz-agac-liste" aria-label={`${label} ağacı`}>
        {nodes.map(renderNode)}
      </ul>
    </div>
  );
}
