# Timeline

`#/timeline`, Google Sheets’teki `Timeline` sayfasından adım adım planlanan nakit ve kart borcunu okur. Finansal hesapların sahibi e-tablodur. Web uygulaması formüllerin sonucunu doğrular ve gösterir; ödeme göndermez, e-tabloya yazmaz, yeni bir finansman stratejisi hesaplamaz.

## Veri sözleşmesi

Hesapların kaynağı `Timeline` sekmesidir. Web, `_Timeline web!A1:Q1600` aralığındaki filtresiz formül aynasını okur. Aynanın A1 hücresi, Timeline başlığından son hesap satırına kadar doğrudan `ARRAYFORMULA` referansı taşır; finansal hesapları çoğaltmaz. Sheets bu referansı üst açıklama satırlarının eklenmesi/silinmesiyle günceller. Kullanıcının Timeline görünüm filtresi web kayıtlarını daraltamaz. Ayna sekmesine filtre eklenmez. Eksik/hatalı ayna halinde görünür sekmeye geri dönülmez; veri reddedilir. `src/timeline/contract.ts` sütunların sırasını ve başlıklarını tanımlar. Tarih ISO `YYYY-MM-DD`, dönem `YYYY-MM`; tutarlar sonlu sayıdır. Eksik değer sıfır kabul edilmez.

| Sütun | Anlam |
|---|---|
| A–F | Kalıcı kimlik, tarih, gün içi sıra, tür, adım, kaynak |
| G–I | Nakit, Denizbank borcu ve İşbank borcundaki işaretli değişim |
| J–M | Adımdan sonraki nakit, iki kart borcu ve toplam kart borcu |
| N–Q | Tarih niteliği, açıklama, mutabakat farkı, dönem |

İlk olay açık bir `Başlangıç` kaydıdır; G–I başlangıç bakiyelerini taşır. Sonraki her bakiye önceki bakiye + değişim ile uyuşmalıdır. Tarih ve gün içi sıra artar; kimlikler tekrarlanmaz. Her dönemin son olayı takvim ayının son gününde `Kontrol` / `Ay sonu kontrolü` olmalıdır. Mutabakat farkı sıfır, toplam borç iki banka borcunun toplamı olmalıdır. Yalnız sayısal hesaplamanın kayan nokta gürültüsü için en fazla 0,000001 TL fark kabul edilir; bir kuruşluk bakiye, toplam veya mutabakat farkı reddedilir. Negatif nakit saklanır ve uyarılır; negatif kart borcu geçerli model verisi sayılmaz.

Satır sonunda açık tutar, yeni düzenleme sırasında formül hatası, eksik ay sonu kontrolü veya bakiye uyuşmazlığı varsa yeni görüntü reddedilir. Son başarılı görüntü yalnız bellekte tutulur. Gerçek aile verileri kaynak koda, fixture'a, yerel kalıcı depoya veya service worker önbelleğine yazılmaz.

## Kullanım ve sınırlar

İlk dönem varsayılan seçilir; ay filtresi, önceki/sonraki ay ve tüm dönem seçenekleri vardır. Her adımda kalan nakit, toplam kart borcu ve banka kırılımı görünür. Özet seçilen dönemin başı/sonu ve en düşük plan nakdini gösterir. Bunlar plan bakiyeleridir; gerçekleşmiş ödeme kanıtı değildir. Tarihi varsayılan olaylar ayrıca işaretlenir; aynı gün maaşın geliş saati ve ödeme sırası günlük ödenebilirliği değiştirebilir.

Uzun dönemler 50 adımlık sayfalara ayrılır. Özet seçilen dönemin tamamını kapsar; sayfa değiştirmek hesap sonucunu veya adımların genel sıra numarasını değiştirmez. Dönem filtresi değişince ilk adım sayfasına dönülür. Altı/yedi haneli sentetik tutarlar 320 px ve %200 metin büyütmede, 716 adımlık / 26 aylık sentetik takvim de tüm sayfalarda test edilir. Bakiyeler metin büyüdüğünde tek sütuna geçer; sayı basamakları bölünmez.

