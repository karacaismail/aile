import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { lazyWide } from '../adaptive';
import { useDevice } from '../device';
import type { RecordRow, StatusLabel } from '../shell/contracts';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './icons';
import { BOS_SUTUN, KANBAN_ETIKET, KanbanCard, KanbanColumnHeader, buildColumns, rememberFocusedCard, type KanbanBoardProps } from './Kanban.parts';
import './Kanban.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Kanban/README.md + index.d.ts KanbanProps; referans davranış
// bundle.js Kanban/KanbanCard. Kayıtları tedarik durumuna göre gruplar. Uyarlamalı teslim (W0 sözleşmesi):
//  - Telefon (useDevice 'phone' ya da narrow): duruma göre gruplu DİKEY liste; her grup adıyla bir bölge (h3: durum
//    etiketi + "N kayıt" + planlanan toplam). Yatay kaydırma ve sürükleme yok. onChangeStatus verilirse her kartın
//    yanında klavyeli "Durumu değiştir" düğmesi: alt sayfada (BottomSheet) APG menü düzeni, menuitemradio (şu anki
//    durum aria-checked), dolaşan tabindex, oklar sarmalı, Home/End, Enter/Space seçer, Escape kapatır. Kayıt yeni
//    gruba taşınsa da odak o kaydın "Durumu değiştir" düğmesine döner.
//  - Geniş (tablet/masaüstü): yatay pano ızgarası ui/wide/Kanban.wide.tsx'tedir ve yalnız lazyWide ile iner; beklerken
//    ve yükleme hatasında aynı rol/adlarla liste yedektir (telefonda hiç indirilmez). Adlı bölge (role="region") bu
//    dosyada ve tek düğümdür: liste ↔ pano geçişinde yerinde kalır (bölgeye tutunan odak/sorgu kopmaz); genişte
//    kendi içinde yatay kayan, sekme sırasındaki kaydırma alanıdır. Panoda kart içi durum eylemi yoktur: README'ye
//    göre ayrıntıdaki "Durumu değiştir" aynı işi yapar.
// Ortak grup/kart parçaları Kanban.parts.tsx'te (telefon-güvenli). Bu dosya ve statik içe aktardıkları antd çekmez.

export { KANBAN_ETIKET } from './Kanban.parts';

export interface KanbanProps {
  items: readonly RecordRow[];
  /** Grup sırası (tedarik durumu sözlüğü). Verilmezse kayıtların durumundan ilk görülme sırasıyla türetilir;
   *  boş grup yalnız burada verilince çizilir ("Bu durumda kayıt yok."). */
  columns?: readonly StatusLabel[];
  /** Seçili (ayrıntısı açık) kaydın id'si. */
  selectedKey?: string;
  /** Kart tıklaması ya da Enter/Space. */
  onOpen?(row: RecordRow): void;
  /** Telefon listesini zorlar (geniş pano yüklenmez); verilmezse useDevice() === 'phone'. */
  narrow?: boolean;
  /** Panonun erişilebilir adı. */
  label?: string;
  className?: string;
  /** Telefonda kart yanındaki "Durumu değiştir"; verilmezse eylem çizilmez. Yazma üst bileşenin işidir. */
  onChangeStatus?(row: RecordRow, next: StatusLabel): void;
  /** "Durumu değiştir" seçenekleri (iş akışı); verilmezse columns, o da yoksa görülen durumlar. */
  statusOptions?: readonly StatusLabel[];
}

const DURUMU_DEGISTIR = 'Durumu değiştir';
const YENI_DURUM = 'Yeni durum';

const KanbanBoard = lazyWide('ui-kanban-pano', () => import('./wide/Kanban.wide'));

export function Kanban({ items, columns, selectedKey, onOpen, narrow, label = KANBAN_ETIKET, className, onChangeStatus, statusOptions }: KanbanProps) {
  const device = useDevice();
  const wide = !(narrow ?? device === 'phone');
  const list = (
    <KanbanList items={items} columns={columns} selectedKey={selectedKey} onOpen={onOpen} onChangeStatus={onChangeStatus} statusOptions={statusOptions} />
  );
  // Kap kaydırmaz ve konumlanır: genişte bölgenin (kaydırma alanı) ::after odak çizgisi ona göre çizilir, kırpılmaz (Kanban.css).
  return (
    <div className="aile-kanban-kap">
      <div
        className={['aile-kanban', wide ? 'aile-kanban--pano' : 'aile-kanban--liste', className].filter(Boolean).join(' ')}
        role="region"
        aria-label={label}
        data-device={device}
        data-gorunum={wide ? 'pano' : 'liste'}
        tabIndex={wide ? 0 : undefined}
        onFocusCapture={event => rememberFocusedCard(event.currentTarget, event.target)}
      >
        {wide ? <KanbanBoard items={items} columns={columns} selectedKey={selectedKey} onOpen={onOpen} wideFallback={list} /> : list}
      </div>
    </div>
  );
}

// --- Telefon listesi (genişte pano yüklenene dek yedek) ---------------------------------------------------
interface KanbanListProps extends KanbanBoardProps {
  onChangeStatus?(row: RecordRow, next: StatusLabel): void;
  statusOptions?: readonly StatusLabel[];
}

