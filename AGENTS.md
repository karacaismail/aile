# aile: kapsam ve doğrulama

Bu Git deposu `site/` klasörüdür. Üst klasördeki e-tablo yedekleri, kullanıcı gelirleri, kişisel senaryolar ve `.env.local` public Git'e eklenmez. Git author/committer `karacaismail <35493655+karacaismail@users.noreply.github.com>`; kişisel author guard korunur. Lisans kararı kullanıcıya aittir. Üçüncü taraf font/fotoğraf lisansları kendi dosyalarındadır.

## Mimari
- `src/dashboard`: yeni salt okunur canlı bütçe; `#/pano` ve kök.
- `src/vehicle`: `#/arac`, araç kataloğu ve yerel finansman simülasyonu. E-tabloya/bankaya veri yazmaz. Kişisel girişler ancak kullanıcının düğmesiyle bu tarayıcıda saklanır.
- Araç çalışma alanı: masaüstünde çalışma genişliğinin %25’i olan tek yan panelde ayar sekmeleri (Araç/Bütçe/Kredi), kalan alanda araç/karar özeti; ödeme, koşullar, alternatifler, Sheet etkisi ve katalog ayrı inceleme sekmeleridir. Finansman kuralları `finance.ts` içinde kalır. Sekme değişimi bütçe veya seçili aracı sıfırlamaz. Uzun kaynak açıklamaları ortak `Disclosure` ile açılır; ARIA/inert anında, görsel yükseklik iki yönde ortak hareket tokenıyla değişir.
- `src/LegacyApp.tsx`: önceki taşınma modülleri ve Apps Script yazma/çevrimdışı senkronu. Yeni sayfada eski sync başlatılmaz.
- MantineProvider yalnız aktif uygulama kabuğundadır. Aynı DOM kökünü yöneten iç içe renk sağlayıcıları kullanmayın.
- React 19, Mantine 9.7, TypeScript, Vite 8 korunur. ECharts 6 kullanımı kullanıcının açık talebidir. Modül yazarları için eski bağımlılık/mimari kısıtları bu kapsam dışındaki değişikliklerde geçerlidir.

## UI sözleşmesi
- Outfit, en az 14 CSS px; kullanıcı kök boyutu korunur. Renk, tipografi, boşluk, yüzey ve hareket için `src/dashboard/tokens.ts` ve ortak CSS kullanılır.
- 320 px önce gelir. Tablonun okunabilir sütun minimumu korunur, yalnız kendi kapsayıcısı kayar. Kelime ortası bölünmez.
- Mantine custom Select; açık/kapalı/hover/seçili durumlar markalı ve kontrastlıdır. Native select kullanılmaz. Panel viewporta göre fixed konumlanır; dropdown ve sticky katmanları ortak tokenlardan gelir. Alt bölümlerden modele dönüp seçim yapma akışı CI regresyonudur.
- Klavye modu yalnız Tab/Shift+Tab açar, pointer/touch kapatır. Normal temada çevreleyen focus halkası yok; tek alt çizgi veya giriş altında çizgi vardır. Forced-colors + keyboard + focus-visible dar istisnadır.
- Hareket tokenı 240 ms, `cubic-bezier(.65,0,.35,1)`. Normal giriş/çıkış aynı token; reduced-motion anlık sunum istisnası. ARIA/input/state anında güncellenir. Geçiş sırasında da renk kontrastı korunur.
- Grafik, araç ve önceki uygulama paketleri talep üzerine yüklenir. PWA önbelleği bu paketleri önceden indirmez; ziyaret edilen modüller sonradan saklanabilir. Finansal yanıtlar service worker önbelleğine alınmaz.

