import './LoadingShell.css';

// Tasarım › Loading (components/Loading/README.md): veri okunurken aynı yerleşimde iskelet + üstte tek ince şerit.
// Döner simge ya da tam sayfa örtü yok; iskelet gerçek liste satırının ölçüsündedir (fotograf-liste 56 px yuva,
// başlık + kimlik satırı, geniş yerleşimde Planlanan | Gerçekleşen yuvaları), içerik gelince yerleşim kaymaz.
// Rakam ya da yüzde gösterilmez; ekran okuyucu yalnız etiketi duyar, iskelet aria-hidden'dır. Şerit döngüsü
// LoadingShell.css'te tek eğri ile döner, prefers-reduced-motion açıkken durağandır.
// antd Skeleton/Progress kullanılmadı: antd'de belirsiz (indeterminate) çizgisel ilerleme yok ve Skeleton satır
// ölçüsünü/köşe token'ını tema dosyasına dokunmadan birebir vermiyor.

export interface LoadingShellProps {
  /** İskelet satır sayısı; pozitif değilse 3. Gelecek listenin beklenen satır sayısına yakın verin. */
  rows?: number;
  /** Dar (telefon) satır yerleşimi: fotoğraf + başlık + kimlik + durum etiketi yuvası. Çağıran `useDevice() === 'phone'` ile verir. */
  narrow?: boolean;
  /** Ekran okuyucuya duyurulan durum metni; varsayılan "Yükleniyor". Rakam içermemelidir. */
  label?: string;
}

const DEFAULT_ROWS = 3;
const DEFAULT_LABEL = 'Yükleniyor';

function rowCount(rows: number | undefined): number {
  return typeof rows === 'number' && Number.isFinite(rows) && rows >= 1 ? Math.floor(rows) : DEFAULT_ROWS;
}

function WideRow() {
  return (
    <div className="aile-loading-satir" data-part="row">
      <span className="aile-loading-foto" data-part="photo" />
      <span className="aile-loading-ana">
        <span className="aile-loading-blok aile-loading-blok--baslik" data-part="block" />
        <span className="aile-loading-blok aile-loading-blok--kimlik" data-part="block" />
      </span>
      <span className="aile-loading-blok aile-loading-blok--tutar" data-part="block" />
      <span className="aile-loading-blok aile-loading-blok--tutar" data-part="block" />
      <span className="aile-loading-ok" />
    </div>
  );
}

function NarrowRow() {
  return (
    <div className="aile-loading-satir aile-loading-satir--dar" data-part="row">
      <span className="aile-loading-foto" data-part="photo" />
      <span className="aile-loading-ana">
        <span className="aile-loading-blok aile-loading-blok--baslik-dar" data-part="block" />
        <span className="aile-loading-blok aile-loading-blok--kimlik-dar" data-part="block" />
        <span className="aile-loading-blok aile-loading-blok--etiket" data-part="block" />
      </span>
    </div>
  );
}

export function LoadingShell({ rows, narrow = false, label = DEFAULT_LABEL }: LoadingShellProps) {
  const count = rowCount(rows);
  const Row = narrow ? NarrowRow : WideRow;
  return (
    <div className="aile-loading" role="status" aria-live="polite" aria-busy="true" data-layout={narrow ? 'narrow' : 'wide'}>
      <div className="aile-loading-serit" data-part="strip" aria-hidden="true">
        <span />
      </div>
      <span className="aile-loading-etiket">{label}</span>
      <div className="aile-loading-liste" data-part="rows" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => <Row key={index} />)}
      </div>
    </div>
  );
}
