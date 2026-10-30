# Timeline

`#/timeline`, Google Sheets’teki `Timeline` sayfasından adım adım planlanan nakit ve kart borcunu okur. Finansal hesapların sahibi e-tablodur. Web uygulaması formüllerin sonucunu doğrular ve gösterir; ödeme göndermez, e-tabloya yazmaz, yeni bir finansman stratejisi hesaplamaz.

## Veri sözleşmesi

Kaynak `Timeline!A8:Q1600`; 8. satır başlıktır. `src/timeline/contract.ts` sütunların sırasını ve başlıklarını tanımlar. Tarih ISO `YYYY-MM-DD`, dönem `YYYY-MM`; tutarlar sonlu sayıdır. Eksik değer sıfır kabul edilmez.

| Sütun | Anlam |
|---|---|
| A–F | Kalıcı kimlik, tarih, gün içi sıra, tür, adım, kaynak |
| G–I | Nakit, Denizbank borcu ve İşbank borcundaki işaretli değişim |
| J–M | Adımdan sonraki nakit, iki kart borcu ve toplam kart borcu |
| N–Q | Tarih niteliği, açıklama, mutabakat farkı, dönem |

İlk olay açık bir `Başlangıç` kaydıdır; G–I başlangıç bakiyelerini taşır. Sonraki her bakiye önceki bakiye + değişim ile uyuşmalıdır. Tarih ve gün içi sıra artar; kimlikler tekrarlanmaz. Her dönemin son olayı takvim ayının son gününde `Kontrol` / `Ay sonu kontrolü` olmalıdır. Mutabakat farkı sıfır, toplam borç iki banka borcunun toplamı olmalıdır. Kuruş yuvarlaması için en fazla 0,011 TL fark kabul edilir. Negatif nakit saklanır ve uyarılır; negatif kart borcu geçerli model verisi sayılmaz.

Satır sonunda açık tutar, yeni düzenleme sırasında formül hatası, eksik ay sonu kontrolü veya bakiye uyuşmazlığı varsa yeni görüntü reddedilir. Son başarılı görüntü yalnız bellekte tutulur. Gerçek aile verileri kaynak koda, fixture'a, yerel kalıcı depoya veya service worker önbelleğine yazılmaz.

## Kullanım ve sınırlar

İlk dönem varsayılan seçilir; ay filtresi, önceki/sonraki ay ve tüm dönem seçenekleri vardır. Her adımda kalan nakit, toplam kart borcu ve banka kırılımı görünür. Özet seçilen dönemin başı/sonu ve en düşük plan nakdini gösterir. Bunlar plan bakiyeleridir; gerçekleşmiş ödeme kanıtı değildir. Tarihi varsayılan olaylar ayrıca işaretlenir; aynı gün maaşın geliş saati ve ödeme sırası günlük ödenebilirliği değiştirebilir.

Uzun dönemler 50 adımlık sayfalara ayrılır. Özet seçilen dönemin tamamını kapsar; sayfa değiştirmek hesap sonucunu veya adımların genel sıra numarasını değiştirmez. Dönem filtresi değişince ilk adım sayfasına dönülür. Altı/yedi haneli sentetik tutarlar 320 px ve %200 metin büyütmede, 716 adımlık / 26 aylık sentetik takvim de tüm sayfalarda test edilir. Bakiyeler metin büyüdüğünde tek sütuna geçer; sayı basamakları bölünmez.

Sayfa kendi veri isteğini yapar; eski bütçe şemasının doğrulanmasına bağımlı değildir. Açılış, görünürken her dakika, odağa/çevrimiçine dönüş ve Yenile okuma tetikler. 20 saniye zaman aşımı, çakışmayan istek ve unmount iptali vardır. Yeni Timeline JS/CSS yalnız rota seçildiğinde yüklenir ve önceden PWA önbelleğine alınmaz. Google Sheets’in mevcut erişimi korunur; bu rota bir kimlik doğrulama katmanı eklemez.

## Doğrulama

- `pnpm exec vitest run src/timeline src/dashboard/useBudget.test.tsx`
- `pnpm exec playwright test --config playwright.dashboard.config.ts e2e/timeline-dashboard.spec.ts`
- `pnpm typecheck`, `pnpm test`, `pnpm build`

Regresyonlar sentetik veri kullanır: hatalı/eksik veri reddi, nakit/borç zinciri, son başarılı veriyi koruma, rota izolasyonu, görünür varsayımlar, negatif nakit, 320–1440 px yeniden yerleşme, uzun adım adı, klavye odağı, özel ay seçimi ve azaltılmış hareket. Playwright WebKit gerçek Safari/iOS cihaz testi değildir. Tarayıcı görüntüleri test kanıtıdır, otomatik onaylı piksel referansı değildir.

## Düz URL ve sayfalama

`/aile/timeline`, `/aile/timeline/` ve `/aile/timeline/index.html` statik girişleri `/aile/#/timeline` adresine döner. Eski `#/pano` parçası bu girişte Timeline seçimini değiştirmez. GitHub Pages için `public/timeline/index.html` gerçek dosya olarak derlemeye girer; sunucu rewrite kuralı gerekmez. Ay seçimi veya önceki/sonraki ay gezinmesi adım sayfasını sıfırlar. Tüm döneme geri dönmek ilk 50 adıma döner.

## Timeline görünümü

- Dönem seçimi ve başlangıç/son/en düşük nakit ile son kart borcu, tek özet alanındadır.
- Geniş görünümde tarih sütunu, işlem ve sonraki bakiyeleri hizalar. Dar görünümde aynı DOM tek akışa dönüşür; gezinme kendi içinde kayar.
- Her adımda nakit ve iki kartın borcu görünür kalır. Uzun not ve kaynak bilgisi, klavye ve dokunmayla açılan Ayrıntı düğmesindedir. Tarih varsayımları ve negatif nakit uyarıları bu panele saklanmaz.
- `e2e/timeline-dashboard.spec.ts` ayrıntı açma/kapatma, anlık ARIA/inert, iki yönlü hareket, kesilen animasyon, klavye odağı, yön değişiminde açık durum, ilk görünüm yoğunluğu, 320 px ve masaüstünde %200 metin büyütmeyi kontrol eder.
