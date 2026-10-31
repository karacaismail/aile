# Timeline

`#/timeline` ve `#/finansman` aynı doğrulanmış `FinanceLedger` ve `financeStore` kullanır. Ana ödeme akışı `Finansman` sekmesinden okunur. Web ödeme yapmaz, e-tabloya yazmaz ve yeni finansman stratejisi hesaplamaz. Türler, tarihler ve hesap koşulları kaynaktan gelir; olumlu nakit değişimi tek başına gelir sayılmaz. Birikimden aktarım gelir değildir.

## Veri ve doğrulama

`_Finans web` tipli aktarımı, kaynak/gövde SHA-256 bağı ve ikinci metadata kontrolü `FINANSMAN.md` içinde tanımlıdır. `src/finance/data.ts` bütün defteri yayınlamadan önce doğrular. Aktarım değişse de kaynak `finance-v1` modeli ve parasal kontroller korunur. Eksik tutar sıfır değildir; bir kuruş sapma reddedilir. Harcanabilir nakit, işaretli net nakit konumu, KMH anaparası/maliyeti ve kart anaparası/maliyeti ayrı anlamlardır. Gelecek taksit kart borcuna dahildir. Eski Timeline değişim/nakit çiftine bu alanlardan sahte bir dönüştürme yapılmaz.

Eski native Timeline ve `_Timeline web` ile parser testleri finans motorunun eski girdi sözleşmesini korumak için kalır; ana web görünümü bunlara geri dönmez. Eski sözleşme `TIMELINE-LEGACY.md` belgesindedir.

## Kullanıcı yolculuğu

Aile menüsü sayfalar arası gezinmedir. Dönem, filtre ve Akış/Tablo sekmeleri sayfa içi kontroldür. Koyu dönem özeti, açık zemin ve ayrı nötr adım yüzeyleri işlevleri ayırır. Her adımın tutarı, banka/KMH kırılımı, açıklaması ve kaynağı açık kalır; Ayrıntı düğmesi yoktur. Kesin olmayan tarih veya maliyet kesinmiş gibi sunulmaz. Pozitif fon eksiği kullanılabilir para değildir ve görünür uyarı verir.

Filtre yalnız görünür olayları daraltır; dönem özetini veya bakiyeleri yeniden hesaplamaz. Gelir filtresi kaynakta açıkça Gelir olan olayları seçer. Akış ve Tablo aynı sıralı, filtrelenmiş, 50 adımlık sayfayı kullanır; görünüm değişimi dönem/filtre/sayfayı korur. Tablonun okunabilir minimum sütunları vardır, yalnız kapsayıcısı kayar. Tutarlar iki ondalığa kadar korunur. 320 px, büyütülmüş metin ve klavye odağı ortak aile tokenlarıyla çalışır.

## Yükleme

Veri içermeyen HTML/rota iskeleti önce görünür. Seçili Timeline veya Finansman rotası ortak veri isteğini arayüz paketiyle paralel başlatır. Bütün defter doğrulandıktan sonra ilk 8 adım doğrudan, kalanlar requestAnimationFrame ile 16’şar gösterilir; yapay gecikme yoktur.

Doğrulanmış snapshot yalnız bellekte 60 saniyelik tazelikle tutulur. İki rota arasında sıcak geçiş tekrar istek üretmez. İlk okuma tipli gövde + metadata → içerik hash/defter kontrolü → son metadata kontrolü şeklinde iki ağ fazında ve iki istekle yapılır; manuel Yenile yeni tutarlı okuma başlatır. Google yanıt süresi dış bağımlılıktır; bu azaltma sabit bir yüklenme süresi garantisi vermez. Son abone/rota bekleyicisi ayrılmadan istek iptal edilmez. Kaynak geçersizleşirse veya kontrol başarısızsa tutarlar kaldırılır; eski finans sonucuna fallback yapılmaz. Finans verisi kalıcı depoya veya service worker önbelleğine yazılmaz.

## Doğrulama

- `pnpm exec vitest run src/finance src/timeline`
- `pnpm exec playwright test --config playwright.dashboard.config.ts e2e/timeline-dashboard.spec.ts`
- Üretim build ardından `pnpm exec playwright test --config playwright.timeline-production.config.ts`
- Sentetik üretim build ardından `pnpm exec playwright test --config playwright.finansman.config.ts`
- `pnpm typecheck`, `pnpm test`, `pnpm build`

Kapılar kaynak tutarlılığı, aynı bakiyenin iki sunumu, sıcak rota paylaşımı, eski kaynakta tutarların kaldırılması, hareket/odak, 320–1440 px, büyütülmüş metin ve tablo kaydırmasını kapsar. Fiziksel Safari/iOS/Android testi ile Playwright motor emülasyonu ayrı raporlanır. Gerçek finans verisi public fixture’a konmaz.