## Veri ve finansman
- Bütçe sekme sözleşmesi ve sınırlamalar `docs/BUDGET-VEHICLE.md` içinde. Eksik fiyat sıfır değildir. Planı izleyen güncel tutar ödeme kanıtı değildir.
- Taşıt satın alma bedeli, TSB kasko değeri, karışık paket ilan göstergesi ve pakete özgü teyitsiz iddia ayrı tutulur.
- BDDK değer dilimleri, ihtiyaç kredisi vade eşikleri, finansör yaşı ve ürün limitleri ayrı kurallardır. Peşinat ihtiyaç kredisiyle karşılanıyorsa iki borç birlikte hesaplanır.
- Yedek nakit ayrı bir fondur: yalnız ürün limiti/asgari tutar veya masraf açığı kadar kullanılır; aylık gelir değildir. Kullanılan/kalan para ve yetersiz fon durumu korunur.
- Bütçe eşiği bankanın onay kuralı değildir; hane gelirini otomatik başvuru gelirine eklemeyin. Bilinmeyen borç/gider sıfır değildir. Hiçbir sonuç kredi onayı/ret kararı gibi sunulmaz.

## Gerçek kontrol komutları
`pnpm typecheck`, `pnpm test`, `pnpm e2e:dashboard`, `pnpm build`.
Yeni dashboard/finansman E2E: Chromium, Firefox, WebKit, 320–1440, açık menü, dark tercih izolasyonu, klavye, kontrast, tablo kaydırma ve anlık senaryo değişikliği. Eski modül testleri `pnpm e2e` altında kalır. Yeni testleri genel legacy matriste tekrar çoğaltmayın.
Önemli değişikliklerde önce başarısız davranış testi, sonra aynı test GREEN. Anlamlı UI/finansal kurallar için bağımsız salt okunur standards-reviewer incelemesi. Ana ajan komutları çalıştırır. CI, ekran okuyucu veya gerçek cihaz koşulmadıysa `not_run` yazın; otomatik axe testi tüm WCAG 2.2 AA uygunluğunu kanıtlamaz.

Kompakt araç düzeninin regresyonu: sekme klavyesi/durum koruma, karar–ayar hizası, açıklama açma/kapama hareketi ve anlık semantik durum, 320–1440 taşma/metin alt sınırı, yatay görünümde giriş/odak koruma, yalnız seçili fotoğraf isteği ve isteğe bağlı grafik. Ekran görüntüleri test çıktısıdır; kendiliğinden onaylanmış piksel baseline değildir.

Araç yüzeyinin görsel hiyerarşisi: açık ana gezinme, çizgiyle ayrılan metin sekmeleri, seçili araç kimliği/fotoğrafı ve tek nötr finansman özeti. Büyük renkli bağlam/uyarı şeritlerini geri getirmeyin. Uygunluk rengi yalnız durum etiketine aittir; kredi onayı ile bütçe yorumu ayrı kalır. Tutar açıklamaları alanın altında yer alır. Sheet yenileme durumu araç sayfasının sonunda; bağlantı hatası üstte görünür. 1440×900 kabulünde araç fotoğrafı ve ana taksit ilk görünümde kalır.
Seçili araç/yıl, alım fiyatı ve alım ayı başlıkta bütün ayar sekmelerinde görünür kalır; görsel sadeleştirme bu bağlamı kaldırmamalıdır.

Yan panel sözleşmesi: 64em ve üzeri genişlikte gridin %25’i form panelidir; 16px aralık sonrası kalan alan sonuçlarındır. Panel sticky, kendi kaydırma alanına sahiptir. Dar görünümde aynı form DOM’u kapalı bir disclosure ile açılır; modalsiz olduğu için odak tuzağı yoktur. Sonuçları göster eylemi kapatır ve sonuç başlığına odak verir. Etkileşim gören masaüstü paneli daralırken açık kalır; form ve odak kaybolmaz. Araç, gelir, kredi, alternatif oranlar ve katalog arama girişleri paneldedir; ana içerikte yinelenmez. Yan panel açıklama hareketi ortak tokenlarla iki yönlüdür ve kapalı içerik anında inert olur. 1440×900 normal veri görünümünde ödeme tablosu ilk ekran içinde başlamalıdır. Aynı form/iş kuralları/paylaşılan CSS kullanılır; ayrı masaüstü/mobil form paketi yoktur.
