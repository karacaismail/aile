import { useState } from 'react';
import gallery from './gallery.json';
import { Disclosure } from './Disclosure';
import { money } from '../dashboard/data';
type Model = keyof typeof gallery;
const views = { front: 'Ön görünüm', rear: 'Arka görünüm', interior: 'İç mekân' } as const;
export default function VehicleGallery({ model, name, year, price }: { model: Model; name: string; year: number; price: number }) {
  const [view,setView]=useState<keyof typeof views>('front');
  const [failed,setFailed]=useState(false);
  const photo=gallery[model][view];
  return <figure className="vehicle-photo">
    <div className="vehicle-identity"><div><h2>{name}</h2><span>{year} · Seçili model yılı</span></div><strong>{money(price)}</strong></div>
    {!photo?<p role="status" className="photo-unavailable">Bu modelin doğru nesline ait lisanslı iç mekân fotoğrafı henüz doğrulanmadı.</p>:failed?<p role="status">Fotoğraf yüklenemedi. Kaynak bağlantısından açabilirsiniz.</p>:<img key={photo.src} src={`${import.meta.env.BASE_URL}${photo.src}?v=${encodeURIComponent(photo.title)}`} alt={`${name} · ${views[view]}`} width="640" height="400" loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}
    <div className="view-nav" role="group" aria-label={`${name} fotoğraf açısı`}>
      {(Object.entries(views) as [keyof typeof views,string][]).map(([key,label])=><button type="button" key={key} aria-pressed={view===key} onClick={()=>{setView(key);setFailed(false);}}>{label}</button>)}
    </div>
    <figcaption>{photo&&<><p className="photo-note">Temsili model fotoğrafı · Yıl ve paket farklı olabilir.</p><Disclosure label="Fotoğraf bilgisi ve lisans"><p>{photo.note}</p><p>{photo.title}</p><a href={photo.source} target="_blank" rel="noreferrer">{photo.author} · Özgün fotoğraf</a> · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></Disclosure></>}</figcaption>
  </figure>;
}
