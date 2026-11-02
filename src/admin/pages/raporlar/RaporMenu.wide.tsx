import type { PointerEvent } from 'react';
import './RaporMenu.wide.css';

// Masaüstü rapor seçimi (tasarım: solda 240 px .pg-report-nav). Yalnız masaüstü profili; lazyWide('raporlar-menu') ile
// tembel gelir. Telefon ve tablette aynı seçim "Rapor" alanıdır (alttan sayfa / açılır liste); bu liste yüklenirken ve
// yüklenemezse de o alan yerinde kalır (wideFallback).
// Rapor seçimi sayfa içi seçimdir, gezinme değildir: menü rolü (uygulama komutları) ve aria-current="page" (sayfa
// gezinmesi) kullanılmaz. Yerel düğme listesidir: ul "Rapor seçimi" > li > button; seçili rapor aria-current="true".
// Her düğme doğal Tab sırasındadır (bileşik pencere öğesi değil; ok tuşları bir şey yapmaz), Enter/Boşluk tarayıcının
// düğme davranışıyla seçer, odak seçilen düğmede kalır. Dokunma: Pointer Events ile basılı yüzey (data-pressed);
// pointercancel (kaydırmaya dönen dokunuş) siler ve tarayıcı click üretmez. Satırı dolduran düğme satır taşıyıcısıdır
// (data-focus-line="row"): odak çizgisini admin.css düğmenin kendi alt kenarına çizer. Görünüm RaporMenu.wide.css
// (yalnız --aile-* tokenları).

export interface RaporMenuProps {
  items: readonly { key: string; label: string }[];
  selectedKey: string;
  onSelect(key: string): void;
}

/** Seçim listesinin erişilebilir adı. */
const RAPOR_SECIMI = 'Rapor seçimi';

const press = (event: PointerEvent<HTMLButtonElement>) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.currentTarget.setAttribute('data-pressed', '');
};
const release = (event: PointerEvent<HTMLButtonElement>) => { event.currentTarget.removeAttribute('data-pressed'); };

export default function RaporMenu({ items, selectedKey, onSelect }: RaporMenuProps) {
  return (
    <ul className="aile-rapor-secim" aria-label={RAPOR_SECIMI}>
      {items.map((item) => (
        <li key={item.key} className="aile-rapor-secim__satir">
          <button
            type="button"
            className="aile-rapor-secim__dugme"
            data-focus-line="row"
            aria-current={item.key === selectedKey ? 'true' : undefined}
            onClick={() => onSelect(item.key)}
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
