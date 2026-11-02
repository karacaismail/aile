import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { ilkEtkin, komsuEtkin, sonEtkin, type TabItem } from './Tabs.gezinme';

// Telefon + 5 ve üstü öğe (envanter.md › Tabs (5+ sekme) → Select; README: telefonda seçim listesi alttan açılır).
// APG Select-Only Combobox, açılır katmanı modal dialog: tetik role=combobox (ad = label, açıklama = not),
// aria-haspopup="dialog", aria-expanded, açıkken aria-controls → sayfa. Sayfa role=dialog aria-modal, başlık h2 (= ad),
// içinde aynı adla listbox; seçenekler roving tabindex ile odak alır (seçili seçenek önce). Klavye: tetikte ↓/↑/Alt+↓
// ya da Enter/Space açar; listede ↓/↑ (uçta durur, devre dışını atlar), Home/End, Enter/Space seçip kapatır; Escape,
// görünür "Kapat" ve örtü değiştirmeden kapatır; Tab/Shift+Tab sayfada kalır (seçenek ↔ Kapat). Kapanınca odak hemen
// tetiğe döner. Devre dışı seçenek listede kalır, "Kullanılamaz" notunu taşır ve seçilemez.
// Katman yönetim köküne (.aile-admin; token, yazı tipi ve admin.css odak çizgisi oradan) portallanır, yoksa body'ye.
// Hareket: açılış/kapanış aynı süre ve eğriyle (transform + örtü opaklığı) iki yönde; ARIA ve odak beklemez. Kapanış
// hareketi bitince (transitionend; süre 0 ise hemen: reduced-motion, jsdom) katman DOM'dan kalkar; o sırada inert.

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
const KAPAT = 'Kapat';

type Durum = 'kapali' | 'aciliyor' | 'acik' | 'kapaniyor';

/** Öğenin en uzun geçişi (ms): süre + gecikme listelerinin en büyüğü. CSS yoksa 0. */
function gecisSuresi(element: Element): number {
  const style = window.getComputedStyle(element);
  const ms = (value: string) => value.split(',').map(part => {
    const text = part.trim();
    const number = Number.parseFloat(text);
    if (!Number.isFinite(number)) return 0;
    return text.endsWith('ms') ? number : number * 1000;
  });
  const sureler = ms(style.transitionDuration || '0s');
  const gecikmeler = ms(style.transitionDelay || '0s');
  return Math.max(0, ...sureler.map((sure, index) => sure + (gecikmeler[index] ?? gecikmeler[0] ?? 0)));
}

export function TabsSecim({ items, secili, sec, label, aciklama, className, children }: TabsSecimProps) {
  const id = useId();
  const sayfaId = `${id}-sayfa`;
  const baslikId = `${id}-baslik`;
  const tetikRef = useRef<HTMLButtonElement>(null);
  const sayfaRef = useRef<HTMLDivElement>(null);
  const kapatRef = useRef<HTMLButtonElement>(null);
  const secenekler = useRef(new Map<string, HTMLLIElement>());
  const [durum, setDurum] = useState<Durum>('kapali');
  const [kok, setKok] = useState<Element | null>(null);
  const [aktif, setAktif] = useState<string | undefined>(undefined);
  const acik = durum === 'aciliyor' || durum === 'acik';
  const seciliItem = items.find(item => item.key === secili);

  const baslangic = () => (seciliItem && !seciliItem.disabled ? seciliItem.key : ilkEtkin(items));
  const ac = () => {
    if (acik) return;
    setKok(tetikRef.current?.closest('.aile-admin') ?? document.body);
    setAktif(baslangic());
    // Kapanırken yeniden açılırsa katman yerinde kalır ve geçiş bulunduğu konumdan geri döner.
    setDurum(onceki => (onceki === 'kapali' ? 'aciliyor' : 'acik'));
  };
  const kapat = (key?: string) => {
    if (key !== undefined) sec(key);
    setDurum(onceki => (onceki === 'kapali' ? onceki : 'kapaniyor'));
    tetikRef.current?.focus();
  };

  // Giriş: katman kapalı konumda çizildi; stil hesaplanır, sonra açık konuma geçilir (geçiş başlar).
  useLayoutEffect(() => {
    if (durum !== 'aciliyor') return;
    sayfaRef.current?.getBoundingClientRect();
    setDurum('acik');
  }, [durum]);

  // Odak sayfaya: açılınca aktif (seçili) seçenek.
  useLayoutEffect(() => {
    if (!acik) return;
    const hedef = aktif === undefined ? kapatRef.current : secenekler.current.get(aktif);
    hedef?.focus();
    // Yalnız açılış anı (aktif bilerek bağımlılık değil); sonraki odak hareketini klavye/işaretçi yönetir.
  }, [acik]);

  // Çıkış: hareket bitince (ya da süre 0 ise hemen) katman kalkar. Zamanlayıcı yalnız kaçan transitionend için yedek.
  useEffect(() => {
    if (durum !== 'kapaniyor') return;
    const sayfa = sayfaRef.current;
    const bitir = () => setDurum(onceki => (onceki === 'kapaniyor' ? 'kapali' : onceki));
    const sure = sayfa ? gecisSuresi(sayfa) : 0;
    if (!sayfa || sure <= 0) {
      bitir();
      return;
    }
    const sonlandi = (event: TransitionEvent) => {
      if (event.target === sayfa && event.propertyName === 'transform') bitir();
    };
    sayfa.addEventListener('transitionend', sonlandi);
    sayfa.addEventListener('transitioncancel', sonlandi);
    const yedek = window.setTimeout(bitir, sure + 100);
    return () => {
      sayfa.removeEventListener('transitionend', sonlandi);
      sayfa.removeEventListener('transitioncancel', sonlandi);
      window.clearTimeout(yedek);
    };
  }, [durum]);

  const onTetikKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter/Space düğmenin kendi tıklamasıyla açar; oklar APG combobox gereği.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      ac();
    }
  };

  const odakla = (key: string | undefined) => {
    if (key === undefined) return;
    setAktif(key);
    secenekler.current.get(key)?.focus();
  };

  const onSayfaKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      kapat();
      return;
    }
    if (event.key === 'Tab') {
      // Odak sayfada kalır: aktif seçenek ↔ Kapat.
      event.preventDefault();
      const secenek = aktif === undefined ? null : secenekler.current.get(aktif) ?? null;
      const hedef = document.activeElement === kapatRef.current ? secenek : kapatRef.current;
      (hedef ?? kapatRef.current)?.focus();
    }
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

  const katman = durum === 'kapali' || !kok ? null : createPortal(
    <div className="aile-tabs-katman" data-aile-katman="" data-acik={durum === 'acik' ? 'true' : 'false'} inert={durum === 'kapaniyor' ? true : undefined}>
      <div className="aile-tabs-katman__ortu" aria-hidden="true" onClick={() => kapat()} />
      <div
        ref={sayfaRef}
        id={sayfaId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={baslikId}
        className="aile-tabs-sayfa"
        onKeyDown={onSayfaKeyDown}
      >
        <span className="aile-tabs-sayfa__tutamac" aria-hidden="true" />
        <div className="aile-tabs-sayfa__ust">
          <h2 id={baslikId} className="aile-tabs-sayfa__baslik">{label}</h2>
          <button ref={kapatRef} type="button" className="aile-tabs-sayfa__kapat" data-focus-line="" onClick={() => kapat()}>
            <Icon name="close" />
            {KAPAT}
          </button>
        </div>
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
      </div>
    </div>,
    kok,
  );

  return (
    <div className={className}>
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
      {katman}
    </div>
  );
}