`/aile/timeline`, `/aile/timeline/` ve `/aile/timeline/index.html` girişleri `/aile/#/timeline` adresine döner; eski `#/pano` parçası bu girişte rota seçimini değiştirmez.

## Taşınma alımları

Alışveriş filtresindeki Tüm alımlar / Taşınma öncesi / Taşınma sonrası grubu,
`Arızi Giderler` C kategorisi ile P sabit kimliğinden üretilir. Motorun
`candidate-{kimlik}` ve `{kimlik}-{parça}` nakit/kart alımları aynı eşlemeyi kullanır.
`finance-sync/purchase-groups.mjs`, günlük defterin Tür alanına `Alışveriş`,
`Alışveriş · Taşınma öncesi` veya `Alışveriş · Taşınma sonrası` yayınlar.
Bu alan mevcut SHA-256 aktarım kapsamındadır; kategori hücreleri de native
kaynak korumasına dahildir. Kategori tarihten, başlıktan veya banka adından türetilmez.
Diğer kategoriler yalnız Tüm alımlar içinde kalır; fatura ve kart geri ödemeleri
alım gruplarına girmez. Öncesi kategorisindeki ileri tarihli alım kendi tarihinde kalır.

Tarihler planlanan alım tarihidir; teslimat/gerçekleşme kanıtı değildir. Takvime henüz
alınamayan kayıt için sahte tarih veya adım üretilmez. Ay seçimi korunur;
Tüm dönemde göster mevcut alım grubunu ve Akış/Tablo görünümünü koruyarak bütün
kronolojiyi açar. Filtreler parasal hesap yapmaz. Ek veri isteği yoktur.
Dar ekranda üç grup seçeneği sarılarak görünür kalır. Boş durum seçili grubu adlandırır.
`purchase groups` tarayıcı testi bu yolu ve iki finans isteği sınırını denetler.

## Alım kartı bilgileri

Alım kartında sıralama: eşya adı → planlanan alım tutarı, tarihi, ödeme yöntemi →
kasaya/karta etkisi → aynı kartta adım sonrası nakit ve toplam kart borcu →
banka bazında eşlenmiş anapara ve faiz/vergi → kaynak ve koşullar.
İç içe ikinci bir hesap kutusu yoktur; bütün açıklamalar açık kalır.
Akış ve Tablo aynı `PurchaseSummary` bileşenini kullanır. Planlanan tarih,
gerçekleşme veya teslim tarihi olarak etiketlenmez. Gelecek taksit alanı açıkça
iki kartın bütün taksitli alımlarının toplamıdır; ürüne ait taksit tutarı değildir.

`purchase.ts`, doğrulanmış tam defterde birbirini izleyen kayıtları karşılaştırır.
Native motor tek alım olayında alım bedelinin tamamını seçili kartın anaparasına
ekler; faiz/vergi ayrı alandadır. Kart alım bedeli yalnız bu anapara farkıdır;
nakit alımda bedel negatif nakit hareketinin mutlak değeridir. Kaynak alanının
`Kredi kartı · {banka}` veya `Nakit · Nakit` etiketiyle hareketin uyuşması gerekir.
Taksit sayısı yalnız kaynakta açık `Taksit: N` alanı varsa gösterilir. Yöntem,
karşılaştırma veya tek işlem hareketi belirsizse bedel sıfır diye gösterilmez.
Karşılaştırma filtrelenmiş görünümdeki önceki kartla yapılmaz; tam defterdeki
hemen önceki olay kullanılır. Hesaplar, şema, Sheet formülleri ve iki istekli
SHA doğrulaması değişmez; ek okuma ve finansman hesabı yapılmaz.

Regresyon: `purchase.test.ts`, `TimelinePage.test.tsx` ve `purchase cards answer`
E2E; kuruş, nakit/kart ayrımı, yanlış banka, karışık hareket, eksik bilgi,
filtreleme, iki görünümde eşit içerik, 320–1440 px ve metin büyütme.

Haftalık etüt: native `week-N-etut-N` kimliği, nakit hareketi ve açık cuma
kaynağı birlikte bulunursa kartta “Elden nakit · Her cuma akşamı” gösterilir.
Ödeme tutarı defterdeki nakit çıkışıdır. Yeni KMH kullanımı, önceki tam defter
kaydıyla anapara artışı kadardır; mevcut borç veya eksi nakit etiketi yeni kaynak
sayılmaz. Her zaman görünen hesap bakiyeleri ve koşullu plan niteliği korunur.
