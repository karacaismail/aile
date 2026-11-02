import {
  BilesimlerBolumu, IhyaBolumu, OneriBolumu, PaylarBolumu, SecimlerBolumu, SonucBolumu, VarsayimlarBolumu, type EmeklilikSunumProps,
} from './parcalar';

// Telefon temel sunumu (320 px önce): tek sütun, sıra öneri → seçimler → sonuç → paylar → sekiz bileşim (akordeon) →
// varsayımlar (Disclosure) → ihya karşılaştırması. Geniş sunum yüklenirken ya da yüklenemezse de bu kullanılır.
// Yerel HTML; antd, ECharts ve *.wide modülü yok.
export function EmeklilikTelefon({ ekran, komutlar }: EmeklilikSunumProps) {
  return (
    <div className="aile-em-telefon" data-emeklilik-yerlesim="telefon">
      {ekran.oneri ? <OneriBolumu oneri={ekran.oneri} komutlar={komutlar} /> : null}
      <SecimlerBolumu ekran={ekran} komutlar={komutlar} />
      {ekran.sonuc ? <SonucBolumu sonuc={ekran.sonuc} hataOzeti={ekran.form?.hataOzeti ?? null} /> : null}
      {ekran.paylar.length ? <PaylarBolumu paylar={ekran.paylar} /> : null}
      {ekran.bilesimler.length ? <BilesimlerBolumu ekran={ekran} komutlar={komutlar} /> : null}
      {ekran.form ? <VarsayimlarBolumu form={ekran.form} komutlar={komutlar} /> : null}
      <IhyaBolumu ihya={ekran.ihya} komutlar={komutlar} />
    </div>
  );
}
