import { useState } from 'react';
import gallery from './gallery.json';
type Model = keyof typeof gallery;
const views = { front: 'Ön görünüm', rear: 'Arka görünüm', interior: 'İç mekân' } as const;
export default function VehicleGallery({ model, name }: { model: Model; name: string }) {
  const [view,setView]=useState<keyof typeof views>('front');
  const [failed,setFailed]=useState(false);
  const photo=gallery[model][view];
  return <figure className="vehicle-photo">
    <div className="view-nav" role="group" aria-label={`${name} fotoğraf açısı`}>
      {(Object.entries(views) as [keyof typeof views,string][]).map(([key,label])=><button type="button" key={key} aria-pressed={view===key} onClick={()=>{setView(key);setFailed(false);}}>{label}</button>)}
    </div>
    {!photo?<p role="status" className="photo-unavailable">Bu modelin doğru nesline ait lisanslı iç mekân fotoğrafı henüz doğrulanmadı.</p>:failed?<p role="status">Fotoğraf yüklenemedi. Kaynak bağlantısından açabilirsiniz.</p>:<img key={photo.src} src={`${import.meta.env.BASE_URL}${photo.src}`} alt={`${name} · ${views[view]}`} width="640" height="400" decoding="async" onError={()=>setFailed(true)}/>}
    <figcaption>{photo&&<><p>{photo.note}</p><p>{photo.title}</p><a href={photo.source} target="_blank" rel="noreferrer">{photo.author} · Özgün fotoğraf</a> · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></>}</figcaption>
  </figure>;
}
