# Bütçe ve araç simülasyonu

## Kullanım
`#/pano`: aylık gelir, ödemeler, birikim ve serbest nakit; ECharts dönem grafikleri; filtrelenebilir/sıralanabilir tablolar.
`#/arac`: araç → bütçe → kredi → sonuç. Sonuç taşıt kredi imkânı, bütçe baskısı ve bilinmeyen finansör onayını ayrı gösterir. Peşinat için ihtiyaç kredisiyle kalan borç birleştirilir. Ödeme tablosu, teklif karşılaştırması ve e-tablo bütçesi üzerine etki yalnız tarayıcıda hesaplanır.

## Canlı Sheet sözleşmesi
`VITE_BUDGET_SHEET_ID` yerelde `.env.local`, yayında GitHub repository variable olarak verilir. Kimlik tarayıcı derlemesinde görünür; secret değildir. Finansal veri kaynak kodda bulunmaz. Sheet'in mevcut erişimi korunur; kod yayınlama/erişim izni vermez. Doğrudan gviz anonim okuma için mevcut link erişimi gerekir. Yetki kaldırılırsa uygulama hata gösterir.

| Sekme | Aralık | Amaç |
|---|---|---|
| Pano | B49:M63 | 14 aylık plan/güncel özet |
| Plan | B7:P74 | Kategori planı |
| Gerçekleşen | B7:P74 | Planı izleyen veya elle değiştirilen tutarlar |
| Düzensiz giderler | B9:Q | Tüm tek seferlik kalemler; satır sonu açık |

Başlıklar ve toplam etiketleri doğrulanır. gviz boş satırları atabildiği için fiziksel satır sayısına göre kategori ayrılmaz. Gelir/ödeme/birikim toplamları sekmeler arasında; düzensiz giderlerin plan/ödeme ayına göre toplamı da Plan/Gerçekleşen kategori toplamıyla eşleşmeden yeni görüntü kabul edilmez. Sheet formülleri hâlen 300. satıra kadar toplar; sonrası site tarafından okunur ama toplamda yoksa tutarsızlık uyarısı verir. Dört paralel okuma Google tarafında atomik işlem değildir; kontrol karışık toplamları reddeder fakat eşit toplamlı ara düzenlemeleri tespit edemez. Kaynak dönemi/şeması değişirse adapter güncellenmelidir.

Açılış, görünürken 60 saniye, odağa/çevrimiçine dönüş ve Yenile düğmesi okuma tetikler. 20 saniye zaman aşımı, çakışmayan istekler, unmount iptali ve son başarılı görüntüyü koruma vardır. Google önbelleği/geçici gecikmesi nedeniyle anlık push garantisi yoktur. Son okuma zamanı kaynakta son değişiklik zamanı değildir. Tarayıcı yeniden açılınca gerçek aile snapshot'ı yerel depodan yüklenmez.

## Araç verisinin sentezi
İki kullanıcı çalışma kitabından 49 model adı çıkarıldı; marka/model kaynak sayfaları 2026-10-29 tarihinde kontrol edildi. 37 model için 2015–2026 döneminde 3 milyon TL'yi aşmayan 206 model-yıl göstergesi bulundu. Diğer modeller bu katalogda seçilmez. Yeni bir Excel simülatörü üretilmedi.

`catalog.json` içindeki `price` kaynak model/yıl ilan göstergesidir; gerçekleşmiş satış, TSB kasko veya tam paket fiyatı değildir. Kaynağın "ortalama fiyat" göstergesi ve aralığı aktarılır; kaynak dosyanın "medyan" ifadesi doğrulanmış kabul edilmez. `upperClaim` ikinci dosyadaki paket iddiasıdır, teyitsizdir. 3 milyon üstü iddialar seçilebilir katalogda kullanılmaz. Üst aralık fiyatları 3 milyonu aşabilir; alım fiyatı alanı 3 milyonla sınırlıdır. Honda Accord dosyalarındaki 2.2 dizel / 1.5 benzinli eşleşmesi aynı araç kabul edilmez; arayüzde çatışma belirtilir. Tam donanım/hasar/kilometre eşleştirilmiş aktif ilan doğrulaması tamamlanmış değildir.

Sayısal güvenilirlik puanları kanıt içermediğinden kullanılmaz. Öneriler bütçe ve kontrol gereksinimleriyle gerekçelendirilmiş değerlendirmelerdir. Fotoğraflar lisanslı temsilî model görselleridir; seçili yıla/pakete birebir ait oldukları iddia edilmez. Atıflar `VEHICLE-PHOTOS.md` içinde.

