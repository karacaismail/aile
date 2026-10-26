# Apps Script bağlantısı (Google Sheets ↔ uygulama)

Uygulama veriyi Google Sheets'teki iki sekmede tutar: `app_kalemler` ve `app_ayarlar`.
Bu klasördeki `Code.js` tabloya bağlı (container-bound) bir Apps Script web uygulamasıdır.
Yalnız bu iki sekmeyi okur/yazar; tablodaki diğer sekmelere dokunmaz.

## A) clasp ile (önerilen; bir kez oturum açarsınız, sonrası komutla)

1. Apps Script API'yi açın: https://script.google.com/home/usersettings → "Google Apps Script API" → Açık.
2. Bu klasörde terminalde oturum açın (tarayıcı açılır, Google hesabınızla onaylarsınız):

   ```bash
   pnpm exec clasp login
   ```

3. Tabloya bağlı script oluşturulur, kod gönderilir, kurulum çalıştırılır ve web uygulaması dağıtılır
   (bu adımlar komutla yapılır; ilk `setup` çalıştırmasında bir kez daha yetki onayı istenir).

## B) Yapıştırarak (clasp olmadan)

1. Google Sheets'te tabloyu açın → Uzantılar → Apps Script.
2. `Code.gs` içeriğini silip `apps-script/Code.js` dosyasının içeriğini yapıştırın; `appsscript.json`
   (Proje Ayarları → "appsscript.json" dosyasını göster) içeriğini `apps-script/appsscript.json` ile değiştirin.
3. Fonksiyon listesinden `setup` seçip Çalıştır → izin verin. Günlükte "setup tamam" görünmeli.
4. Dağıt → Yeni dağıtım → Tür: Web uygulaması → Yürüten: Ben → Erişim: Herkes → Dağıt.
5. `/exec` ile biten URL'yi kopyalayın; uygulamada Ayarlar → "API adresi" alanına yapıştırın
   (ya da repoya `VITE_API_URL` değişkeni olarak ekleyin).

## Doğrulama

```bash
curl -L "https://script.google.com/macros/s/.../exec?action=health"
```

`{"ok":true,"app":"aile",...}` dönmeli. `warnings` boş olmalı.

## Güvenlik notu

Opsiyonel: Proje Ayarları → Script Properties → `APP_KEY` eklerseniz uygulama Ayarlar'da aynı anahtarı ister;
anahtarsız istekler reddedilir. Anahtar yoksa adres bilen herkes okuyup yazabilir (aile içi kullanım için kabul edilebilir).
