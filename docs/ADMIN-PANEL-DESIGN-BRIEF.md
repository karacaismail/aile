# aile yönetim paneli — Claude Design için UI yönergesi

Tarih: 1 Kasım 2026. Bu yönerge görsel tasarım aracına verilecek tek metindir; depo bilgisi olmadan okunabilir. Uygulama Ant Design 6 + Pro Components ile yapılacak; tasarım bu bileşen ailesinin yapabildiği şeylerle sınırlı kalmalı.

## 1. Ürün ve ton

- Ürün: bir ailenin bütçesini, ödemelerini, borçlarını, alımlarını, ev projelerini ve görevlerini ortak kayıtlar üzerinden yöneten **yönetim çalışma alanı**. İlk kullanıcı tek aile; ekranı günde birkaç kez açan, kayıt arayan, durum değiştiren kişi.
- Ton: sakin, yoğun ama okunabilir, nötr. Mağaza/katalog estetiği değil; ERP yoğunluğu da değil. Veri önde, dekor arkada.
- Dil: Türkçe arayüz. Emoji yok. Dekoratif ikon az; ikon varsa yanında metin var.

## 2. Renk (hex sabit, değiştirme)

| Rol | Değer |
|---|---|
| Metin (ink) | `#203A51` |
| İkincil metin (muted) | `#52697C` |
| Lacivert: navigasyon, birincil koyu yüzey | `#1B3E55` |
| Mavi: birincil eylem, bağlantı, odak çizgisi | `#326B94` |
| Açık mavi: yardımcı | `#A6BED0` |
| Veri yüzeyi (paper) | `#FFFFFF` |
| Sayfa zemini (canvas) | `#F5F7FA` |
| Akış zemini (kart listesinin arkası) | `#E1E9EF` |
| Çizgi / ayraç | `#DCE4EB` |
| Seçili yüzey | `#C9DBE7` |
| Olumlu | `#316653`, yüzey `#EFF7F3` |
| Hata / olumsuz | `#9F4E48`, yüzey `#FCF0EE` |
| Uyarı | `#805C22`, yüzey `#FCF8EE` |
| Bilgi yüzeyi | `#EAF1F6` |
| Koyu özet paneli üstünde ikincil metin | `#C9DBE7`; negatif tutar `#FFC4BB`; pozitif `#BFE3D2` |

Kurallar: durum rengi azdır ve her zaman metin etiketiyle birlikte gelir; renk tek işaret olamaz. Metin kontrastı en az 4,5:1. Tek açık tema; koyu tema bu teslimde yok.

## 3. Tipografi

- Font: **Outfit** (400, 500, 600, 700). Kod/kimlik için monospace serbest.
- Gövde 16 px / satır 1,5. **Hiçbir okunabilir metin 14 px altına inmez**: etiket, rozet, tablo, tooltip, yardımcı metin, hata, sayfalama dahil.
- Başlıklar: h1 32/1,2 · h2 24/1,3 · h3 18/1,4 · h4 16/1,5. Başlık ağırlığı 700, etiket ağırlığı 500.
- Tutarlar: tabular rakam, sağa hizalı, para birimi görünür. Büyük ölçü 24 px; ana tutar 32 px.
- Ana eylem, form etiketi ve hata metni kesilmez (ellipsis yok). Tablo başlığı ve ilk tanımlayıcı sütun kelime ortasından bölünmez.

## 4. Boşluk, köşe, gölge, hareket

- Boşluk ölçeği: 4 · 8 · 12 · 16 · 24 · 32. Sayfa iç boşluğu 16; bölüm arası 24.
- Köşe: kontrol 8 · kart 12 · panel 16.
- Dokunma/tıklama hedefi en az 44×44. Görünür kontrol ile hedef alanı ayrı düşün.
- Gölge yalnız yükseltilmiş kartta: `0 2px 4px rgba(27,62,85,.18), 0 8px 20px rgba(27,62,85,.14)`; seçili kart: `0 8px 24px rgba(27,62,85,.2)`.
- Hareket: 240 ms, `cubic-bezier(.65,0,.35,1)`, açılış ve kapanış aynı. Reduced-motion'da anlık.