Timeline rota seçimi, arayüz paketi yüklenirken veri isteğini paralel başlatır; eski bütçe şemasının doğrulanmasına bağımlı değildir. Doğrulanmış görüntü yalnız bellekte tutulur ve 60 saniyelik otomatik tazelik süresinde yeniden rota ziyaretinde doğrudan kullanılır. Görünürken her dakika, odağa/çevrimiçine dönüş ve Yenile kontrolü tetikler; Yenile tazelik süresini beklemez. Aynı anda tek istek paylaşılır, 20 saniyede zaman aşımına uğrar ve yalnız son abone veya rota bekleyicisi ayrıldığında iptal edilir. Timeline veri deposu ve ağır arayüz paketi yalnız rota seçildiğinde yüklenir, PWA precache listesine alınmaz. Küçük yükleme kabuğu ortak başlangıç paketindedir; finans verisi veya doğrulama kodu içermez. Google Sheets’in mevcut erişimi korunur; bu rota bir kimlik doğrulama katmanı eklemez.

## Doğrulama

- `pnpm exec vitest run src/timeline src/dashboard/useBudget.test.tsx`
- `pnpm exec playwright test --config playwright.dashboard.config.ts e2e/timeline-dashboard.spec.ts`
- `pnpm typecheck`, `pnpm test`, `pnpm build`
- Production kaynak izolasyonu: `pnpm build` ardından `pnpm exec playwright test --config playwright.timeline-production.config.ts`. Temiz Chromium bağlamında Pano ve service worker kurulumu tamamlanana kadar Timeline verisi, deposu ve `Tabs` paketi istenmemeli; Timeline açıldığında veri isteği arayüz paketini beklemeden başlamalı. Taze görüntüyle rota dönüşü yeni istek başlatmaz, Yenile bir yeni istek başlatır. Test ayrı 5177 önizlemesini kullanır, bütün Sheet yanıtları sentetiktir. Aynı kapı CI ve Pages deploy akışında build sonrası çalışır.

Regresyonlar sentetik veri kullanır: hatalı/eksik veri reddi, nakit/borç zinciri, son başarılı veriyi koruma, rota izolasyonu, görünür varsayımlar, negatif nakit, 320–1440 px yeniden yerleşme, uzun adım adı, klavye odağı, özel ay seçimi ve azaltılmış hareket. Playwright WebKit gerçek Safari/iOS cihaz testi değildir. Tarayıcı görüntüleri test kanıtıdır, otomatik onaylı piksel referansı değildir.

## Düz URL ve sayfalama

`/aile/timeline`, `/aile/timeline/` ve `/aile/timeline/index.html` statik girişleri `/aile/#/timeline` adresine döner. Eski `#/pano` parçası bu girişte Timeline seçimini değiştirmez. GitHub Pages için `public/timeline/index.html` gerçek dosya olarak derlemeye girer; sunucu rewrite kuralı gerekmez. Ay seçimi veya önceki/sonraki ay gezinmesi adım sayfasını sıfırlar. Tüm döneme geri dönmek ilk 50 adıma döner.

## Timeline görünümü

- Dönem seçimi ve başlangıç/son/en düşük nakit ile son kart borcu, tek özet alanındadır.
- Geniş görünümde tarih sütunu, işlem ve sonraki bakiyeleri hizalar. Dar görünümde aynı DOM tek akışa dönüşür; gezinme kendi içinde kayar.
- Her adım, hafif tonlu ve yuvarlatılmış ayrı bir yüzeyde yer alır. 12px iç boşluk ve adımlar arasında 12px aralık, aynı gündeki işlemleri ayırırken kompaktlığı korur.
- Her adımda nakit, toplam kart borcu ve iki kartın borcu görünür kalır. Açıklama, kaynak ve ödeme/gelir tarihleri ilk açılışta doğrudan adımın altındadır; Ayrıntı düğmesi yoktur. Açıklamalar ayrı kutu veya iç padding kullanmaz. Tarih varsayımları ve negatif nakit uyarıları korunur.
- `e2e/timeline-dashboard.spec.ts` açıklamaların etkileşim gerektirmeden görünürlüğünü, düğmenin yokluğunu, işlem/bakiye hizasını, açıklama öncesi en fazla 8px boşluğu, ay kontrollerinin klavye odağı/hareketini, yön değişiminde okunabilirliği, ilk görünüm yoğunluğunu, 320 px ve masaüstünde %200 metin büyütmeyi kontrol eder.

### Dönemden işleme ilerleme

