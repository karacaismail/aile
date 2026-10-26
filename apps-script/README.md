# Apps Script bağlantısı (Google Sheets ↔ uygulama)

Uygulama veriyi Google Sheets'teki iki sekmede tutar: `app_kalemler` ve `app_ayarlar` (tablo: "Aile bütçesi - 2027 - v0").
`Code.js` tabloya bağlı (container-bound) bir Apps Script web uygulamasıdır; yalnız bu iki sekmeyi okur/yazar.

## Kurulum (bir kez, ~10 dakika)

1. **Apps Script API'yi açın:** https://script.google.com/home/usersettings → "Google Apps Script API" → Açık.
2. **Oturum açın** (tarayıcı açılır, Google hesabınızla onaylarsınız):

   ```bash
   pnpm exec clasp login
   ```

3. **Script oluşturulur ve kod gönderilir** (komut):

   ```bash
   scripts/gas-setup.sh create
   ```

4. **Yetki verin:** `pnpm exec clasp open-script` ile editör açılır → fonksiyon listesinden `setup` → Çalıştır → "İzinleri incele" → hesabınızı seçip izin verin.
   Günlükte `setup tamam` görünür; tabloda `app_kalemler` ve `app_ayarlar` sekmeleri oluşur, `onEditInstallable` tetikleyicisi kurulur.
5. **Dağıtın:** `scripts/gas-setup.sh deploy` → çıktıdaki `deploymentId` ile adres: `https://script.google.com/macros/s/<deploymentId>/exec`.
   Dağıtım ayarları manifestten gelir: Yürüten "Ben", Erişim "Herkes".
6. **Adresi uygulamaya verin:** repo değişkeni `gh variable set VITE_API_URL --body "<exec adresi>"` (Pages yeniden derlenir) ya da uygulamada Ayarlar → "API adresi".
7. **Tohumlama:** `node scripts/seed.ts --csv "<Eşya CSV dosyası>" --url "<exec adresi>"` (önce `--dry` ile doğrulama).

Doğrulama: `curl -L "<exec adresi>?action=health"` → `{"ok":true,"app":"aile",...}`, `warnings` boş.

## Alternatif: yapıştırarak (clasp olmadan)

Tablo → Uzantılar → Apps Script → `Code.gs` içeriğini `apps-script/Code.js` ile, `appsscript.json`'ı (Proje Ayarları → manifesti göster)
`apps-script/appsscript.json` ile değiştirin → `setup` → Çalıştır → izin → Dağıt → Yeni dağıtım → Web uygulaması → Ben / Herkes.

## Güncelleme

Kod değişince `scripts/gas-setup.sh push` ve `scripts/gas-setup.sh deploy` (aynı deploymentId → adres değişmez).

## Güvenlik notu

Proje Ayarları → Script Properties → `APP_KEY` eklerseniz uygulama Ayarlar'da aynı anahtarı ister; anahtarsız istekler reddedilir.
Anahtar yoksa adresi bilen herkes okuyup yazabilir (aile içi kullanım için kabul edilebilir). Diğer sekmeler (bütçe, maaş) API'den asla dönmez.