## 5. Yasaklar (tasarımda görünmemeli)

1. **Çevreleyen odak halkası yok.** Klavye odağı tek alt çizgi (3 px mavi, metinden 6 px aşağıda); giriş alanında alt kenarda 3 px iç çizgi.
2. **Köşesi yuvarlatılmış kutunun bir kenarına renkli vurgu şeridi yok** (sol renkli bar, "Tailwind dalgası"). Vurgu için yüzey tonu, gölge veya tipografi kullan. Düz çizgi yalnız değdiği köşeler radiussuz ise.
3. Her şeyi kart ve kenarlığa alma. Ayrım boşluk, hizalama, yüzey ve bölüm başlığıyla kurulur. Kenarlık yalnız form alanı, tablo ızgarası ve seçili durumda.
4. Mağaza tarzı büyük kart ızgarası varsayılan değil.
5. Hover tek erişim yolu olamaz; her eylem dokunma ve klavyeyle ulaşılır.
6. İşletim sistemi görünümlü native select yok; açılır panel markalı.
7. Büyük renkli uyarı/bağlam şeritleri yok.
8. Metni küçülterek sığdırma yok; dar ekranda yerleşim değişir, yazı değişmez.

## 6. Yerleşim kabuğu

- **Masaüstü (≥ 1024 px):** solda sabit lacivert navigasyon 272 px; içerik alanı en çok 1480 px, zemin canvas; veri yüzeyleri beyaz.
- **Dar ekran (< 1024, ilk hedef 320 px):** üstte ince bar: marka "aile" + geçerli sayfa adı + "Sayfalar" düğmesi. Düğme navigasyonu **modal çekmece** olarak açar (Kapat düğmesi, Escape, odak açan düğmeye döner).
- Navigasyon grupları (sıra sabit): Genel durum · Bütçe ve nakit · Ödemeler · Hesaplar ve borçlar · Alımlar ve eşyalar · Ev ve odalar · Projeler ve görevler · Taraflar ve teklifler · Raporlar · Sözlükler ve iş akışları · Veri kalitesi ve içe aktarma. Altta yardımcılar: Ayarlar · E-tabloyu aç. Seçili öğe yüzey tonu ve ağırlıkla ayrılır, renkli şerit yok.
- Breadcrumb yok (düz hiyerarşi).

## 7. Her sayfanın iskeleti (sıra sabit)

1. **Başlık bloğu:** üstte küçük bölüm adı (14 px, muted) → **h1 = menüdeki sayfa adı** (aynı metin) → bir satır amaç cümlesi → sağda sayfa eylemleri → altında tazelik satırı: "Son okuma 14:32 · Nesil a1b2c3" ve "Yenile".
2. **Anlamlı özet:** bu sayfadaki kayıt sayısı, kapsam, açık iş; her yere para kutusu koyulmaz. En fazla üç ölçü, tek satır.
3. **Sorgu çubuğu:** arama alanı · kayıtlı görünüm seçici · **görünüm modu** (Liste · Tablo · Zaman çizelgesi · Kanban · Gantt · Pivot; bu veri için anlamsız modlar devre dışı ve gerekçesi tooltip + metinle) · sıralama · dışa aktar.
4. **Filtre + sonuçlar:** masaüstünde solda **açık** filtre paneli (272 px), sağda sonuçlar. Dar ekranda aynı filtreler çekmecede; aktif filtreler sonuçların üstünde kaldırılabilir etiketler olarak görünür. Sonuç yoksa hangi filtrelerin etkili olduğu yazılır.
5. **Kayıt ayrıntısı:** geniş ekranda sağdan 384 px yan panel; dar ekranda tam genişlik sayfa. Aynı içerik sırası: kimlik ve fotoğraf → plan / gerçek bilgiler yan yana ayrı → durum ve eylemler → bağlı kayıtlar → kaynak ve değişiklik izi. Kapanınca odak açan kayda döner.

## 8. Filtre boyutları (ayrı ayrı, karıştırma)

