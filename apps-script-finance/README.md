# Otomatik finans hesabı

Bu, hazırlık kayıtlarının mevcut `apps-script` projesinden ayrı bir Google Apps
Script projesidir. HTTP endpoint veya anonim yazma izni yoktur. Web'deki Yenile
düğmesi doğrulanmış sonucu yeniden okur; finans hesabı Sheet tarafında çalışır.

`pnpm finance:build` düzenlenebilir modüllerden `Engine.generated.js` ve küçük
`Controller.js` giriş dosyasını üretir. Üretilmiş paket elle düzenlenmez. Saf motoru ve güvenli yayın adaptörünü V8/ES2020 için paketler.
`pnpm finance:test`, `pnpm test` ve `pnpm typecheck` yerel kapılardır. CI ve deploy
iş akışları aynı kapıları çalıştırır. Bu kapılar canlı Google kurulumunun kanıtı değildir.

Kurulum özel yapılandırma ve daha önce denetlenmiş native çıktıya karşı doğrulanan
kompakt sahiplik kaydı gerektirir. Bunlar Git'e eklenmez. `installFinance` yalnız
açık hedef kimliğine yazar ve aynı projeyi başka bütçeye sessizce taşımaz.
Google'un Sheet erişimi, tetikleyici ve dış istek yetkilendirmesi kurulum hesabında
gerekir. Manifestteki Sheets v4 bildirimi, varsayılan Cloud projesinde Sheets API’yi
açar; veri aktarımı yine REST üzerinden yapılır. Standart Cloud projesinde API
ayrıca etkinleştirilmelidir ([Google kurulum sözleşmesi](https://developers.google.com/apps-script/guides/services/advanced)).
Dış istekler yalnız sabit `sheets.googleapis.com` adresine gider; kimlik
bilgileri bellekte kalır, yönlendirmeler kapalıdır.

Edit/change tetikleyicileri kullanıcı düzenlemelerini; 15 dakikalık kontrol, API ile
gelen düzenlemeleri yakalar. API yazımları edit tetikleyicisini çalıştırmadığından
bu ikinci yol gereklidir. Apps Script zamanlama/kota koşulları nedeniyle kesin
milisaniye yenileme sözü verilmez. Aynı kaynak ve geçerli native guard yazım üretmez.

Her koşu ScriptLock altında kaynak sahipliğini kontrol eder, Plan ve Güncel modeli
yeniden hesaplar, kaynak girdilerini yazımdan hemen önce tekrar doğrular. Guard
kapanır, sonuçlar tek atomik Sheets isteğinde yazılır, tekrar okunduktan sonra guard
açılır. Native tutar, tarih, tüketici ve wire özeti doğrulanmadan nesil tamamlanmaz.
Süre aşımı veya eşzamanlı düzenleme sonraki koşu için kurtarma kaydı bırakır.

`financeStatus` kurulumun durumunu ve son hatasını yürütme günlüğünde gösterir.
Tetikleyiciler yalnız bu projenin üç finans işlevi için düzenlenir; başka işlevlerin
tetikleyicileri korunur. Test projesi canlı dosyadan ayrı tutulur.

Model saf finans kurallarıdır (`finance-engine`); controller yayın sırasını yönetir
(`finance-runner` / `gas/finance/main`). `DurableStateStore` kesintiye dayanıklı
kaydı, `FinanceSheetRepository` native okuma ve atomik yazımı kapsar. Servisler
dışarıdan verilir; testler global Google servislerine bağlı değildir. View web
uygulamasında kalır; Apps Script içine UI veya ayrı MVVM katmanı eklenmez.

REST okumaları dört sekmelik gruplarla sınırlıdır; 16 sekmeli bir snapshot için
metadata dahil beş istek yapılır. `_Kasa hesap` yalnız kur başlığından okunur;
ilgisiz üretilmiş matris yüklenmez. Düzenlenebilir kaynakların ve yazılan
çıktıların ayrılmış satır/sütun sonları korunur. Canlı süreler ayrıca ölçülmelidir.

Yazım hücre bazındadır: `planCellWrites` temizleme ve güncelleme isteklerini son
değerlerine indirger, `userEnteredValue` ile karşılaştırır ve yalnız değişen
hücreleri bitişik aralıklarda tek atomik batch'e gönderir. Hesaplanmış değer
önbelleği karşılaştırılmaz; aynı sonucu veren farklı formül hâlâ değişikliktir.
Eski satırların temizlenmesi ve kullanıcı girdisi boşlukları korunur. B2 yayın
kapısını yalnız controller açıp kapatır. Tam aday sahiplik ve readback için kalır;
az yazım, eksik hesap veya azaltılmış doğrulama anlamına gelmez.

Planner yalnız mevcut üreticinin değer yazımı, sona satır/sütun ekleme, dondurma,
birleştirme ve biçim kopyalama işlemlerini kabul eder; yeni işlem türleri test
edilmeden aktarılmaz. `gas/src/finance-cell-patch.test.ts` örtüşme, örtük temizleme,
korunan girdi, boş batch ve tekrar çalıştırma kapısıdır. `cell-write` günlüğü
istenen/karşılaştırılan/değişen hücre sayısını içerir; hücre içeriklerini içermez.
Aynı sahiplik kaydı yenilemeler boyunca birikmez: aralık, dışlanan girdiler ve
digest birlikte aynıysa tek kayıt saklanır. Farklı kanıtlar birleştirilmez.
