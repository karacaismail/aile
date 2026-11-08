import { useState } from 'react';
import { Disclosure } from './Disclosure';
import { money } from '../dashboard/data';
import { type PhotoView, type VehicleGeneration } from './generations';

const views = { front: 'Ön', rear: 'Arka', interior: 'İç' } as const;
export default function VehicleGallery({ name, year, price, generation, ambiguous }: {
  name: string; year: number; price: number; generation: VehicleGeneration | null; ambiguous: boolean;
}) {
  const [view, setView] = useState<PhotoView>('front');
  // Track the failed resource, not the whole gallery: year/angle changes can recover.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const photo = generation?.photos[view];
  return <figure className="vehicle-photo">
    <div className="vehicle-identity"><div><h2>{name}</h2><span>{year}</span></div><strong>{money(price)}</strong></div>
    <p className="generation-label" data-testid="vehicle-generation" aria-live="polite">{generation?.label ?? (ambiguous ? 'Geçiş yılı · kasa seçin' : 'Kasa bilgisi yok')}</p>
    {!generation ? <p role="status" className="photo-unavailable">{ambiguous ? 'Bu yılda birden fazla kasa var. Ayarlardan seçin.' : 'Bu yıl için fotoğraf yok.'}</p>
      : !photo ? <p role="status" className="photo-unavailable">Bu açı için fotoğraf yok.</p>
      : failedSrc === photo.src ? <div className="photo-unavailable"><p role="status">Fotoğraf yüklenemedi.</p><button type="button" className="text-button" onClick={() => setFailedSrc(null)}>Yeniden dene</button></div>
      : <img key={photo.src} src={`${import.meta.env.BASE_URL}${photo.src}`} alt={`${name} · ${views[view]}`} width="640" height="400" loading="lazy" decoding="async" onError={() => setFailedSrc(photo.src)} />}
    <div className="view-nav" role="group" aria-label="Fotoğraf açısı">
      {(Object.entries(views) as [PhotoView, string][]).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
    </div>
    {generation && <figcaption>
      <Disclosure label="Fotoğraf kaynağı">
        {photo && <p>{photo.title}</p>}
        {photo && <p><a href={photo.source} target="_blank" rel="noreferrer">{photo.author}</a> · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></p>}
        {generation.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}
      </Disclosure>
    </figcaption>}
  </figure>;
}
