# Finansman veri sözleşmesi

`#/finansman` native Google Sheets `Finansman` sekmesindeki sürümlenmiş ödeme kapasitesi hesabını gösterir. Bu salt okunur görünüm kredi onayı, banka ekstresi veya gerçekleşmiş ödeme değildir. Kaynak girdi değiştiğinde eski tutarları göstermeyi sürdürmez; hesabın yeniden üretilmesi gerekir. Tarife, geçmiş tahakkuk ve gelecekteki gelir koşulları kaynak metniyle görünür kalır.

## Okuma ve doğrulama

`finance-v1`: önce A1:A9 metadata tamamlanıp doğrulanır; sonra A11:I37 aylık ve A43:R6000 günlük aralıklar ayrı tipli isteklerle paralel okunur. Son olarak metadata yeniden okunur: dört istek, üç ağ fazı. İlk metadata tutarlarla paralel başlatılmaz; aksi halde daha erken gelen eski tutar ile yeni üretimin ilk kontrolü aynı okuma olarak kabul edilebilir. Günlük sorgu `select * where R is not null` ile yalnız kayıt kimliği olan satırları alır; günlük bloğun altındaki maliyet dökümü olaya dönüşmez. Eksik veya fazla olay, metadata kayıt sayısı doğrulamasında reddedilir. Metadata ikinci kez okunup güncellik, sürüm, kayıt sayısı, kaynak hash ve kapsam açıklamaları aynı kaldığında veriler yayınlanır. Karışık sütun tiplerini GViz'in sessizce null yapmaması için bloklar birleştirilmez. Boş tutar sıfır değildir.

Her günlük satırın tarihi ve kimliği, kart anapara/maliyet toplamı, gelecek taksit sınırı, harcanabilir nakit/net bakiye/KMH ilişkisi, nakit değişim zinciri ve aylık son değerler kontrol edilir. Sayısal tolerans 0,000001 TL; bir kuruş sapma reddedilir. Gelecek taksit kart anaparasına dahildir, tekrar borca eklenmez. Kaynak koşulu değişirse bütün tutarlar kaldırılır.

Günlük ve aylık görünümler aynı doğrulanmış veriyi kullanır. Dönem ve görünüm seçimi sayfa içi kontroldür; aile menüsündeki bağlantı sayfalar arası gezinmedir. Tablolar kendi kapsayıcılarında kayar. Ortak Select, odak ve hareket tokenları korunur. Yükleme iskeleti sahte tarih veya tutar göstermez.

Finans verisi localStorage, IndexedDB veya service worker önbelleğine yazılmaz. `FinancePage` diğer rotalarda indirilmez; bütçe feed'i bu rotada başlatılmaz. Açık görünüm dakikada bir güncellik kontrolü yapar. Sheet'teki finans motorunun yeniden hesaplanması ile web'in kaynağı yeniden okuması farklı işlemlerdir.

## Kalıcı kapılar

`pnpm exec vitest run src/finance`, `pnpm typecheck`, `pnpm build`.

Üretim tarayıcı kapısı: sentetik Sheet kimliğiyle build ardından `pnpm exec playwright test --config playwright.finansman.config.ts`. Deploy iş akışı bunu gerçek üretim build'inden önce çalıştırır. Chromium, Firefox ve WebKit 320 px, büyütülmüş metin, klavye, tablo kaydırma, yükleme/yenileme/eski kaynak durumlarını kapsar. Service worker ağ izolasyonu Chromium/Firefox'ta çalışır; WebKit'in istek yakalama sınırı nedeniyle o tek katman `not_run` olarak işaretlidir. Gerçek Safari veya fiziksel cihaz testi yerine sayılmaz. Gerçek finans verileri fixture veya public depoya konmaz.
