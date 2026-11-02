import {
  useEffect, useId, useRef, useState, type ComponentType, type FocusEvent, type KeyboardEvent, type SyntheticEvent,
} from 'react';
import { WideNotice, lazyResource, useWideModule } from '../adaptive';
import { reloadPage } from '../adaptive/reload';
import { useProfile } from '../device';
import { Button } from './Button';
import { focusTargets, type MenuItem, type MenuPanelProps, type MenuProps } from './Menu.shared';
import './Menu.lazy.css';

// Menü düğmesi (WAI-ARIA APG "Menu Button"; sözleşme Menu.tsx başlığında): metinli düğme + durum + klavye. Açılır gövde
// (liste, açılır panel, telefonda BottomSheet) ayrı parçadır (Menu.panel.tsx). İki kullanım:
//  - Eşzamanlı (Menu.tsx `<Menu trigger>`): gövde `panel` ile verilir, ilk tıklamada aynı karede açılır.
//  - Tembel (OverflowActions → PageHeader "Diğer"): `panel` verilmez; gövde ilk niyette iner (adaptive lazyResource;
//    kabuğun Sayfalar çekmecesiyle aynı kalıp). Telefon ilk rotası (giriş + Genel durum) gövdeyi, BottomSheet'i ve kipli
//    katmanı statik çekmez (src/admin/phoneEntry.test.ts; ölçüm docs/ADMIN-BUDGETS.md).
// Niyet: düğmeye işaretçi basınca, düğme odak alınca ya da düğmede tuşa basınca gövde istenir (indirme başlar, açmaz).
// Açma isteği (tıklama, Enter, Space, ArrowDown, ArrowUp) gövde hazır değilse kaybolmaz: düğme aria-expanded="true" +
// aria-busy (Button loading: tekrar basış yok sayılır) taşır; gövde gelince menü açılır ve odak niyete göre ilk/son öğeye
// gider. Bekleme sırasında Escape, düğmeden ayrılan odak ya da dışarıya basış isteği iptal eder; gövde gelince açılmaz.
// İndirilemezse bir kez kendiliğinden yeniden denenir; yine olmazsa düğmenin altında kurtarma bildirimi (role="status"):
// çevrim içiyken parça hatası "Yeni sürüm var · Yenile" (sayfa yenilenir), diğerleri "Menü yüklenemedi · Yeniden dene"
// (yeniden indirir; gelince menü açılır). Bildirim varken düğmeye basmak da yeniden dener; aria-expanded o sırada false.

/** Açılış odağı: ilk ya da son etkin öğe; null = odak taşınmaz (defaultOpen önizleme). */
type FocusIntent = 'first' | 'last' | null;

type PanelModule = { MenuPanel: ComponentType<MenuPanelProps> };

/** Açılışta odağın verileceği öğeyi arayan kare sayısı (alt sayfa portalı bir kare sonra bağlanabilir). */
const FOCUS_FRAMES = 10;
/** Gövde indirilemediğinde kurtarma bildiriminin metni. */
export const MENU_PANEL_FAILED = 'Menü yüklenemedi.';

/** Menü gövdesinin tembel parçası; aynı anahtar = aynı kaynak (tüm menü düğmeleri tek indirme paylaşır). */
const PanelResource = lazyResource<PanelModule>('ui-menu-panel', () => import('./Menu.panel'));
const swallow = () => {};
/** Niyet: boştaysa indirmeyi başlatır; hata durumunda kendiliğinden yeniden denemez (bildirim ya da açma isteği dener). */
const preloadPanel = () => { PanelResource.load().catch(swallow); };
/** Açma isteği: hata durumunu sıfırlayıp yeniden dener; hazırsa hemen çözülür. */
const requestPanel = () => { PanelResource.retry().catch(swallow); };

/**
 * Gövdeyi açmadan önceden indirir (niyetle aynı kaynak); söz gövde hazır olunca çözülür, indirilemezse reddedilir. Gövde
 * hazırken menü ilk tıklamada aynı karede açılır (birim testlerinin "yüklendikten sonra" davranışı).
 */
