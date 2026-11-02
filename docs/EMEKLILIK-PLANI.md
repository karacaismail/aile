# Emeklilik planı sayfası

Tarih: 2 Kasım 2026. Durum: **yapımda**. Sayfa yönetim panelinde `#/emeklilik` rotasıdır.

## Amaç

Kullanıcı üç bağımsız seçimi (askerlik borçlanması, Bağ-Kur borcunun ödenmesi, durdurulmuş Bağ-Kur sürelerinin ihyası) Evet/Hayır ile değiştirir. Sayfa her seçimde şunları anında hesaplar:

- emeklilik planlama ayı, o aydaki yaş ve tarihi belirleyen koşul (gün ya da sigortalılık süresi),
- geçmiş günler için ödeme ve kalemleri,
- seçili aylık modeline göre aylık ve varsa borç kesintisi,
- hiçbir şey ödemeyen yola göre ortak dönemdeki birikimli fark ve geri kazanma süresi,
- her seçimin tek başına etkisi, sekiz bileşimin tablosu ve öneri.

Gün ve tutarlar, aylık modeli, kesinti, karşılaştırma süresi ve iş ücreti varsayımları düzenlenebilir. İhya için iki yolu elle girilen net aylıklarla karşılaştıran ayrı bir bölüm vardır.

## Katmanlar (MVVM, OOP)

| Katman | Yer | Sorumluluk |
|---|---|---|
| Sözleşme | `src/admin/emeklilik/contract.ts` | Tipler ve `EmeklilikPlanlayici` arayüzü; katmanlar yalnız buna bağlıdır |
| Model | `src/admin/emeklilik/model/` | Saf alan sınıfları: para ve ay değer nesneleri, hizmet seçenekleri (ortak soyut sınıf), aylık modeli stratejileri, tarih ve nakit akışı hesabı, planlayıcı |
| ViewModel | `src/admin/emeklilik/viewmodel/` | `EmeklilikPlaniViewModel` sınıfı: durum, doğrulamalı komutlar, değişmez ekran anlık görüntüsü |
| View | `src/admin/pages/EmeklilikPage.tsx`, `src/admin/pages/emeklilik/` | Telefon önce; geniş sunum `*.wide.tsx` ile tembel; hesap yapmaz |
| Veri | `src/admin/emeklilik/data/` | Profil kaynağı ve şema doğrulaması |

## Hesap kuralları

İki kaynak araç (Codex'in ayrıntılı aracı ve sade karar aracı) uzlaştırıldı. Codex incelemesinin doğru bulduğu düzeltmeler uygulanır:

1. Bilinmeyen tutar uydurulmaz. Düzeltilmiş Bağ-Kur borcu bilinmiyorsa ödeme, fark ve geri kazanma "bilinmiyor" olur ve nedenini söyler.
2. Ödenmeyen borcun aylık kesintisi yalnız borç bitene kadar sürer; oran varsayımdır (mevzuat oranı ve tavanı içinde).
3. Aylık tek değerdir ve modeli adıyla yazılır. Ölçülmemiş yüzde aralığı gösterilmez.
4. Yollar ortak dönemde karşılaştırılır: dönem geç yolun emekliliğinden sonra seçilen yıl kadar sürer.
5. Sekiz bileşimin hepsi değerlendirilir. Mali sıralama yapılamıyorsa öneri "en erken tarih senaryosu" adını taşır.
6. Para kuruş tamsayısıyla hesaplanır; oranlı çarpımlar kuruşa açıkça yuvarlanır.

Sade araçtan alınan karar yaklaşımı: üç bağımsız soru, seçtikçe anında sonuç, her seçimin payı, sekiz bileşim tablosu, otomatik öneri.

## Gizlilik

Kişisel profil (doğum tarihi, gün sayıları, kazanç, borç) Git'e, `dist/` çıktısına ve test fikstürlerine girmez.

- Geliştirme sunucusu profili yalnız `AILE_EMEKLILIK_PROFILE` ortam değişkeninin gösterdiği Git dışı dosyadan, `/__aile/emeklilik/profil.json` yolundan salt okunur verir.
- Üretimde varsayılan kaynak yoktur; kullanıcı profil dosyasını içe aktarır ve profil yalnız bellekte tutulur.
- Testler `fixtures/emeklilik/profil-sentetik.json` dosyasını kullanır.

## Kaynak güncellemesi

Kaynak araçlar güncellendiğinde yalnız profil değerleri, mevzuat parametreleri ve varsayılan varsayımlar yenilenir. Yeni bir seçenek eklenirse model katmanında ortak soyut sınıftan yeni bir hizmet seçeneği türetilir.