Kategori ağacı (ebeveyn alt dalları kapsar, kısmi seçim görünür) · Oda · Proje aşaması (Önce / Yerleşme / Sonra) · Yaşam bağlamı (Bebek, Köpek — aşama değildir) · Tedarik durumu · Ödeme durumu · Finansman türü · Sorumlu · Tarih türü + aralık (sipariş / son ödeme / teslimat seçimi açık) · Tutar aralığı · Veri güveni · Eksik fiyat / eksik fotoğraf. Aynı boyutta çoklu seçim "veya", boyutlar arası "ve". Her seçenek yanında sayım; "Bilinmiyor" ayrı değer.

## 9. Görünüm modları

- **Liste:** başlık · kimlik kodu (14 px) · birincil durum etiketi · oda · planlanan ve gerçekleşen tutar ayrı · 56 px küçük fotoğraf; fotoğraf doğrulanmamışsa "Fotoğraf yok" yer tutucu, başka ürünün resmi asla.
- **Tablo:** türlenmiş sütunlar, yapışkan başlık, sütun minimum genişliği korunur, **yalnız tablonun kendi kapsayıcısı yatay kayar**, satır tıklaması ayrıntıyı açar, seçim kutusu solda.
- **Zaman çizelgesi:** tarih sütunu solda, olay kartları sağda; plan ve gerçek ayrı işaretli; tarihsizler en altta "Tarihsiz" grubunda.
- **Kanban:** sütun = iş akışı durumu; kartta başlık, oda, tutar, sorumlu; sürükleme yanında klavyeli "Durumu değiştir" düğmesi.
- **Gantt:** yalnız başlangıç ve bitiş tarihi olan işler; tarihsizler yanda kuyruk; tahmin çizilmez.
- **Pivot:** satır/sütun boyutu + ölçü seçici; hücre tıklaması kaynak kayıtları açar; plan ve gerçek aynı hücrede toplanmaz.

Mod değişince seçim, filtre, sıralama ve odak korunur.

## 10. Durumlar

- **Yükleniyor:** aynı yerleşimde iskelet; tek ince hareketli şerit; finansal değer gösterilmez.
- **Boş:** "Bu filtrelerle kayıt yok" + etkin filtre listesi + "Filtreleri temizle".
- **Hata:** kısa açıklama + "Yeniden dene"; tutarlar kaldırılır, eski değer gösterilmez.
- **Eski veri (stale) / çevrimdışı:** tazelik satırı turuncuya döner: "Son başarılı nesil 09:10 · yenilenemedi".
- **Çakışma:** "Bu kayıt sunucuda değişti" paneli; iki sürüm yan yana, sessiz ezme yok.

## 11. Teslim edilecek ekranlar (öncelik sırasıyla)

1. Kabuk + "Alımlar ve eşyalar" **Liste** modu — 320 px ve 1440 px.
2. Aynı sayfa **Tablo** modu — 1440 px.
3. Filtre çekmecesi — 320 px; açık filtre paneli — 1440 px.
4. Kayıt ayrıntısı — 1440 yan panel ve 320 tam sayfa (fotoğraflı ve "Fotoğraf yok" halleri).
5. Navigasyon çekmecesi — 320 px (açık, Kapat düğmesi görünür).
6. Boş, hata ve eski veri durumları — 320 px.
7. Klavye odağı örnekleri: odaklı düğme, odaklı giriş alanı, odaklı menü öğesi (alt çizgi, halka yok).

## 12. Çıktı biçimi

- Ekranlar yanında **token sayfası**: yukarıdaki renk, tipografi, boşluk, köşe, gölge, hareket değerleri tek tabloda.
- Bileşen envanteri: Button (birincil/ikincil/sade), IconButton, TextField, Select, Table, Drawer, Dialog, Tabs, Menu, Tag/StatusText, Disclosure, FormFooter, LoadingShell, EmptyState, ErrorState, DataStatus — her birinin normal / hover / active / focus-visible / disabled / selected / invalid halleri.
- Geliştirici notu için Ant Design karşılıkları: kabuk ProLayout, tablo ProTable, liste ProList, ayrıntı ProDescriptions, form ProForm, mod seçici Segmented, kategori ağacı Tree, durum Tag. antd'de kapatılacak varsayılanlar: odak dış çizgisi, Menu seçili şeridi, Card kenarlığı, 12 px küçük yazı.