function KanbanList({ items, columns, selectedKey, onOpen, onChangeStatus, statusOptions }: KanbanListProps) {
  const baseId = useId();
  const groups = buildColumns(items, columns);
  const options = statusOptions ?? columns ?? groups.map(({ label: text, tone }) => ({ label: text, tone }));
  const rootRef = useRef<HTMLDivElement>(null);
  // "Durumu değiştir" düğmeleri kayıt id'sine göre. Kayıt başka gruba taşınınca düğme yeniden bağlanır; harita en son
  // bağlanan öğeyi tutar, okuma isConnected ile doğrular.
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [openId, setOpenId] = useState<string | null>(null);
  // Odağın izlediği kayıt: alt sayfa kapanınca ve kayıt (üst bileşen yazınca, belki sonra) yeni gruba taşınınca odak
  // o kaydın düğmesine döner. Kullanıcı başka yere odaklanınca bırakılır.
  const follow = useRef<string | null>(null);
  const triggerFor = (id: string | null) => {
    const element = id ? triggers.current.get(id) : undefined;
    return element?.isConnected ? element : null;
  };
  // BottomSheet dönüşü okuma anında çözülür: taşınan kaydın yeni düğmesi.
  const returnFocusTo = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() { return triggerFor(follow.current); },
  }), []);

  useLayoutEffect(() => {
    if (openId || !follow.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    triggerFor(follow.current)?.focus({ preventScroll: true });
  });

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    // Portal (alt sayfa) olayları da React ağacından kabarır; yalnız listenin kendi DOM'undaki odak sayılır.
    const target: Node = event.target;
    if (openId || !rootRef.current?.contains(target)) return;
    if (follow.current && target !== triggerFor(follow.current)) follow.current = null;
  };

  const openRow = openId ? items.find(row => row.id === openId) ?? null : null;
  const close = () => setOpenId(null);
  const pick = (row: RecordRow, next: StatusLabel) => {
    setOpenId(null);
    if (next.label !== row.status.label) onChangeStatus?.(row, next);
  };

  return (
    <div ref={rootRef} className="aile-kanban-liste" onFocusCapture={onFocusCapture}>
      {groups.map((group, index) => {
        const headingId = `${baseId}-grup-${index}`;
        return (
          <section key={group.label} className="aile-kanban-sutun" aria-label={group.label}>
            <KanbanColumnHeader column={group} headingId={headingId} />
            {group.rows.length > 0 ? (
              <ul className="aile-kanban-kartlar" aria-labelledby={headingId}>
                {group.rows.map(row => {
                  const titleId = `${baseId}-kayit-${row.id}`;
                  return (
                    <li key={row.id} className="aile-kanban-oge">
                      <KanbanCard row={row} selected={selectedKey !== undefined && row.id === selectedKey} onOpen={onOpen} titleId={titleId} />
                      {onChangeStatus ? (
                        <span className="aile-kanban-eylem">
                          <Button
                            variant="quiet"
                            className="aile-kanban-degistir"
                            aria-haspopup="dialog"
                            aria-expanded={openId === row.id}
                            aria-describedby={titleId}
                            ref={(element: HTMLButtonElement | null) => { if (element) triggers.current.set(row.id, element); }}
                            onClick={() => { follow.current = row.id; setOpenId(row.id); }}
                          >
                            {DURUMU_DEGISTIR}
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="aile-kanban-bos">{BOS_SUTUN}</p>
            )}
          </section>
        );
      })}
      {onChangeStatus ? (
        <BottomSheet title={DURUMU_DEGISTIR} open={openRow !== null} onClose={close} returnFocusTo={returnFocusTo}>
          {openRow ? <StatusMenu row={openRow} options={options} onPick={next => pick(openRow, next)} /> : null}
        </BottomSheet>
      ) : null}
    </div>
  );
}

// --- Durum menüsü (alt sayfa içeriği) ------------------------------------------------------------------
const nextFrame = (callback: () => void): (() => void) => {
  if (typeof window.requestAnimationFrame === 'function') {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timer = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timer);
};

function StatusMenu({ row, options, onPick }: { row: RecordRow; options: readonly StatusLabel[]; onPick(next: StatusLabel): void }) {
  const current = Math.max(0, options.findIndex(option => option.label === row.status.label));
  const [active, setActive] = useState(current);
  const menuRef = useRef<HTMLUListElement>(null);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);

  // Açılışta odak şu anki duruma: alt sayfanın kendi panel odağından sonra (bir sonraki kare), içerik odağı alınca
  // BottomSheet onu çalmaz.
  useEffect(() => nextFrame(() => { items()[current]?.focus({ preventScroll: true }); }), [current]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = items();
    const count = list.length;
    if (count === 0) return;
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = at < 0 ? 0 : (at + 1) % count; break;
      case 'ArrowUp': next = at < 0 ? count - 1 : (at - 1 + count) % count; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    setActive(next);
    list[next]?.focus();
  };

  return (
    <div className="aile-kanban-durum">
      <p className="aile-kanban-durum-kayit">
        <span className="aile-kanban-durum-ad">{row.label}</span>
        {' · '}
        <span className="aile-kanban-durum-simdi">{`Şu an: ${row.status.label}`}</span>
      </p>
      <ul ref={menuRef} role="menu" aria-label={YENI_DURUM} className="aile-kanban-durum-liste" onKeyDown={onKeyDown}>
        {options.map((option, index) => {
          const checked = index === current && option.label === row.status.label;
          return (
            <li key={option.label} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={index === active ? 0 : -1}
                className="aile-kanban-durum-secenek"
                data-focus-line=""
                onFocus={() => setActive(index)}
                onClick={() => onPick(option)}
              >
                <span className="aile-kanban-durum-isaret" aria-hidden="true">{checked ? <Icon name="check" /> : null}</span>
                <span className="aile-kanban-durum-etiket">{option.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
