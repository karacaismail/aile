import { useId, useState } from 'react';
import { designTokens } from '../../design/tokens.ts';
import { useDevice } from '../device';
import { AntSelect, AntTabs, Segmented } from './antd';
import { Icon } from './icons';
import './Tabs.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/Tabs/README.md + index.d.ts TabsProps + bundle.js Tabs.
// Aynı kaydın bölümleri arasında (sekme, antd Tabs → tablist) ya da görünüm modları arasında (segment,
// antd Segmented → radiogroup) geçiş. Seçili: secili yüzey + 600; alt çizgi yalnız odak içindir (inkBar
// temada şeffaf, burada gizli). Anlamsız mod gizlenmez: devre dışıdır ve gerekçesi (note) altında yazılır;
// not, gruba aria-describedby ile bağlanır. Telefonda 5+ sekme Select'e (combobox) düşer (envanter.md);
// devre dışı seçenek "Kullanılamaz" notuyla listede kalır. Odak çizgisini admin.css çizer ([role=tab]);
// segment için aynı çizgi Tabs.css'te (antd item ::after'ı hover örtüsü olduğundan etiket ::after'ında).
export interface TabItem {
  key: string;
  label: string;
  /** Devre dışı seçenek görünür kalır; gerekçesi `note` ile verilir. */
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Verilmezse ilk etkin öğe seçilir; sonraki değişiklikler izlenir (yarı kontrollü). */
  activeKey?: string;
  onChange?(key: string): void;
  /** `segment`: görünüm modu seçimi (radiogroup); varsayılan sekme şeridi (tablist). */
  variant?: 'segment';
  /** Erişilebilir ad: grup / radiogroup / combobox. */
  label?: string;
  /** Devre dışı seçeneğin gerekçesi; şeridin altında 14 px, gruba açıklama olarak bağlı. */
  note?: string;
  className?: string;
}

/** Telefonda bu sayı ve üstü sekme Select'e düşer (envanter.md › Tabs (5+ sekme)). */
export const SECIM_ESIGI = 5;
const KULLANILAMAZ = 'Kullanılamaz';
const DIGER_SEKMELER = 'Diğer sekmeler';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');
const ilkEtkin = (items: readonly TabItem[]) => (items.find(item => !item.disabled) ?? items[0])?.key;

export function Tabs({ items, activeKey, onChange, variant, label, note, className }: TabsProps) {
  const device = useDevice();
  const noteId = useId();
  const [secili, setSecili] = useState(() => activeKey ?? ilkEtkin(items));
  // Üst bileşen activeKey'i değiştirince seçimi ona eşitle (render sırasında durum ayarlama kalıbı).
  const [izlenenKey, setIzlenenKey] = useState(activeKey);
  if (activeKey !== izlenenKey) {
    setIzlenenKey(activeKey);
    if (activeKey !== undefined) setSecili(activeKey);
  }
  const sec = (key: string) => {
    if (key === secili) return;
    setSecili(key);
    onChange?.(key);
  };

  const aciklama = note ? noteId : undefined;
  const notNode = note ? <p id={noteId} className="aile-tabs__not">{note}</p> : null;
  const segment = variant === 'segment';

  if (device === 'phone' && items.length >= SECIM_ESIGI) {
    return (
      <div className={cx('aile-tabs', 'aile-tabs--secim', className)}>
        <AntSelect<string>
          aria-label={label}
          aria-describedby={aciklama}
          value={secili}
          onChange={sec}
          options={items.map(item => ({ value: item.key, label: item.label, disabled: item.disabled }))}
          optionRender={option => (
            <span className="aile-tabs__secenek">
              <span>{option.label}</span>
              {option.data.disabled ? <span className="aile-tabs__secenek-not">{KULLANILAMAZ}</span> : null}
            </span>
          )}
          virtual={false}
          className="aile-tabs__select"
          classNames={{ popup: { root: 'aile-tabs-acilir' } }}
          suffixIcon={<Icon name="chevronDown" />}
        />
        {notNode}
      </div>
    );
  }

  if (segment) {
    return (
      <div className={cx('aile-tabs', 'aile-tabs--segment', className)}>
        <div className="aile-tabs__serit">
          {/* Tek sekme durağı: rc-segmented kök div'e tabIndex 0 verir; odak işaretli radyoya gider (APG radiogroup). */}
          <Segmented<string>
            aria-label={label}
            aria-describedby={aciklama}
            tabIndex={-1}
            value={secili}
            onChange={sec}
            options={items.map(item => ({ value: item.key, label: item.label, disabled: item.disabled }))}
          />
        </div>
        {notNode}
      </div>
    );
  }

  // rc-tabs tablist'e ad almaz; adı ve açıklamayı saran grup taşır. İçerik panelleri yok (sayfa kendi çizer): Tabs.css gizler.
  return (
    <div role="group" aria-label={label} aria-describedby={aciklama} className={cx('aile-tabs', className)}>
      <AntTabs
        activeKey={secili}
        onChange={sec}
        items={items.map(item => ({ key: item.key, label: item.label, disabled: item.disabled }))}
        animated={false}
        tabBarGutter={designTokens.bosluk1}
        more={{ icon: <Icon name="more" label={DIGER_SEKMELER} /> }}
      />
      {notNode}
    </div>
  );
}
