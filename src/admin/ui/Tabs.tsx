import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useDevice } from '../device';
import { Icon } from './icons';
import { TabsSecim } from './Tabs.secim';
import { ilkEtkin, komsuEtkin, sonEtkin, type TabItem } from './Tabs.gezinme';
import './Tabs.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Tabs/README.md + index.d.ts TabsProps + bundle.js Tabs; envanter.md
// (telefonda 5+ sekme → Select, alttan sayfa). Yerel HTML + WAI-ARIA APG; antd yok, tek uygulama bütün profillere hizmet eder.
//  - Sekme (varsayılan): role=group (ad + not açıklaması) içinde adlı tablist. Roving tabindex: tek sekme durağı seçili
//    sekmedir; ←/→ (uçlarda sarar) ve Home/End odağı taşır ve OTOMATİK etkinleştirir; devre dışı sekme görünür kalır
//    (aria-disabled), oklar onu atlar. İçerik verilirse (children) tabpanel çizilir: aria-labelledby seçili sekme,
//    seçili sekme aria-controls. Sayfa içeriği kendi çiziyorsa panel ve aria-controls yoktur.
//  - Segment (variant="segment"): görünüm modu radiogroup'u (APG Radio Group): ←/→/↑/↓ odağı taşır ve işaretler (sarar);
//    devre dışı radyo native disabled (odaklanamaz, atlanır).
//  - Telefon + 5 ve üstü öğe: select-only combobox; liste alttan açılan sayfada (Tabs.secim.tsx).
// Dar şerit kendi içinde yatay kayar; gizli sekme olan kenarda süsleyici taşma ipucu (Phosphor ok) görünür, basınca kaydırır.
// Seçim (tasarım): secili yüzey + 600; sekmede ayrıca alt kenarda düz çizgi, sekmenin alt köşeleri her durumda radiussuz
// (kavisli vurgu kenarı yok). Odak çizgisini admin.css çizer ([role=tab] / [data-focus-line] ::after, klavye modunda,
// kontrolün 4 px altında); seçim çizgisi ::before'dadır, iki gösterge ayrıdır. Seçim tıklamada (pointerup → click) olur:
// pointercancel ile biten dokunuş (şerit kaydırıldı) seçmez.
export type { TabItem } from './Tabs.gezinme';

export interface TabsProps {
  items: readonly TabItem[];
  /** Verilmezse ilk etkin öğe seçilir; sonraki değişiklikler izlenir (yarı kontrollü). */
  activeKey?: string;
  onChange?(key: string): void;
  /** `segment`: görünüm modu seçimi (radiogroup); varsayılan sekme şeridi (tablist). */
  variant?: 'segment';
  /** Erişilebilir ad: grup + tablist / radiogroup / combobox. */
  label?: string;
  /** Devre dışı seçeneğin gerekçesi; şeridin altında 14 px, gruba açıklama olarak bağlı. */
  note?: string;
  className?: string;
  /** Seçili sekmenin içeriği. Verilirse role=tabpanel içinde çizilir (aria-labelledby seçili sekme). */
  children?: ReactNode;
}

/** Telefonda bu sayı ve üstü sekme Select'e düşer (envanter.md › Tabs (5+ sekme)). */
export const SECIM_ESIGI = 5;

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function Tabs({ items, activeKey, onChange, variant, label, note, className, children }: TabsProps) {
  const device = useDevice();
  const noteId = useId();
  const [secili, setSecili] = useState(() => activeKey ?? ilkEtkin(items));
  // Üst bileşen activeKey'i değiştirince seçimi ona eşitle (render sırasında durum ayarlama kalıbı).
  const [izlenenKey, setIzlenenKey] = useState(activeKey);
  if (activeKey !== izlenenKey) {
    setIzlenenKey(activeKey);
    if (activeKey !== undefined) setSecili(activeKey);
  }
  // Durum ve ARIA anında güncellenir; hareket yalnız sunumdadır.
  const sec = (key: string) => {
    const item = items.find(candidate => candidate.key === key);
    if (!item || item.disabled || key === secili) return;
    setSecili(key);
    onChange?.(key);
  };

  const aciklama = note ? noteId : undefined;
  const notNode = note ? <p id={noteId} className="aile-tabs__not">{note}</p> : null;

  if (device === 'phone' && items.length >= SECIM_ESIGI) {
    return (
      <TabsSecim items={items} secili={secili} sec={sec} label={label} aciklama={aciklama} className={cx('aile-tabs', 'aile-tabs--secim', className)}>
        {notNode}
        {children === undefined ? null : <div className="aile-tabs__panel">{children}</div>}
      </TabsSecim>
    );
  }

  return (
    <Serit
      items={items}
      secili={secili}
      sec={sec}
      segment={variant === 'segment'}
      label={label}
      aciklama={aciklama}
      notNode={notNode}
      className={className}
      panel={children}
    />
  );
}

