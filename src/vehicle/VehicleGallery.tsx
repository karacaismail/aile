import { useState } from 'react';
import { Disclosure } from './Disclosure';
import { money } from '../dashboard/data';
import { type PhotoView, type VehicleGeneration } from './generations';

const views = { front: 'Ön görünüm', rear: 'Arka görünüm', interior: 'İç mekân' } as const;
export default function VehicleGallery({ name, year, price, generation, ambiguous }: {
  name: string; year: number; price: number; generation: VehicleGeneration | null; ambiguous: boolean;
}) {
  const [view, setView] = useState<PhotoView>('front');
  // Track the failed resource, not the whole gallery: year/angle changes can recover.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const photo = generation?.photos[view];
  return <figure className="vehicle-photo">
    <div className="vehicle-identity"><div><h2>{name}</h2><span>{year} · Seçili model yılı</span></div><strong>{money(price)}</strong></div>
    <p className="generation-label" data-testid="vehicle-generation" aria-live="polite">{generation?.label ?? (ambiguous ? 'Geçiş yılı · Kasa seçimi gerekli' : 'Bu yılın kasası henüz doğrulanmadı')}</p>
    {!generation ? <p role="status" className="photo-unavailable">{ambiguous ? 'Bu model yılında birden fazla kasa bulunuyor. Araç ayarlarından kasayı seçin.' : 'Başka bir yılın veya pazarın fotoğrafını göstermiyoruz.'}</p>
      : !photo ? <p role="status" className="photo-unavailable">{generation.label} için {views[view].toLocaleLowerCase('tr-TR')} fotoğrafı henüz doğrulanmadı.</p>
      : failedSrc === photo.src ? <div className="photo-unavailable"><p role="status">Fotoğraf yüklenemedi.</p><button type="button" className="text-button" onClick={() => setFailedSrc(null)}>Fotoğrafı yeniden yükle</button></div>
      : <img key={photo.src} src={`${import.meta.env.BASE_URL}${photo.src}`} alt={`${name} · ${views[view]}`} aria-describedby="vehicle-photo-description" width="640" height="400" loading="lazy" decoding="async" onError={() => setFailedSrc(photo.src)} />}
    <div className="view-nav" role="group" aria-label={`${name} fotoğraf açısı`}>
      {(Object.entries(views) as [PhotoView, string][]).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
    </div>
    <figcaption>
      <p className="photo-note" id="vehicle-photo-description">{generation ? `${generation.label} · Renk, jant ve donanım farklı olabilir.` : 'Fotoğraflar model yılına ve kasaya göre eşleştirilir.'}</p>
      {generation && <Disclosure label="Fotoğraf bilgisi ve kasa kaynakları">
        <p>Türkiye’deki kasa tipi esas alınır. Fotoğraf belirli bir satılık araca ait değildir. İlan fiyat göstergesi kasa veya donanım bazında ayrıştırılmış değildir.</p>
        {photo && <><p>{photo.title}</p><p><a href={photo.source} target="_blank" rel="noreferrer">{photo.author} · Özgün fotoğraf</a> · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></p></>}
        {generation.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}
      </Disclosure>}
    </figcaption>
  </figure>;
}
