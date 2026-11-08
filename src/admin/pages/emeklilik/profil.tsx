import { useId, type ChangeEvent } from 'react';
import type { ProfilGorunumu } from '../../emeklilik/viewmodel';
import { Button } from '../../ui/Button';
import { StatusText } from '../../ui/StatusText';

// Profil parçaları: dosya içe aktarma (üretimde varsayılan kaynak yoktur; profil yalnız bu sekmenin belleğinde tutulur)
// ve başlık bağlamındaki profil satırı (sentetik/kişisel, kayıt günü, kaynak; eski kayıt "Eski veri" adıyla).
// Dosya seçici yerel <input type="file">; görünür etiket düğme biçimindedir ve girdiyi sarar (etiket = erişilebilir ad).
// Odak çizgisi admin.css [data-focus-line] (:has(:focus-visible)); halka yok.

export type ProfilKaynakAdi = 'gelistirme' | 'dosya' | 'sentetik';

export const KAYNAK_ADI: Readonly<Record<ProfilKaynakAdi, string>> = {
  gelistirme: 'Geliştirme dosyası',
  dosya: 'İçe aktarılan dosya',
  sentetik: 'Sentetik örnek',
};

export const BELLEK_NOTU = 'Dosya yalnız bu sekmenin belleğinde tutulur; hiçbir yere gönderilmez ve kaydedilmez.';

export function ProfilIceAktar({ etiket = 'Profil dosyasını içe aktar', onDosya }: { etiket?: string; onDosya(dosya: File): void }) {
  const id = useId();
  const sec = (event: ChangeEvent<HTMLInputElement>) => {
    const dosya = event.target.files?.[0];
    // Aynı dosya yeniden seçilebilsin: değer temizlenir (dosya yalnız belleğe okunur).
    event.target.value = '';
    if (dosya) onDosya(dosya);
  };
  return (
    <div className="aile-em-ice-aktar">
      <label className="aile-em-ice-aktar__dugme" data-focus-line="">
        <input type="file" accept="application/json,.json" className="aile-em-ice-aktar__girdi" aria-describedby={`${id}-not`} onChange={sec} />
        <span>{etiket}</span>
      </label>
      <p id={`${id}-not`} className="aile-kucuk aile-ikincil">{BELLEK_NOTU}</p>
    </div>
  );
}

/** Başlık bağlamındaki kısa profil satırı: sentetik/kişisel · kayıt günü · kaynak; eski kayıt "Eski veri" adıyla. */
export function ProfilSatiri({ profil, kaynak }: { profil: ProfilGorunumu; kaynak: ProfilKaynakAdi }) {
  return (
    <div className="aile-em-profil">
      {/* Sayfanın tek tazelik satırı (başlık sözleşmesi: başlıkta role=status bir satır): profilin kaydı ve kaynağı. */}
      <p role="status" aria-live="polite" className="aile-kucuk aile-ikincil">{`${profil.etiket} · ${profil.kayit} · ${KAYNAK_ADI[kaynak]}`}</p>
      {profil.tazelik.durum === 'eski' ? <p className="aile-kucuk"><StatusText label={profil.tazelik.metin} tone="uyari" /></p> : null}
    </div>
  );
}

/** Sayfanın sonundaki profil eylemleri: başka dosya içe aktar; içe aktarılan dosyayı bellekten kaldır. */
export function ProfilEylemleri({ kaynak, onKaldir, onDosya }: { kaynak: ProfilKaynakAdi; onKaldir(): void; onDosya(dosya: File): void }) {
  const id = useId();
  return (
    <section className="aile-em-bolum aile-em-profil-eylem" aria-labelledby={id}>
      <h2 id={id} className="aile-em-bolum__baslik">Profil</h2>
      <div className="aile-em-profil__eylemler">
        <ProfilIceAktar etiket="Başka profil içe aktar" onDosya={onDosya} />
        {kaynak === 'dosya' ? <Button variant="quiet" onClick={() => onKaldir()}>Profili kaldır</Button> : null}
      </div>
    </section>
  );
}
