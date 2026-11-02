import {
  BilesimlerBolumu, IhyaBolumu, OneriBolumu, PaylarBolumu, SecimlerBolumu, SonucBolumu, VarsayimlarBolumu, type EmeklilikSunumProps,
} from './parcalar';
import './EmeklilikGenis.wide.css';

// Geniş sunum (tablet/masaüstü; lazyWide 'emeklilik-genis', telefonda indirilmez). Bölümler tek ızgaranın doğrudan
// çocuklarıdır ve belge (okuma, odak) sırası dar sıradır: öneri → seçimler → sonuç → paylar → varsayımlar → ihya. Izgara
// alanları dar kapsayıcıda bu sırayı tek sütunda korur (sonuç sayfanın sonuna düşmez); alan yetince sonuç sağda ayrıntı
// paneli genişliğinde yapışkan sütuna geçer. Sekiz bileşim altta tam genişlikte tablo. Aynı ViewModel ve parçalar; hesap
// yok. Hesap hatasında tutarlı bölümler (öneri, sonuç, paylar) anlık görüntüde yoktur; yerleri boş kalır, kardeşler yeniden
// kurulmaz.
export default function EmeklilikGenis({ ekran, komutlar }: EmeklilikSunumProps) {
  return (
    <div className="aile-em-genis" data-emeklilik-yerlesim="genis">
      <div className="aile-em-genis__izgara">
        {ekran.oneri ? <OneriBolumu oneri={ekran.oneri} komutlar={komutlar} /> : null}
        <SecimlerBolumu ekran={ekran} komutlar={komutlar} />
        {ekran.sonuc ? (
          <div className="aile-em-genis__sag" data-yapiskan="">
            <SonucBolumu sonuc={ekran.sonuc} hataOzeti={ekran.form?.hataOzeti ?? null} />
          </div>
        ) : null}
        {ekran.paylar.length ? <PaylarBolumu paylar={ekran.paylar} /> : null}
        {ekran.form ? <VarsayimlarBolumu form={ekran.form} komutlar={komutlar} sifirla={ekran.hesap.durum !== 'hata'} /> : null}
        <IhyaBolumu ihya={ekran.ihya} komutlar={komutlar} />
      </div>
      {ekran.bilesimler.length ? <BilesimlerBolumu ekran={ekran} komutlar={komutlar} /> : null}
    </div>
  );
}
