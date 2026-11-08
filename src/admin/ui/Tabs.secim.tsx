import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';
import { Icon } from './icons';
import { ilkEtkin, komsuEtkin, sonEtkin, type TabItem } from './Tabs.gezinme';

// Telefon + 5 ve üstü öğe (envanter.md › Tabs (5+ sekme) → Select; README: telefonda seçim listesi alttan açılır).
// APG Select-Only Combobox, açılır katmanı modal dialog: tetik role=combobox (ad = label, açıklama = not),
// aria-haspopup="dialog", aria-expanded, açıkken aria-controls → sayfa. Sayfa ortak alt sayfa bileşenidir (ui/BottomSheet,
// Select, Menu ve Dialog ile aynı kipli katman): role=dialog aria-modal, başlık h2 (= ad), görünür "Kapat", arka plan
// inert, sayfa kaydırması kilitli, Tab tuzağı (sınırda sarar), belge düzeyinde Escape, odak kaybında (başlığa ya da boş
// alana dokunuş) panele geri alma, sürükleyerek kapatma (Pointer Events, pointercancel iptal) ve odak dönüşü (tetiğe)
// oradadır. İçinde aynı adla listbox; seçenekler roving tabindex ile odak alır (seçili seçenek önce). Klavye: tetikte
// ↓/↑ ya da Enter/Space açar; listede ↓/↑ (uçta durur, devre dışını atlar), Home/End, Enter/Space seçip kapatır; Escape,
// "Kapat" ve örtü değiştirmeden kapatır (Escape üst katmana taşmaz). Devre dışı seçenek listede kalır, "Kullanılamaz"
// notunu taşır ve seçilemez. Durum, ARIA ve odak anında; hareket (giriş/çıkış, tek süre/eğri) yalnız sunumdur.

export interface TabsSecimProps {
  items: readonly TabItem[];
  secili: string | undefined;
  sec(key: string): void;
  label?: string;
  aciklama?: string;
  className: string;
  /** Not paragrafı ve isteğe bağlı içerik; tetiğin altında. */
  children?: ReactNode;
}

const KULLANILAMAZ = 'Kullanılamaz';

export function TabsSecim({ items, secili, sec, label, aciklama, className, children }: TabsSecimProps) {
  const id = useId();
  const sayfaId = `${id}-sayfa`;
  const baslikId = `${id}-baslik`;
  const tetikRef = useRef<HTMLButtonElement>(null);
  const secenekler = useRef(new Map<string, HTMLLIElement>());
  /** Açılınca etkin seçeneğe odak: seçenekler bağlanınca (portal hedefi sonraki eşzamanlı render'da gelebilir). */
  const bekleyenOdak = useRef(false);
  const [acik, setAcik] = useState(false);
  const [aktif, setAktif] = useState<string | undefined>(undefined);
  const seciliItem = items.find(item => item.key === secili);

  const baslangic = () => (seciliItem && !seciliItem.disabled ? seciliItem.key : ilkEtkin(items));
  const ac = () => {
    if (acik) return;
    setAktif(baslangic());
    bekleyenOdak.current = true;
    setAcik(true);
  };
  // Seçim ve kapanış anında; arka planı bırakmak ve odağı tetiğe döndürmek katmanın işidir (returnFocusTo).
  const kapat = (key?: string) => {
    if (key !== undefined) sec(key);
    bekleyenOdak.current = false;
    setAcik(false);
  };

  // Açılış odağı: katman paneli odağı kendi layout aşamasında alır; bu effect üst bileşende olduğundan ondan sonra
  // çalışır ve etkin (seçili) seçeneğe taşır. Kare ya da zamanlayıcı yok.
  useLayoutEffect(() => {
    if (!bekleyenOdak.current || !acik) return;
    const hedef = aktif === undefined ? undefined : secenekler.current.get(aktif);
    if (!hedef?.isConnected) return;
    bekleyenOdak.current = false;
    hedef.focus({ preventScroll: true });
  });

  const onTetikKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter/Space düğmenin kendi tıklamasıyla açar; oklar APG combobox gereği.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      ac();
    }
  };

  // Escape sayfayı kapatır ve üst katmana (çekmece, diyalog, kabuk) taşmaz: alt sayfa React ağacında bu kökün
  // altındadır (portal); tuş sayfanın her yerinden (seçenek, Kapat, panel) buraya gelir.
  const onKokKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!acik || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    kapat();
  };

  const odakla = (key: string | undefined) => {
    if (key === undefined) return;
    setAktif(key);
    secenekler.current.get(key)?.focus();
  };

  const onListeKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = items.findIndex(item => item.key === aktif);
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); odakla(komsuEtkin(items, index, 1, false) ?? aktif); return;
      case 'ArrowUp': event.preventDefault(); odakla(komsuEtkin(items, index, -1, false) ?? aktif); return;
      case 'Home': event.preventDefault(); odakla(ilkEtkin(items)); return;
      case 'End': event.preventDefault(); odakla(sonEtkin(items)); return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[index];
        if (item && !item.disabled) kapat(item.key);
        return;
      }
      default:
    }
  };

  return (
    <div className={className} onKeyDown={onKokKeyDown}>
      <button
        ref={tetikRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-describedby={aciklama}
        aria-haspopup="dialog"
        aria-expanded={acik}
        aria-controls={acik ? sayfaId : undefined}
        data-focus-line=""
        className="aile-tabs__tetik"
        onClick={() => (acik ? kapat() : ac())}
        onKeyDown={onTetikKeyDown}
      >
        <span className="aile-tabs__deger">{seciliItem?.label ?? ''}</span>
        <Icon name="chevronDown" className="aile-tabs__ok" />
      </button>
      {children}
      <BottomSheet
        id={sayfaId}
        titleId={baslikId}
        title={label ?? ''}
        open={acik}
        onClose={() => kapat()}
        returnFocusTo={tetikRef}
        className="aile-tabs-sayfa"
      >
        <ul role="listbox" aria-labelledby={baslikId} className="aile-tabs-sayfa__liste" onKeyDown={onListeKeyDown}>
          {items.map(item => {
            const isSecili = item.key === secili;
            return (
              <li
                key={item.key}
                ref={element => {
                  if (element) secenekler.current.set(item.key, element);
                  else secenekler.current.delete(item.key);
                }}
                role="option"
                aria-selected={isSecili}
                aria-disabled={item.disabled ? true : undefined}
                tabIndex={item.key === aktif ? 0 : -1}
                data-focus-line=""
                className="aile-tabs-sayfa__secenek"
                onFocus={() => setAktif(item.key)}
                onClick={() => {
                  if (!item.disabled) kapat(item.key);
                }}
              >
                <span className="aile-tabs-sayfa__etiket">{item.label}</span>
                {item.disabled ? <span className="aile-tabs-sayfa__not">{KULLANILAMAZ}</span> : null}
                {isSecili ? <Icon name="check" className="aile-tabs-sayfa__onay" /> : null}
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </div>
  );
}
