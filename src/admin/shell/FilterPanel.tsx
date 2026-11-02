import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Disclosure, Select, TextField } from '../ui';
import type { FilterFacet, FilterOption, FilterPanelProps } from './contracts';
import './FilterPanel.css';

// Tasarım: aile-tasarim/tasarim-sistemi/components/FilterPanel/README.md + README "Filtre boyutları"; referans davranış
// bundle.js FilterPanel/Opt (section aria-label "Filtreler" yalnız başlıklı panelde, bare kök div; başlık + quiet
// "Temizle" yalnız bare değilken; her boyut Disclosure, meta seçili sayısı; seçenek = kutu + etiket + sayım; ağaçta alt
// dallar içeride ve not "Üst kategori seçilince tüm alt dalları kapsar."; tarih = tür Select + Başlangıç/Bitiş gg.aa.yyyy
// numeric; tutar = En az/En çok ₺ decimal). antd Collapse yerine bizim Disclosure.
//
// Seçenek kutusu yerel <input type="checkbox"> (antd Checkbox değil): telefon yolu antd istemez ve odak GÖRÜNÜR kutuya
// düşer. Referanstaki gibi 1 px opacity 0 gizli input + çizilmiş kutu kullanılmaz: klavye odağı görünmez bir öğede
// kalıyordu (W0 bulgusu, e2e/admin-focus.spec.ts filtre çekmecesi). Kutu appearance:none ile tokenlarla çizilir; işaret
// (onay/çizgi) kardeş süsleyici span'dır. Satır <label data-focus-line>: tüm satır dokunma hedefi (44, kaba girişte 48)
// ve odak çizgisi admin.css [data-focus-line]:has(:focus-visible)::after ile satırın altında, tek merkezi klavye durumuyla.
// Seçim ile odak ayrıdır: seçili satır secili yüzey + 600 ağırlık; odak yalnız alt çizgi.
//
// Durum dışarıdadır (facet.selected); panel yalnız onToggle(facetId, value) bildirir:
// - checkbox/tree: seçeneğin value'su. Ağaçta üst değer seçiliyse alt dallar kapsanmış sayılır (işaretli görünür);
//   yalnız bazı alt dallar seçiliyse üst kutu yerel indeterminate (erişilebilirlik ağacında "mixed").
// - date: tür Select seçeneğin value'su; aralık `baslangic=gg.aa.yyyy` / `bitis=gg.aa.yyyy` (çağıran aynı önekli
//   eski girdiyi değiştirir; boş değer `baslangic=` girdiyi kaldırır). Alan değeri blur'da bildirilir; alan blur
//   olmadan sökülürse (profil ya da görünüm modu değişimi, çekmecenin Escape ile kapanması) yazılan değer yine bildirilir,
//   kaybolmaz.
// - amount: `enaz=1234.50` / `encok=…` aynı kuralla.
// "Bilinmiyor" her listede sondadır (UNKNOWN_VALUE ya da etiket "Bilinmiyor").

export const UNKNOWN_VALUE = 'bilinmiyor';
const UNKNOWN_LABEL = 'Bilinmiyor';
export const RANGE_KEYS = { baslangic: 'baslangic=', bitis: 'bitis=', enAz: 'enaz=', enCok: 'encok=' } as const;
type RangePrefix = (typeof RANGE_KEYS)[keyof typeof RANGE_KEYS];
const RANGE_PREFIXES: readonly string[] = Object.values(RANGE_KEYS);
const TREE_NOTE = 'Üst kategori seçilince tüm alt dalları kapsar.';
const DEFAULT_OPEN_COUNT = 3;
const sayi = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');
const isUnknown = (option: FilterOption) => option.value === UNKNOWN_VALUE || option.label === UNKNOWN_LABEL;
/** Verilen sırayı korur, yalnız "Bilinmiyor"u sona alır. */
const unknownLast = (options: readonly FilterOption[]) => [...options.filter(o => !isUnknown(o)), ...options.filter(isUnknown)];
/** Aralık girdisinin değeri ("baslangic=28.10.2026" → "28.10.2026"); yoksa "". */
export const rangeValue = (selected: readonly string[], prefix: RangePrefix) =>
  selected.find(entry => entry.startsWith(prefix))?.slice(prefix.length) ?? '';