## Finansman kuralları (2026-10-29 kontrolü)
- [BDDK 10099](https://www.bddk.org.tr/Mevzuat/EkGetir/1210?ekId=271): standart bireysel binek taşıt: ≤400 bin %70/48 ay; ≤800 bin %50/36; ≤1,2 milyon %30/24; ≤2 milyon %20/12; üzeri taşıt finansmanı yok. Tüm değer dilime girer. Yerli elektrikli istisnası bu kataloğa uygulanmaz.
- [BDDK 11152](https://www.bddk.org.tr/Mevzuat/DokumanGetir/1270): ihtiyaç ≤125 bin 36 ay, ≤250 bin 24 ay, üzeri 12 ay.
- [Koçfinans](https://www.kocfinans.com.tr/tr/krediler/tasit-kredisi/ikinci-el-tasit-kredisi): 15 yaş, TSB kasko değeri, anlaşmalı satıcı/uygun ekspertiz. Ürün açıklamasındaki 36 ay üst sınırı esas alınır; sayfanın genel yasal tablosundaki 48 ay daha geniştir.
- [Garanti BBVA](https://www.garantibbva.com.tr/krediler/2-el-tasit-kredisi): araç yaşı + vade ≤144 ay; ayı bilinmeyen araçta yıl farkı kullanımı yaklaşık sonuçtur, finansör teyidi gerekir.
- [Enpara](https://www.enpara.com/krediler/ihtiyac-kredisi): ürün 5.000–800.000 TL, en az 3 ay, tahsis ücreti yok. Ürün tavanı kişisel onay değildir.
- [Vergiler](https://www.garantibbva.com.tr/krediler/kredi-hesaplama): faiz üzerinden %15 KKDF + %15 BSMV. Diğer kredi tahsis ücreti %0,5 + BSMV üst sınır varsayımı; gerçek sözleşmeyle teyit edilmelidir.

Başlangıç %3,5 taşıt ve %4 ihtiyaç faizleri yalnız değiştirilebilir örnek, güncel teklif iddiası değildir. Sabit aylık amortisman hesaplanır; ilk ödeme sonraki ay. Tutarlar kuruşa yuvarlanır ve son anapara sıfırlanır. Bankanın gün esaslı ödeme takvimi, sigorta ve sözleşme ücretleri farklı sonuç verebilir. Eldeki nakitten önce tahsis ve girilen ek masraf ayrılır; kalan peşinata gider. Ücretin yeniden borçlanıldığı veya aynı nakdin iki kez kullanıldığı varsayılmaz. Ek masraflar otomatik kredilendirilmez. Pick-up için binek kredi hesabı yapılmaz; ticari ruhsat/ürün koşulları ayrı teyit edilir.

Ana karar ürün limitleriyle belirlenir: tutar asgari/üst sınırı aşarsa “Uygun değil”; doğrulanmamış ticari sınıf veya özel teklif varsa “Değerlendirilemiyor”; modellenen sınırlar içindeyse “Koşullu uygun”. Bu etiket bankanın kişiye özel kararı değildir. Nakit masraf açığı ve kişisel bütçe uyarısı ayrı gösterilir. Yaş nedeniyle taşıt kredisi çıkmıyorsa tüm kalan bedel ihtiyaç kredi sınırıyla yeniden kontrol edilir; finansman yokken kredi varmış gibi dağıtılmaz.

[Garanti kredi hesaplama açıklaması](https://www.garantibbva.com.tr/krediler/kredi-hesaplama) maaş müşterisi olmayanlarda dijital kanal için 450.000 TL sınırı belirtir. Şube teklifi farklıdır; bankanın daha yüksek tutarı kişiye onayladığı varsayılmaz. Aynı kaynak 13 Şubat 2025 sonrası ihtiyaç kredilerinin kalan anapara toplamına göre vade bildirir. Mevcut anapara bilinmiyorsa muhafazakâr 12 ay kullanılır; biliniyorsa yeni krediyle toplanır.

Başvuru sahibi belgeli geliri, eş bordrosu ve toplam hane geliri ayrı alanlardır. [Enpara SSS](https://www.enpara.com/sss/default.aspx?category=18) kayıtlı gelir ve tüm bankalardaki borç değerlendirmesini belirtir, kefil kabul etmez. İncelenen Koçfinans/Enpara kaynakları herkese uygulanan sayısal bir taksit/gelir onay oranı yayımlamaz. Eş veya bordro dışı gelir kabulü otomatik varsayılmaz.

%40 gelir eşiği kişisel bütçe varsayımıdır, değiştirilebilir; yasal veya bankalarca ortak uygulanan bir onay kriteri değildir. Hane geliri başvuru gelirine eklenmez. Yaşam gideri ve mevcut borç boşsa sonuç eksiktir. Peşinat alt sınırı, yalnız girilen faiz/gelir/gider/limitlerle hesaplanan bütçe alt sınırıdır. Krediyi birden çok bankaya bölerek limit aşılması varsayılmaz. Hiçbir başvuru gönderilmez.

## Doğrulama sınırları
Axe ve tarayıcı testleri WCAG'nin otomatik değerlendirilebilir kısmını kapsar. Tam WCAG 2.2 AA uygunluk iddiası yapılmaz. Gerçek iOS Safari/Android cihazları ve VoiceOver/NVDA ayrı kabul katmanıdır. ECharts sayısal alternatifleri tabloda sağlanır. Yeni davranışın testleri sentetiktir; gerçek aile verisi ekran görüntüleri/test fixture olarak repoya eklenmez.

## Yedek nakit ve uygunluk filtresi
Yedek nakit peşinat ve aylık birikimden ayrı mevcut bir fondur. Masraf veya kredi üst/asgari tutar engeli oluştuğunda yalnız gereken kısmı kuruş bazında çekilir; yetmezse kalan engel korunur. Aylık gelire eklenmez. Kullanılan/kalan tutar ve kalan kredi açığı ayrı gösterilir. E-tabloya etki hesabında bu dış fondan karşılanan bölüm aylık serbest nakitten tekrar düşülmez; fon zaten e-tabloda varsa iki kez kaynak sayılmamalıdır. Kişisel tutarlar public başlangıç değeri değildir; yalnız açık kaydet düğmesiyle tarayıcıda saklanır.

Uygunluk anahtarı seçili ürünlerin kurallarını her model/yıl için yeniden çalıştırır. Kişisel bütçe eşiği veya onay bilinmezliği adayları otomatik elemez. Filtre dışına düşen mevcut hesap korunur; model yılları açıklamasında ürün sonucu, yedek kullanımı ve kalan limit açığı görülür.

Galeri model değişiminde ön görünüme döner. Ön/arka 37 model, iç mekân 35 model için lisanslı gerçek fotoğraf vardır. S80 ve ix35 iç mekânında yanlış nesil göstermek yerine eksik teyit açıklanır. Kaynak fotoğraf adı ve atıf her açının fotoğraf bilgisi bölümünde erişilebilir; seçili yıl/paket birebirliği iddia edilmez.

## Araç çalışma alanı

Araç, Bütçe ve Kredi ayarları kontrollü sekmelerde tutulur; sekme değiştirmek senaryoyu veya yerel bütçe kaydını sıfırlamaz. Masaüstünde karar özeti ayarların yanındadır. Dar ekranda tek akış ve başlık yanındaki taksit/sonuca git kontrolü kullanılır. Ödeme planı, kural gerekçeleri, teklif karşılaştırması, e-tablo etkisi ve araç kataloğu ayrı inceleme sekmeleridir. Uzun fiyat, lisans ve hesap varsayımları açılabilir açıklamalardır.

Yasal/ürün sonucu, finansörün bilinmeyen kişisel onayı ve bütçe yorumu ayrı kalır. Kullanılan/kalan yedek nakit, finansman tutarları ve alım günü açık tutarı ana özette görünür. Hesap motorunun kuralları bu yerleşim değişikliğiyle değiştirilmedi.

Doğrulama: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e:dashboard`. Yeni regresyonlar sekmeler arası değer/odak korumayı, tek açık analiz alanını, açıklamaların çift yönlü hareketini ve anlık ARIA durumunu, 320–1440 px taşma/metin boyutlarını, yatay telefon geçişini ve talebe bağlı kaynakları denetler. WebKit/macOS tam klavye erişimi kapalıyken düğmeleri dolaşmak için Option+Tab profili kullanılır; görünür odak denetimi aynıdır.

Yerel üretim çıktısı ayrıca üç Playwright motorunda kontrol edildi: açık olmayan grafik/eski uygulama paketleri ilk yüklemede istenmedi; yalnız görünür seçili fotoğraf yüklendi; grafik düğmesi PaymentChart/ECharts paketlerini getirdi. %200 kök yazı boyutunda sayfa taşması ve iki hızlı gezinme kontrolünde odak kaybı görülmedi. Bu kontroller gerçek Safari/iOS/Android cihazı veya manuel ekran okuyucu testi yerine geçmez. Ekran görüntüleri inceleme kanıtıdır, otomatik onaylı piksel referansı değildir.

Görsel düzen: gezinme ve sekmeler açık yüzeyde tutulur; araç fotoğrafı altındaki açı seçimi ana ayar sekmelerinden ayrı görünür. Finansman özeti önce aylık yükü ve toplam maliyeti, ardından ürün koşulunu, borç dağılımını ve yedek nakdi gösterir. Durum etiketi renkli; geniş uyarı zemini yoktur. Sayı alanlarının açıklamaları tutarın altında hizalanır. Yenileme/bağlantı durumu araç akışının sonundadır; hata mesajı üstte kalır. Yeni ilk-görünüm regresyonu 320 px hızlı sonuç erişimini ve 1440×900 içinde araç/taksit görünürlüğünü korur.
Seçili araç, yıl, fiyat ve alım ayı başlık altında sekmelerden bağımsız görünür; Bütçe ve Kredi düzenlerken alım bağlamı korunur.
