import { Select } from '../ui/Select';
import type { SavedView } from './contracts';

// QueryBar'ın geniş-özel parçası: "Kayıtlı görünüm" seçimi yalnız masaüstü sorgu çubuğunda çizilir (tasarım
// components/QueryBar: arama · kayıtlı görünüm · sıralama · dışa aktar). Telefon ve tablet dar düzende bu seçim yoktur;
// bu yüzden modül QueryBar.tsx'te lazyWide('querybar-kayitli-gorunum', …) ile yalnız masaüstünde yüklenir, telefon
// profili hiç indirmez (W0 *.wide kuralı: statik içe aktarılmaz, default export). Görsel ölçü QueryBar.css'teki
// .aile-sorgu-secim (220 px) sınıfındadır.

export interface KayitliGorunumProps {
  savedViews: readonly SavedView[];
}

const KAYITLI_GORUNUM = 'Kayıtlı görünüm';

export default function KayitliGorunum({ savedViews }: KayitliGorunumProps) {
  return (
    <Select
      label={KAYITLI_GORUNUM}
      options={savedViews.map(view => ({ value: view.id, label: view.label }))}
      value={savedViews.find(view => view.active)?.id}
      onChange={id => savedViews.find(view => view.id === id)?.onSelect()}
      className="aile-sorgu-secim"
    />
  );
}