/**
 * Boyuttaki gerçek seçim sayısı (Disclosure meta, çekmece başlığı ve tetik sayısı aynı sayıyı kullanır).
 * Tarih ve tutarda yalnız dolu aralık girdileri sayılır: tarih türü ("teslim") bir filtre değil, aralığın ölçütüdür.
 */
export function facetSelectedCount(facet: FilterFacet): number {
  if (facet.kind === 'date' || facet.kind === 'amount') {
    return facet.selected.filter(entry => RANGE_PREFIXES.some(prefix => entry.startsWith(prefix) && entry.length > prefix.length)).length;
  }
  return facet.selected.length;
}

/**
 * Başlıklı panel "Filtreler" adlı bölgedir (section). bare panel her zaman adını veren bir ev sahibinin içindedir
 * (FilterArea bölgesi "Filtreler", FilterDrawer / alt sayfa diyaloğu "Filtreler"): kökü landmark değildir (div), yoksa
 * aynı adlı iki bölge oluşur (f10 yapı sözleşmesi: aynı rolden landmark'lar ayırt edici adla).
 */
export function FilterPanel({ facets, onToggle, onClear, openKeys, bare = false }: FilterPanelProps) {
  const open = new Set(openKeys ?? facets.slice(0, DEFAULT_OPEN_COUNT).map(facet => facet.id));
  const body = facets.map(facet => {
    const count = facetSelectedCount(facet);
    return (
      <Disclosure key={facet.id} title={facet.label} meta={count > 0 ? `${sayi.format(count)} seçili` : undefined} defaultOpen={open.has(facet.id)}>
        <FacetBody facet={facet} onToggle={onToggle} />
      </Disclosure>
    );
  });
  if (bare) return <div className="aile-filtre aile-filtre--bare">{body}</div>;
  return (
    <section className="aile-filtre" aria-label="Filtreler">
      <div className="aile-filtre-baslik">
        <h3>Filtreler</h3>
        <Button variant="quiet" onClick={() => onClear()}>Temizle</Button>
      </div>
      {body}
    </section>
  );
}

interface FacetProps { facet: FilterFacet; onToggle: FilterPanelProps['onToggle'] }

function FacetBody({ facet, onToggle }: FacetProps) {
  switch (facet.kind) {
    case 'tree': return <TreeFacet facet={facet} onToggle={onToggle} />;
    case 'date': return <DateFacet facet={facet} onToggle={onToggle} />;
    case 'amount': return <AmountFacet facet={facet} onToggle={onToggle} />;
    default: return <CheckboxFacet facet={facet} onToggle={onToggle} />;
  }
}

function CheckboxFacet({ facet, onToggle }: FacetProps) {
  return (
    <div className="aile-filtre-secenekler">
      {unknownLast(facet.options).map(option => (
        <Option key={option.value} option={option} checked={facet.selected.includes(option.value)} onToggle={() => onToggle(facet.id, option.value)} />
      ))}
    </div>
  );
}