Koyu lacivert “Dönem özeti” paneli masaüstünde sol sütundadır; açık sayfa zemini üzerindeki “Ödeme akışı” ve orta açıklıktaki işlem yüzeylerinden ayrılır. İkincil metin ve negatif bakiye için koyu yüzeye uygun merkezi renk tokenları kullanılır. Mobilde aynı içerik tek akışa geçer. Tüm adımlar / Ödemeler / Alışveriş / Gelir filtreleri kayıtları daraltır; hesap yeniden yapılmaz. Ödemeler nakit çıkışı olan adımlardır. Dönem özeti ve uyarılar tüm dönemi kapsar; filtreli listede de her bakiye kaynaktaki özgün adım sonu değeridir. Boş sonuçta dönem değiştirilebilir veya tüm adımlara dönülebilir. Kart ödemesinin ayrıntısı, plan ödeme tarihini ve o ayın gelir tarihlerini birlikte gösterir. Kesinleşmemiş gelir gününün varsayım niteliği korunur.

### Akış / tablo görünümü

Akış ve Tablo, dönem başlığının yanındaki ortak yüzeyde iki sekmedir. Kurulu Mantine `Tabs` unstyled kullanılır; ok tuşları, Home/End ve Enter/Space ile erişilebilir. Görünüm değişimi dönem, adım filtresi ve 50 adımlık sayfayı korur. Yalnız aktif sunum oluşturulur; tablo ayrı veri isteği, sıralama veya hesap üretmez. Aynı `visibleEvents` ve kaynak adım numaraları iki görünümü besler.

Tablo kronolojik sırayı, işlem etkisini, adım sonrası nakdi, iki bankanın borcunu ve toplam kart borcunu ayrı sütunlarda gösterir. Açıklama/kaynak ve kart ödemesinin gelir takvimi, akışla aynı bileşenden açık olarak gelir. Tarih/işlem/tutar/açıklama sütunlarının okunabilir minimumları merkezi tokenlardır. Dar görünümde yalnız tablo kapsayıcısı yatay kayar; klavye odağı tek alt çizgidir, sağ/sol oklar kaydırır. `e2e/timeline-dashboard.spec.ts` iki görünümün aynı bakiyeyi korumasını, filtre/dönem/sayfa sürekliliğini, 320–1440 px taşmayı, %200 metni, sekme klavyesini ve hareket tokenlarını denetler.

Görünüm sekmelerinde koyu yazı sabit kalır; açık ve orta tonlu yüzeyler ortak hareket tokenıyla geçiş yapar. Seçim kalın metinle anında belli olur, düğme genişliği değişmez. Başlangıç/son renkleriyle yetinilmez: her animasyon karesinde ve geçiş yarıda tersine çevrildiğinde en az 4,5:1 yazı kontrastı denetlenir. `Tabs` ortak paketi yalnız Timeline/araç özelliği gerektiğinde yüklenir; service worker precache listesine girmez.

### Yükleme ve yenileme

Rota paketi veya doğrulanmış ilk veri beklenirken aynı hafif iskelet kullanılır: koyu dönem alanı, nötr işlem yer tutucuları ve açıklayıcı yükleme metni. Tarih, tutar veya yüzde uydurulmaz; yer tutucular erişilebilirlik ağacından gizlidir, yükleme bölgesi `aria-busy` taşır. Tek etkinlik şeridi ortak simetrik easing ile 1440 ms boyunca ileri/geri hareket eder; reduced-motion tercihi hareketi kapatır. Bütün veri doğrulanınca ilk 8 adım doğrudan gösterilir; kalanlar önceki grup DOM’a işlendikten sonraki requestAnimationFrame çağrılarında 16’şar eklenir. En çok 50 adımlık sayfa üç ek karede tamamlanır; yapay zamanlayıcı veya gecikme eklenmez. Bu, Google verisinin parça parça kabulü değildir: tüm bakiye zinciri önceden doğrulanır. Aktif görünüm tamamlanana kadar aria-busy taşır. Dönem/filtre/sayfa/görünüm değişimi bekleyen kareyi iptal eder; aynı kayıt kimlikleriyle yenilenen görüntü tamamlanmış sayfayı daraltmaz. Yenilemede mevcut doğrulanmış bakiyeler korunur; ilk hata sonrası tekrar denemede eski hata ve yükleme mesajı birlikte gösterilmez.

İlk yükleme, yavaş ağ, hata→yeniden deneme, veri korunması, tek hareket, reduced-motion ve 320–1440 px kabuk hizası hedefli Timeline E2E kapısındadır. Gelir adımları ay başına bir kez indekslenir; görünür her adım için bütün takvim yeniden taranmaz.
