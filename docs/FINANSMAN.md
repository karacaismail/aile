# Finansman veri sözleşmesi

`#/finansman` native Google Sheets `Finansman` sekmesindeki sürümlenmiş ödeme kapasitesi hesabını gösterir. Bu salt okunur görünüm kredi onayı, banka ekstresi veya gerçekleşmiş ödeme değildir. Kaynak girdi değiştiğinde eski tutarları göstermeyi sürdürmez; hesabın yeniden üretilmesi gerekir. Tarife, geçmiş tahakkuk ve gelecekteki gelir koşulları kaynak metniyle görünür kalır.

## Okuma ve doğrulama

Kaynak model `finance-v1` olarak kalır. Web, gizli `_Finans web` aktarımını `finance-wire-v1` sözleşmesiyle iki istekte ve iki ardışık ağ fazında okur: önce `A1:T6000`, sonra `A1:T11`; iki istekte de `headers=1`, `cache: no-store`, `credentials: omit` kullanılır. İlk yanıt bütün tutarları ve üretim metadata'sını taşır. SHA-256 ve defter kontrolleri tamamlanmadan son metadata isteği başlamaz; son kontrol de geçmeden hiçbir tutar yayınlanmaz. Kaynak/gövde uyuşmazlığı, eski kaynak veya desteklenmeyen güvenli hash ortamında fallback yoktur.

### Tipli aktarım

Başlıklar tam olarak `kind,index,c1,…,c18` (20 sütun) olmalıdır. Bütün veri hücreleri metindir; böylece GViz'in karışık sütun türlerinden dolayı sayı veya metni sessizce null yapması önlenir. Alanlar `s:` + özgün metin, `n:` + sonlu ondalık sayı veya yalnız dolgu için `z:` kullanır. Sayı tokenında nokta ondalık ayracıdır; gruplama, para simgesi ve üstel gösterim kabul edilmez. Eksik tutar sıfır değildir. Yerel sayı üreticisi sunum biçiminden bağımsız dokuz sabit ondalık kullanır; çözülen sayının kaynak sayıyla birebir eşitliği zorunludur. Bu hassasiyete sığmayan değer yuvarlanarak kabul edilmez. Web tutarları yuvarlamaz.

Satırlar sırasıyla: `manifest / i:0` (sürüm ve payload hash), dokuz `meta / i:0…8` (özgün `Finansman!A1:A9`), `monthly-header / i:0`, N adet `monthly / i:0…N−1`, `daily-header / i:0`, E adet `daily / i:0…E−1`. Her satır 20 hücredir, kullanılmayan hücreler `z:` olur. Aylık satırlar dokuz, günlük satırlar 18 alan taşır. N ve E metadata'daki sayılara eşit olmalı; sınırlar N≤26 ve E≤5957, toplam veri satırı `12+N+E` olmalıdır. Eksik, fazla, çift veya sırası değişmiş kayıt reddedilir. Günlük bloğun altındaki maliyet raporu aktarım gövdesine dahil değildir.

### İçerik ve kaynak bütünlüğü

Payload hash, tipli alanlar çözüldükten sonra aşağıdaki dizinin `JSON.stringify` çıktısının UTF-8 SHA-256 özetidir. Sıralama, metin normalizasyonu veya tutar yuvarlama yapılmaz; JSON sayısal `-0` değerini `0` olarak serileştirir.

```js
[
  'finance-wire-v1', 'finance-v1',
  metadata.rows.map(row => row[0]),
  monthly.labels, monthly.rows,
  daily.labels, daily.rows,
]
```

İçerik hash'i kaynak parmak izinden ayrıdır; kendisi hariç sürüm, kaynak parmak izi, guard, kayıt sayıları, durum/kapsam açıklamaları, özgün sütun başlıkları ve bütün sıralı satırlar hash kapsamındadır. Eski tutarlı gövde yeni üretim etiketiyle sunulamaz. `crypto.subtle` bulunmayan ortam açık hata verir; hashesiz veri kabul edilmez.

İkinci yanıt yalnız manifest ve dokuz metadata satırıdır. Payload hash ve bütün metadata alanları ilk yanıtla birebir aynı, guard her iki okumada `TRUE` olmalıdır. Tek GViz yanıtı veya tek Sheets formülü atomik workbook snapshot garantisi sayılmaz. Native üretim sırasında guard kapatılır, kaynak ve beklenen hash güncellenir, native kontroller tamamlanınca guard açılır. Formül yeniden hesaplanırken karışmış değerler hash veya son metadata kontrolünde reddedilir. İptal sinyali hash hesabı sırasında geldiyse sonuç yayınlanmaz.

Her günlük satırın tarihi ve kimliği, kart anapara/maliyet toplamı, gelecek taksit sınırı, harcanabilir nakit/net bakiye/KMH ilişkisi, nakit değişim zinciri ve aylık son değerler kontrol edilir. Sayısal tolerans 0,000001 TL; bir kuruş sapma reddedilir. Gelecek taksit kart anaparasına dahildir, tekrar borca eklenmez. Kaynak koşulu değişirse bütün tutarlar kaldırılır.

Günlük ve aylık görünümler aynı doğrulanmış veriyi kullanır. Dönem ve görünüm seçimi sayfa içi kontroldür; aile menüsündeki bağlantı sayfalar arası gezinmedir. Tablolar kendi kapsayıcılarında kayar. Ortak Select, odak ve hareket tokenları korunur. Yükleme iskeleti sahte tarih veya tutar göstermez.

Finans verisi localStorage, IndexedDB veya service worker önbelleğine yazılmaz. `FinancePage` diğer rotalarda indirilmez; bütçe feed'i bu rotada başlatılmaz. Açık görünüm dakikada bir güncellik kontrolü yapar. Sheet'teki finans motorunun yeniden hesaplanması ile web'in kaynağı yeniden okuması farklı işlemlerdir.

## Kalıcı kapılar

`pnpm exec vitest run src/finance`, `pnpm typecheck`, `pnpm build`.

Üretim tarayıcı kapısı: sentetik Sheet kimliğiyle build ardından `pnpm exec playwright test --config playwright.finansman.config.ts`. Deploy iş akışı bunu gerçek üretim build'inden önce çalıştırır. Chromium, Firefox ve WebKit 320 px, büyütülmüş metin, klavye, tablo kaydırma, yükleme/yenileme/eski kaynak durumlarını kapsar. Service worker ağ izolasyonu Chromium/Firefox'ta çalışır; WebKit'in istek yakalama sınırı nedeniyle o tek katman `not_run` olarak işaretlidir. Gerçek Safari veya fiziksel cihaz testi yerine sayılmaz. Gerçek finans verileri fixture veya public depoya konmaz.
