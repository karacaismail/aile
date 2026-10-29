# Model yılına göre araç galerisi — 29 Ekim 2026

## Davranış ve kapsam

- Model kimliği + model yılı, kasa/makyaj dönemini seçer. Aynı kasanın devam ettiği iki yılda fotoğrafın aynı kalması beklenen davranıştır.
- Geçiş yıllarında iki kasa varsa otomatik bir kasa varsayılmaz; kullanıcı “Kasa / makyaj” alanından seçer. Bu seçim fiyat göstergesini ya da finansman girdisini değiştirmez; kaynak fiyatlar kasa/donanım bazında ayrıştırılmış değildir.
- 37 model, 205 seçilebilir model/yıl, 84 kasa/makyaj dönemi: 194 açı eşleştirmesi, 191 ayrı yerel fotoğraf. Her dönemin ön fotoğrafı var. 58 arka/iç açı henüz doğrulanmadı ve açık eksik durumuyla gösterilir. Bunlar tamamlanmış fotoğraf kapsamı sayılmaz.
- Türkiye’de kullanılan gövde biçimi, far/ızgara/tampon dönemi ve kabinde sol direksiyon esas alınır. Fotoğrafın çekildiği ülke Türkiye olmak zorunda değildir. Renk, jant ve paket eşleşmesi iddia edilmez; örneğin Corolla E210 makyajlı ön fotoğrafının Arjantin SE-G donanımı, aynı Prestige sedan gövdesini gösterir. Model yılı ile fotoğrafın çekim tarihi karıştırılmaz.
- 2026 Hilux için önceki 2.370.000 ₺ ilan göstergesi eski/yeni kasayı ayırmıyordu. [Toyota Türkiye’nin yeni kasa duyurusundaki](https://www.toyota.com.tr/haberler-ve-etkinlikler/toyotanin-iki-ikonu-yenilendi-yeni-hilux-satisa-sunuldu-yeni-rav-4-hybrid-tanitildi) başlangıç bedeli 3 milyon ₺ sınırının üzerindedir. Bu yılın belirsiz göstergesi listeden çıkarıldı; yeni kasa eski kasa fiyatıyla sunulmaz. Eski kasalı bir 2026 ilanının kesin fiyatı ve gövdesi ayrıca doğrulanırsa yeniden eklenebilir.
- Yeni galerideki dosyalar Wikimedia Commons CC / public-domain kaynaklarından alınır; atıflar `VEHICLE-PHOTOS.md` içindedir. İzni bu kullanımla ilişkilendirilemeyen Toyota basın görselleri çıkarıldı.

## Yerel doğrulama

Çalışma dizini: `site`. Node 24.21.0, pnpm 11.21.0; React 19.3.1, Mantine 9.7.4, TypeScript 5.9.3, Vite 8.3.5, Playwright 1.64.1. Test verileri sentetiktir.

| Kontrol | Sonuç | Kanıt / kapsam |
| --- | --- | --- |
| Önce başarısız davranış testi | PASS | Eski model bazlı galeri yıl değişiminde aynı `src` kaldığı için başarısızdı. Hilux fiyat/kasa ve yeniden yükleme regresyonları da önce başarısız oldu. |
| `pnpm typecheck` | PASS | TypeScript kontrolü |
| `pnpm test` | PASS | 35 dosyada 318 test |
| `pnpm e2e:dashboard` | PASS | 45 test; Chromium, Firefox, WebKit |
| `pnpm build` | PASS | Üretim çıktısı; önceden var olan büyük ECharts/LegacyApp parça uyarısı sürüyor |
| Görsel kaynak izolasyonu | PASS | 2017 ön → 2026 ön → 2025 aynı ön → 2025 arka → 2015 arka akışında tam dört benzersiz fotoğraf isteği; bütün galeri indirilmez |
| Yıl sınırları / geçiş yılı / eksik açı | PASS | 2015/2017/2020/2026 Corolla ayrı dönem; 2025/2026 aynı dönem; 2016 açık seçim; eksik kabinde önceki fotoğraf yok |
| Yeniden yükleme | PASS | Fotoğraf isteği kesilip yeniden açılır; kullanıcı seçimini değiştirmeden tekrar yükleyebilir |
| Üretim ağı / service worker | PASS | `pnpm build` + mevcut 5175 preview; Chromium 320/1440, aynı köken kaynakları: soğuk açılış 574.445 bayt, yalnız seçili fotoğraf 226.434 bayt. SW denetimli yeniden yüklemede tek fotoğraf isteği; LegacyApp/Charts/PaymentChart yüklenmedi. Sheet yanıtları sentetik; gerçek finansal veri ölçülmedi. |
| Mobil ve masaüstü | PASS | 320, 360, 375, 390, 768, 1440 CSS px; mevcut yan panel, yatay görünümde form/odak koruma ve metin/taşma kontrolleri |
| Erişilebilirlik regresyonu | PASS | Mevcut axe AA kontrolleri, markalı menü ve klavye/odak akışları; tam WCAG uygunluk belgesi değildir |
| Fiziksel iOS / Android / Safari | not_run | Playwright WebKit sonucu gerçek Safari sonucu yerine kullanılmaz |
| Ekran okuyucu | not_run | ARIA/DOM kontrolleri gerçek yardımcı teknoloji testinin yerine geçmez |
| Otomatik piksel baseline | not_run | Ekran çıktıları elle incelendi; referans görüntüler sessizce güncellenmedi |

Tarayıcı çıktıları `test-results/` altında üretilir ve Git'e eklenmez. Ana yıl regresyonunun ekranı `generation-{chromium,firefox,webkit}.png`; ağ doğrulaması aynı testteki istek kümesi karşılaştırmasıdır. Yükleme hatasının RED trace'i ve son başarılı loglar yerel test kanıtlarında tutuldu. Bağımsız salt okunur incelemede bulunan Hilux fiyat/kasa, basın fotoğrafı kullanım kanıtı ve tekrar yükleme bulguları giderildi; yayın doğrulaması GitHub Actions çalışması ve canlı sayfada ayrıca yapılır.

Katalogda sunulmayan RAV4 2015 için makyajlı kasaya taşan kullanılmayan aralık da daraltıldı; resolver `null` verir. Hedefli regresyon önce başarısız, sonra 40/40 başarılıdır. Bu düzeltme yeni model yılı veya fiyat kapsamı eklemez.