export function loadMenuPanel(): Promise<void> {
  return PanelResource.load().then(() => undefined);
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export interface MenuButtonProps extends MenuProps {
  trigger: string;
  /** Eşzamanlı gövde (Menu.tsx). Verilmezse gövde ilk niyette tembel iner. */
  panel?: ComponentType<MenuPanelProps>;
}

export function MenuButton({
  items, selectedKey, onSelect, variant, label, className, trigger, triggerIcon, triggerVariant = 'secondary',
  defaultOpen = false, inline = false, align = 'start', popupClassName, panel,
}: MenuButtonProps) {
  const phone = useProfile() === 'phone';
  const name = label ?? trigger;
  const menuId = `aile-menu${useId()}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const intent = useRef<FocusIntent>(null);
  /** Açılır panelde Tab/Shift+Tab basıldı: odak tarayıcının sırasıyla taşındıktan sonra (blur) menü kapanır. */
  const tabbing = useRef(false);

  // Tembel gövde: açma isteği varken (defaultOpen dahil) boştaysa indirilir. Eşzamanlı gövdede kaynak izlenmez.
  const lazy = useWideModule(panel ? null : PanelResource, open);
  const Panel = panel ?? (lazy.status === 'ready' ? lazy.module.MenuPanel : null);
  const failure = open && !Panel && (lazy.status === 'error' || lazy.status === 'stale-build') ? lazy.status : null;
  /** Açma istendi, gövde yolda. */
  const pending = open && !Panel && failure === null;
  const shown = open && Panel !== null;

  const show = (where: Exclude<FocusIntent, null>) => {
    intent.current = where;
    tabbing.current = false;
    setOpen(true);
    if (!panel) requestPanel();
  };
  const hide = (returnFocus: boolean) => {
    intent.current = null;
    tabbing.current = false;
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const activate = (item: MenuItem) => {
    hide(true);
    onSelect?.(item.key);
  };

  // Açılış odağı: panel (layout) ya da alt sayfa (portal) bağlandıktan sonra ilk/son etkin öğe. Alt sayfa içeriği bir
  // kare sonra odaklanabilir olabilir; birkaç kare denenir. Odağı alan öğe olunca BottomSheet paneli odağı çalmaz.
  // Tembel gövdede gövde geldiği çizimde (Panel) çalışır: bekleme sırasındaki açma isteği kaybolmaz.
  useEffect(() => {
    if (!open || !Panel || intent.current === null) return;
    const where = intent.current;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const list = listRef.current;
      const targets = list ? focusTargets(list) : [];
      const target = where === 'last' ? targets[targets.length - 1] : targets[0];
      if (target) {
        target.focus({ preventScroll: true });
        if (document.activeElement === target) { intent.current = null; return; }
      }
      tries += 1;
      if (tries < FOCUS_FRAMES) frame = window.requestAnimationFrame(attempt);
    };
    attempt();
    return () => window.cancelAnimationFrame(frame);
  }, [open, phone, Panel]);

  // Dışarıya pointerdown (fare, dokunma, kalem) kapatır; odak kullanıcının bastığı yere gider. Açılır panelde her zaman;
  // telefonda yalnız gövde yokken (bekleme, bildirim): açık alt sayfa kendi örtüsüyle kapanır.
  const outsideCloses = open && (!phone || !shown);
  useEffect(() => {
    if (!outsideCloses) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) hide(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [outsideCloses]);

  // Profil açıkken değişirse (ör. pencere daralır) sunum değişir; menü kapanır, odak kaybolmasın diye düğmeye döner.
  const lastPhone = useRef(phone);
  useEffect(() => {
    if (lastPhone.current === phone) return;
    lastPhone.current = phone;
    if (!open) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected || !!rootRef.current?.contains(active);
    hide(lost);
  }, [phone]);

  /** Niyet yalnız düğmenin kendisinde (bildirimin "Yeniden dene"si kendi isteğini yapar). */
  const onIntent = (event: SyntheticEvent) => {
    if (!panel && event.target === triggerRef.current) preloadPanel();
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    onIntent(event);
    // Bekleme ya da bildirim sırasında Escape isteği iptal eder; odak düğmeye döner, dış katmana ulaşmaz.
    if (event.key === 'Escape' && open && !shown) {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
      return;
    }
    if (event.target !== triggerRef.current) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  };
  // Odak açılır paneli ve düğmeyi bırakıp başka bir öğeye geçerse menü kapanır (pencere odağı kaybı sayılmaz). Tab ile
  // ayrılışta (Shift+Tab düğmeye dönse de) odak tarayıcının doğal sırasıyla taşındıktan sonra kapanır: kapanış odaklı
  // öğeyi önceden söküp inert yapsaydı tarayıcının sıradaki öğeyi bulacağı nokta kaybolurdu. Gövde yokken (bekleme,
  // bildirim) her profilde: düğmeden ayrılan odak isteği iptal eder. Açık alt sayfa kendi odağını yönetir.
  const onRootBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!open || (phone && shown)) return;
    const next = event.relatedTarget;
    const panelList = listRef.current;
    if (tabbing.current && !(next instanceof Node && panelList?.contains(next))) hide(false);
    else if (next instanceof Node && !event.currentTarget.contains(next)) hide(false);
  };
  const onPopupKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (phone) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    } else if (event.key === 'Tab') {
      tabbing.current = true;
    }
  };
  const onTriggerClick = () => {
    if (failure) show(intent.current ?? 'first');
    else if (open) hide(true);
    else show('first');
  };
  // Bildirim yeniden denerken sökülür: odak önce düğmeye döner (kaybolmaz), gövde gelince niyetteki öğeye geçer.
  const retry = () => {
    triggerRef.current?.focus({ preventScroll: true });
    show(intent.current ?? 'first');
  };

  return (
    <span
      ref={rootRef}
      className={cx('aile-menu-dugme', className)}
      data-open={open ? '' : undefined}
      data-failure={failure ?? undefined}
      onKeyDown={onRootKeyDown}
      onPointerDown={onIntent}
      onFocus={onIntent}
      onBlur={onRootBlur}
    >
      <Button
        ref={triggerRef}
        variant={triggerVariant}
        icon={triggerIcon}
        iconEnd={triggerIcon ? undefined : 'chevronDown'}
        loading={pending}
        aria-haspopup={phone ? 'dialog' : 'menu'}
        aria-expanded={open && failure === null}
        aria-controls={!phone && shown ? menuId : undefined}
        onClick={onTriggerClick}
      >
        {trigger}
      </Button>
      {Panel ? (
        <Panel
          phone={phone}
          open={open}
          name={name}
          menuId={menuId}
          listRef={listRef}
          anchorRef={triggerRef}
          items={items}
          selectedKey={selectedKey}
          variant={variant}
          inline={inline}
          align={align}
          popupClassName={popupClassName}
          onActivate={activate}
          onKeyDown={onPopupKeyDown}
          onClose={() => hide(true)}
        />
      ) : null}
      {failure === 'error' ? <WideNotice kind="error" message={MENU_PANEL_FAILED} onAction={retry} /> : null}
      {failure === 'stale-build' ? <WideNotice kind="stale-build" onAction={reloadPage} /> : null}
    </span>
  );
}
