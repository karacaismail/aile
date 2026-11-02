import { lazyWide } from '../../adaptive';
import type { AlimlarGenisProps } from './AlimlarGenis.wide';
import type { AlimlarPivotTabloProps } from './AlimlarPivot.wide';

// Alımlar'ın geniş-özel (tablet/masaüstü) modülleri. Telefon profilinde hiç indirilmez; geniş profilde açık import()
// ile yüklenir (adaptive/loader). Anahtarlar wideManifest()'te görünür (ağ ve birim testi kanıtı).
//  - alimlar-genis: masaüstü yerleşimi (solda filtre paneli 272 / şerit 56, sağda ayrıntı 384, geniş liste başlığı).
//  - alimlar-pivot: oda × durum pivot tablosu (telefonda PivotStack akordeonu kalır).

export const AlimlarGenis = lazyWide<AlimlarGenisProps>('alimlar-genis', () => import('./AlimlarGenis.wide'));
export const AlimlarPivotTablo = lazyWide<AlimlarPivotTabloProps>('alimlar-pivot', () => import('./AlimlarPivot.wide'));
