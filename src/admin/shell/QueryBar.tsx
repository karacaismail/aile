import { useMemo } from 'react';
import { useDevice } from '../device';
import { Button, IconButton, Select, Tabs, Tag, TextField } from '../ui';
import { VIEW_LABELS, VIEW_MODES, type ActiveFilter, type QueryBarProps, type ViewMode } from './contracts';
import './QueryBar.css';

// Tasarım: README.md › Sayfa iskeleti (3. Sorgu çubuğu, 4. Filtreler) + components/QueryBar/README.md + bundle.js › QueryBar.
// Geniş (masaüstü): arama (görünür "Ara" etiketi) · kayıtlı görünüm · sıralama · dışa aktar; altında görünüm modu
// (Tabs segment, 6 mod; desteklenmeyen mod gizlenmez, devre dışıdır ve gerekçesi "Gantt kullanılamaz: …" notunda
// gruba bağlı yazılır); en altta etkin filtreler kaldırılabilir etiket olarak. Filtre paneli masaüstünde FilterArea'da
// açıktır; bu yüzden "Filtreler (N)" düğmesi yalnız dar düzende (telefon: tam ekran çekmece, tablet: sağdan 384)
// görünür ve onOpenFilters çağırır. Dar düzen: arama tam genişlik; "Filtreler (N)" + sıralama + dışa aktar (yalnız
// simge, aria-label); mod seçimi (telefonda Tabs kendisi combobox'a düşer); etkin etiketler altta. Sonuç sayısı
// tr-TR biçiminde durum metni. Bölge role="search". Renk/ölçü yalnız QueryBar.css'te --aile tokenlarıyla.

const ARA = 'Ara';
const ARA_IPUCU_GENIS = 'Ad, kimlik kodu veya satıcı';
const ARA_IPUCU_DAR = 'Ad veya kimlik kodu';
const KAYITLI_GORUNUM = 'Kayıtlı görünüm';
const SIRALAMA = 'Sıralama';
const GORUNUM_MODU = 'Görünüm modu';
const DISA_AKTAR = 'Dışa aktar';
const ETKIN_FILTRELER = 'Etkin filtreler';
const TUMUNU_TEMIZLE = 'Tümünü temizle';
const SORGU = 'Sorgu';
const sayi = new Intl.NumberFormat('tr-TR');

/** "Gantt kullanılamaz: alımların başlangıç ve bitiş tarihi yok." — gerekçe verilmezse yalnız "Gantt kullanılamaz." */
export function kullanilamazNotu(mode: ViewMode, reason?: string): string {
  const etiket = `${VIEW_LABELS[mode]} kullanılamaz`;
  if (!reason) return `${etiket}.`;
  const metin = reason.trim().replace(/\.+$/, '');
  return `${etiket}: ${metin}.`;
}

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function QueryBar({
  mode, onModeChange, supported, unsupportedReason, search, onSearchChange, sort, sortOptions, onSort, savedViews,
  exportLabel, onExport, activeFilters, onOpenFilters, resultCount,
}: QueryBarProps) {
  const device = useDevice();
  const dar = device !== 'desktop';

  const modlar = useMemo(() => VIEW_MODES.map(key => ({ key, label: VIEW_LABELS[key], disabled: !supported.includes(key) })), [supported]);
  const not = useMemo(() => {
    const satirlar = VIEW_MODES.filter(key => !supported.includes(key)).map(key => kullanilamazNotu(key, unsupportedReason?.[key]));
    return satirlar.length ? satirlar.join(' ') : undefined;
  }, [supported, unsupportedReason]);

  const disaAktarEtiketi = exportLabel ?? (onExport ? DISA_AKTAR : undefined);
  const siralamaVar = Boolean(sortOptions && sortOptions.length > 0);
  const kayitliVar = Boolean(savedViews && savedViews.length > 0) && !dar;

  const siralamaSec = (key: string) => {
    const secenek = sortOptions?.find(option => option.key === key);
    if (secenek) onSort?.(secenek);
  };
  const gorunumSec = (id: string) => savedViews?.find(view => view.id === id)?.onSelect();
  const tumunuTemizle = () => activeFilters.forEach((filter: ActiveFilter) => filter.onRemove());

  const arama = (
    <TextField
      label={ARA}
      icon="search"
      type="search"
      inputMode="search"
      value={search}
      onChange={onSearchChange}
      placeholder={dar ? ARA_IPUCU_DAR : ARA_IPUCU_GENIS}
      autoComplete="off"
      className="aile-sorgu-ara"
    />
  );
  const siralama = siralamaVar && (
    <Select
      label={SIRALAMA}
      icon="sort"
      hideLabel={dar}
      options={sortOptions!.map(option => ({ value: option.key, label: option.label }))}
      value={sort?.key}
      onChange={siralamaSec}
      className="aile-sorgu-secim"
    />
  );
  const modSecimi = <Tabs variant="segment" label={GORUNUM_MODU} items={modlar} activeKey={mode} note={not} onChange={key => onModeChange(key as ViewMode)} />;
  const sonuc = <p role="status" className="aile-sorgu-sonuc aile-kucuk aile-ikincil">{sayi.format(resultCount)} sonuç</p>;
  const etkin = activeFilters.length > 0 && (
    <div className="aile-sorgu-etkin">
      <span className="aile-sorgu-etkin-etiket aile-kucuk aile-ikincil">{ETKIN_FILTRELER}</span>
      {activeFilters.map(filter => (
        <Tag key={filter.id} removable label={filter.label} onRemove={filter.onRemove}>{filter.label}</Tag>
      ))}
      <Button variant="quiet" onClick={tumunuTemizle}>{TUMUNU_TEMIZLE}</Button>
    </div>
  );

  if (dar) {
    return (
      <div role="search" aria-label={SORGU} className={cx('aile-sorgu', 'aile-sorgu--dar')}>
        {arama}
        <div className="aile-sorgu-satir">
          <Button variant="secondary" icon="filter" onClick={onOpenFilters} aria-haspopup="dialog">
            {`Filtreler (${sayi.format(activeFilters.length)})`}
          </Button>
          {siralama}
          {disaAktarEtiketi && <IconButton icon="download" label={disaAktarEtiketi} variant="secondary" onClick={onExport} />}
        </div>
        {modSecimi}
        {sonuc}
        {etkin}
      </div>
    );
  }

  return (
    <div role="search" aria-label={SORGU} className="aile-sorgu">
      <div className="aile-sorgu-satir">
        {arama}
        {kayitliVar && (
          <Select
            label={KAYITLI_GORUNUM}
            options={savedViews!.map(view => ({ value: view.id, label: view.label }))}
            value={savedViews!.find(view => view.active)?.id}
            onChange={gorunumSec}
            className="aile-sorgu-secim"
          />
        )}
        {siralama}
        {disaAktarEtiketi && <Button variant="secondary" icon="download" onClick={onExport}>{disaAktarEtiketi}</Button>}
      </div>
      <div className="aile-sorgu-satir aile-sorgu-satir--mod">
        {modSecimi}
        {sonuc}
      </div>
      {etkin}
    </div>
  );
}