interface SeritProps {
  items: readonly TabItem[];
  secili: string | undefined;
  sec(key: string): void;
  segment: boolean;
  label?: string;
  aciklama?: string;
  notNode: ReactNode;
  className?: string;
  panel: ReactNode;
}

function Serit({ items, secili, sec, segment, label, aciklama, notNode, className, panel }: SeritProps) {
  const id = useId();
  const listeRef = useRef<HTMLDivElement>(null);
  const dugmeler = useRef(new Map<string, HTMLButtonElement>());
  // Üst bileşen her render'da yeni dizi verebilir (QueryBar); gözlem yalnız öğe kümesi değişince yenilenir.
  const { tasma, olc } = useTasma(listeRef, items.map(item => item.key).join('\n'));
  const seciliIndex = items.findIndex(item => item.key === secili);
  // Tek sekme durağı: seçili (etkin) öğe; yoksa ilk etkin öğe.
  const durak = seciliIndex >= 0 && !items[seciliIndex]!.disabled ? secili : ilkEtkin(items);
  const sekmeId = (index: number) => `${id}-oge-${index}`;
  const panelId = `${id}-panel`;
  const panelVar = panel !== undefined;

  // Seçili öğe şeritte görünür kalır: yalnız şeridin kendi kaydırması ayarlanır (sayfa dikeyde kaydırılmaz); ipucu
  // genişliği kadar pay bırakılır ki seçili öğe ipucunun altında kalmasın.
  useLayoutEffect(() => {
    const liste = listeRef.current;
    const dugme = secili === undefined ? undefined : dugmeler.current.get(secili);
    if (!liste || !dugme || liste.scrollWidth <= liste.clientWidth) return;
    const pay = liste.parentElement?.querySelector<HTMLElement>('.aile-tabs__ipucu')?.offsetWidth ?? 0;
    const sol = dugme.offsetLeft;
    const sag = sol + dugme.offsetWidth;
    if (sol - pay < liste.scrollLeft) liste.scrollLeft = Math.max(0, sol - pay);
    else if (sag + pay > liste.scrollLeft + liste.clientWidth) liste.scrollLeft = sag + pay - liste.clientWidth;
    olc();
  }, [secili, olc]);

  const tasi = (key: string | undefined) => {
    if (key === undefined) return;
    dugmeler.current.get(key)?.focus();
    sec(key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const odakli = [...dugmeler.current].find(([, dugme]) => dugme === event.target)?.[0];
    if (odakli === undefined) return;
    const index = items.findIndex(item => item.key === odakli);
    let hedef: string | undefined;
    switch (event.key) {
      case 'ArrowRight': hedef = komsuEtkin(items, index, 1); break;
      case 'ArrowLeft': hedef = komsuEtkin(items, index, -1); break;
      // APG Radio Group dikey okları da kullanır; yatay tablist yalnız ←/→ ve Home/End.
      case 'ArrowDown': if (segment) hedef = komsuEtkin(items, index, 1); break;
      case 'ArrowUp': if (segment) hedef = komsuEtkin(items, index, -1); break;
      case 'Home': if (!segment) hedef = ilkEtkin(items); break;
      case 'End': if (!segment) hedef = sonEtkin(items); break;
      default: return;
    }
    if (hedef === undefined) return;
    event.preventDefault();
    tasi(hedef);
  };

  const kaydir = (yon: -1 | 1) => {
    const liste = listeRef.current;
    if (!liste) return;
    // Anlık kaydırma: tarayıcının kendi yumuşak kaydırma eğrisi hareket sözleşmesine bağlanamaz.
    liste.scrollLeft = Math.max(0, liste.scrollLeft + yon * Math.max(liste.clientWidth * 0.8, 1));
    olc();
  };

  const liste = (
    <div className="aile-tabs__serit">
      <div
        ref={listeRef}
        role={segment ? 'radiogroup' : 'tablist'}
        aria-label={label}
        aria-describedby={segment ? aciklama : undefined}
        aria-orientation={segment ? undefined : 'horizontal'}
        data-tasma-bas={tasma.bas ? 'true' : 'false'}
        data-tasma-son={tasma.son ? 'true' : 'false'}
        className="aile-tabs__liste"
        onKeyDown={onKeyDown}
      >
        {items.map((item, index) => {
          const isSecili = item.key === secili;
          return (
            <button
              key={item.key}
              ref={element => {
                if (element) dugmeler.current.set(item.key, element);
                else dugmeler.current.delete(item.key);
              }}
              type="button"
              id={sekmeId(index)}
              role={segment ? 'radio' : 'tab'}
              aria-selected={segment ? undefined : isSecili}
              aria-checked={segment ? isSecili : undefined}
              aria-disabled={!segment && item.disabled ? true : undefined}
              aria-controls={!segment && panelVar && isSecili ? panelId : undefined}
              disabled={segment && item.disabled ? true : undefined}
              tabIndex={item.key === durak ? 0 : -1}
              data-focus-line=""
              className="aile-tabs__oge"
              onClick={() => sec(item.key)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <TasmaIpucu yon="bas" gorunur={tasma.bas} onPress={() => kaydir(-1)} />
      <TasmaIpucu yon="son" gorunur={tasma.son} onPress={() => kaydir(1)} />
    </div>
  );

  if (segment) {
    return (
      <div className={cx('aile-tabs', 'aile-tabs--segment', className)}>
        {liste}
        {notNode}
        {panelVar ? <div className="aile-tabs__panel">{panel}</div> : null}
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} aria-describedby={aciklama} className={cx('aile-tabs', className)}>
      {liste}
      {notNode}
      {panelVar ? (
        <div role="tabpanel" id={panelId} aria-labelledby={seciliIndex >= 0 ? sekmeId(seciliIndex) : undefined} className="aile-tabs__panel">
          {panel}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Süsleyici taşma ipucu (aria-hidden, sekme durağı değil): klavye oklarla, dokunma kaydırarak gezer; ipucuna basmak
 * işaretçi kolaylığıdır ve şeridi o yöne kaydırır. Görünürlük data-gorunur ile, opaklık geçişi iki yönde aynı.
 */
function TasmaIpucu({ yon, gorunur, onPress }: { yon: 'bas' | 'son'; gorunur: boolean; onPress(): void }) {
  return (
    <span className="aile-tabs__ipucu" data-yon={yon} data-gorunur={gorunur ? 'true' : 'false'} aria-hidden="true" onClick={onPress}>
      <span className="aile-tabs__ipucu-simge">
        <Icon name="chevronRight" />
      </span>
    </span>
  );
}

/** Şeridin iki yandaki taşması: kaydırma, boyut (ResizeObserver) ve öğe değişiminde yeniden ölçülür. */
function useTasma(ref: RefObject<HTMLElement | null>, anahtar: string) {
  const [tasma, setTasma] = useState({ bas: false, son: false });
  const olc = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const bas = element.scrollLeft > 1;
    const son = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setTasma(onceki => (onceki.bas === bas && onceki.son === son ? onceki : { bas, son }));
  }, [ref]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    olc();
    element.addEventListener('scroll', olc, { passive: true });
    const gozlemci = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => olc());
    gozlemci?.observe(element);
    for (const child of Array.from(element.children)) gozlemci?.observe(child);
    return () => {
      element.removeEventListener('scroll', olc);
      gozlemci?.disconnect();
    };
  }, [ref, olc, anahtar]);
  return { tasma, olc };
}
