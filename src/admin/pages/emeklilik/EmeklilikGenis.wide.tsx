import {
  BilesimlerBolumu, IhyaBolumu, OneriBolumu, PaylarBolumu, SecimlerBolumu, SonucBolumu, VarsayimlarBolumu, type EmeklilikSunumProps,
} from './parcalar';
import './EmeklilikGenis.wide.css';

// Geniş sunum (tablet/masaüstü; lazyWide 'emeklilik-genis', telefonda indirilmez). İki sütun: solda öneri, seçimler,
// paylar, varsayımlar ve ihya; sağda yapışkan sonuç (ayrıntı paneli genişliği). Sekiz bileşim altta tam genişlikte tablo.
// Alan dar kalırsa (kapsayıcı sorgusu) sütunlar alt alta iner. Aynı ViewModel ve aynı parçalar; hesap yok.
export default function EmeklilikGenis({ ekran, komutlar }: EmeklilikSunumProps) {
  return (
    <div className="aile-em-genis" data-emeklilik-yerlesim="genis">
      <div className="aile-em-genis__izgara">
        <div className="aile-em-genis__sol">
          {ekran.oneri ? <OneriBolumu oneri={ekran.oneri} komutlar={komutlar} /> : null}
          <SecimlerBolumu ekran={ekran} komutlar={komutlar} />
          {ekran.paylar.length ? <PaylarBolumu paylar={ekran.paylar} /> : null}
          {ekran.form ? <VarsayimlarBolumu form={ekran.form} komutlar={komutlar} /> : null}
          <IhyaBolumu ihya={ekran.ihya} komutlar={komutlar} />
        </div>
        <div className="aile-em-genis__sag" data-yapiskan="">
          {ekran.sonuc ? <SonucBolumu sonuc={ekran.sonuc} hataOzeti={ekran.form?.hataOzeti ?? null} /> : null}
        </div>
      </div>
      {ekran.bilesimler.length ? <BilesimlerBolumu ekran={ekran} komutlar={komutlar} /> : null}
    </div>
  );
}