function TreeFacet({ facet, onToggle }: FacetProps) {
  const selected = new Set(facet.selected);
  const roots = unknownLast(facet.options.filter(option => !option.parent));
  const childrenOf = (parent: FilterOption) => unknownLast(facet.options.filter(option => option.parent === parent.value));
  return (
    <div className="aile-filtre-secenekler">
      <p className="aile-filtre-not aile-kucuk aile-ikincil">{TREE_NOTE}</p>
      {roots.map(root => {
        const children = childrenOf(root);
        const picked = children.filter(child => selected.has(child.value)).length;
        const rootChecked = selected.has(root.value) || (children.length > 0 && picked === children.length);
        const mixed = !rootChecked && picked > 0;
        return (
          <div key={root.value} className="aile-filtre-dal">
            <Option option={root} checked={rootChecked} indeterminate={mixed} onToggle={() => onToggle(facet.id, root.value)} />
            {children.map(child => (
              <Option key={child.value} option={child} alt checked={rootChecked || selected.has(child.value)} onToggle={() => onToggle(facet.id, child.value)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface OptionProps { option: FilterOption; checked: boolean; indeterminate?: boolean; alt?: boolean; onToggle(): void }

/** Seçenek: etiket satırı içinde görünür yerel kutu + etiket + sayım. Erişilebilir ad etiket, açıklama sayım. */
function Option({ option, checked, indeterminate = false, alt = false, onToggle }: OptionProps) {
  const countId = `${useId()}-sayim`;
  const hasCount = option.count !== undefined;
  const input = useRef<HTMLInputElement>(null);
  // indeterminate yalnız IDL özelliğidir (HTML özniteliği yok); tıklama onu tarayıcıda sıfırlar, her çizimde props'a eşitlenir.
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  });
  return (
    <label className={cx('aile-filtre-secenek', alt && 'aile-filtre-secenek--alt')} data-focus-line="">
      <span className="aile-filtre-kutu-alan">
        <input
          ref={input}
          type="checkbox"
          className="aile-filtre-kutu"
          checked={checked}
          onChange={onToggle}
          aria-label={option.label}
          aria-describedby={hasCount ? countId : undefined}
        />
        <span className="aile-filtre-isaret" aria-hidden="true" />
      </span>
      <span className="aile-filtre-etiket">{option.label}</span>
      {hasCount && <span id={countId} className="aile-filtre-sayim aile-kucuk aile-ikincil">{sayi.format(option.count!)}</span>}
    </label>
  );
}

function DateFacet({ facet, onToggle }: FacetProps) {
  const types = facet.options.map(({ value, label }) => ({ value, label }));
  const current = facet.selected.find(entry => types.some(type => type.value === entry)) ?? types[0]?.value;
  return (
    <div className="aile-filtre-aralik-govde">
      {types.length > 0 && <Select label="Tarih türü" options={types} value={current} onChange={value => onToggle(facet.id, value)} />}
      <div className="aile-filtre-aralik">
        <RangeField label="Başlangıç" prefix={RANGE_KEYS.baslangic} facet={facet} onToggle={onToggle} placeholder="gg.aa.yyyy" inputMode="numeric" />
        <RangeField label="Bitiş" prefix={RANGE_KEYS.bitis} facet={facet} onToggle={onToggle} placeholder="gg.aa.yyyy" inputMode="numeric" />
      </div>
    </div>
  );
}

function AmountFacet({ facet, onToggle }: FacetProps) {
  return (
    <div className="aile-filtre-aralik">
      <RangeField label="En az" prefix={RANGE_KEYS.enAz} facet={facet} onToggle={onToggle} suffix="₺" inputMode="decimal" />
      <RangeField label="En çok" prefix={RANGE_KEYS.enCok} facet={facet} onToggle={onToggle} suffix="₺" inputMode="decimal" />
    </div>
  );
}

interface RangeFieldProps extends FacetProps {
  label: string;
  prefix: RangePrefix;
  placeholder?: string;
  suffix?: string;
  inputMode: 'numeric' | 'decimal';
}

/**
 * Metin alanı yazarken yerel kalır; blur'da değişmişse `${prefix}${değer}` bildirir. Dış değer değişince eşitlenir.
 * Blur olmadan sökülürse (profil/mod değişimi, Escape) bekleyen değer sökülürken bildirilir: yazılan filtre kaybolmaz.
 */
function RangeField({ label, prefix, facet, onToggle, placeholder, suffix, inputMode }: RangeFieldProps) {
  const committed = rangeValue(facet.selected, prefix);
  const [draft, setDraft] = useState(committed);
  useEffect(() => { setDraft(committed); }, [committed]);

  const report = (value: string) => onToggle(facet.id, `${prefix}${value}`);
  const commit = () => {
    const value = draft.trim();
    if (value !== committed) report(value);
  };

  // Sökülme anındaki en son taslak ve bildirim yolu; temizlik etkisi yalnız sökülürken çalışır.
  const pending = useRef({ draft, committed, report });
  useLayoutEffect(() => {
    pending.current = { draft, committed, report };
  });
  useEffect(() => () => {
    const last = pending.current;
    const value = last.draft.trim();
    if (value !== last.committed) last.report(value);
  }, []);

  return <TextField label={label} value={draft} onChange={setDraft} onBlur={commit} placeholder={placeholder} suffix={suffix} inputMode={inputMode} />;
}
