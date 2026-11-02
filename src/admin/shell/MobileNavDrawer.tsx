import { useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { useDevice } from '../device';
import { Drawer, Menu } from '../ui';
import type { MobileNavDrawerProps } from './contracts';
import { adminGroups, currentAdminLink, settingsLink } from './navigation';

// Tasarım: tasarim-sistemi/README.md "Kabuk" (< 1024 px: üst bardaki Sayfalar düğmesi modal çekmece açar; Kapat düğmesi,
// Escape kapatır, kapanınca odak Sayfalar düğmesine döner, odak çekmece içinde kalır) + bundle.js AppShell dar dalı:
// Drawer side "left" tone "nav" title "Sayfalar" → <nav aria-label="Sayfalar"> → Menu variant "nav"; öğe seçimi çekmeceyi
// kapatır. Telefonda tam ekran, tablette ayrinti-genislik 384 (uyarlanır teslim tablosu). Odak girişi/dönüşü, Escape ve örtü
// tıklaması ui/Drawer'da; bağlantılar hash yollar (wouter hash), gezinmeyi tarayıcı yapar, biz yalnız kapatırız.
// Ayarlar ayırıcıdan sonra, settings simgesiyle (bundle NAV_ALT). "E-tabloyu aç" burada yok: navigation.ts'te bağlantı yok
// ve gerçek Sheet kimliği yazılmaz.
//
// Modal sözleşmesinin iki parçası burada tamamlanır (e2e admin-layout.spec.ts):
// 1. Tab tuzağı: antd/rc kilidi odağı yalnız focusin ile geri çeker; son öğeden Tab odağı belgeden (tarayıcı arayüzüne)
//    çıkarınca focusin olmaz ve odak body'de kalır. Sınırda Tab kesilir, odak karşı uca geçer; aradaki duraklar tarayıcıda.
// 2. Odak dönüşü: ui/Drawer dönüşü layout aşamasında yapar; o anda rc kilidi henüz açıktır (passive effect'te kalkar) ve
//    odağı panele geri çeker; hareket kapalıyken (reduced-motion) panel aynı anda söküldüğü için odak body'de kalır.
//    Kapanıştan sonraki passive effect'te kilit kalkmıştır: odak çekmecedeyse ya da body'ye düştüyse Sayfalar düğmesine
//    döner; rota değişimi odağı main'e taşıdıysa dokunulmaz.

type MenuItems = ComponentProps<typeof Menu>['items'];

const ROOT_CLASS = 'aile-mobile-nav';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]'));
}

/** Odak kapanıştan sonra çekmecede mi ya da hiçbir yerde mi (body / sökülmüş öğe)? */
function focusLeftBehind(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement || !active.isConnected) return true;
  return !!active.closest(`.${ROOT_CLASS}`);
}

const pageItems: MenuItems = [
  ...adminGroups.flatMap(group => group.links.map(link => ({ key: link.path, label: link.label, href: `#${link.path}` }))),
  { key: 'ayirici', label: '', divider: true },
  { key: settingsLink.path, label: settingsLink.label, href: `#${settingsLink.path}`, icon: 'settings' },
];

export function MobileNavDrawer({ open, onClose, location, returnFocusTo }: MobileNavDrawerProps) {
  const device = useDevice();
  const selectedKey = currentAdminLink(location).path;
  const nav = useRef<HTMLElement | null>(null);

  // Açıldığı anda odaklı öğe (returnFocusTo verilmediğinde dönüş hedefi).
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  const wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || !focusLeftBehind()) return;
    const target = returnFocusTo?.current ?? opener.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [open, returnFocusTo]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const dialog = nav.current?.closest<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      const stops = focusables(dialog);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && dialog.contains(active);
      const atStart = !inside || active === dialog || active === first;
      if (event.shiftKey ? atStart : (!inside || active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <Drawer
      title="Sayfalar"
      open={open}
      onClose={onClose}
      side="left"
      tone="nav"
      full={device === 'phone'}
      returnFocusTo={returnFocusTo}
      className={ROOT_CLASS}
    >
      <nav ref={nav} aria-label="Sayfalar">
        <Menu variant="nav" items={pageItems} selectedKey={selectedKey} onSelect={onClose} />
      </nav>
    </Drawer>
  );
}
