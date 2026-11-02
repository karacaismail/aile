# Emeklilik planı sayfası

Tarih: 2 Kasım 2026. Durum: **aday**. Sayfa yönetim panelinde `#/emeklilik` rotasıdır (Para bölümünde, Hesaplar ve borçlar'dan sonra). Model, görünüm modeli, veri katmanı ve sayfa entegrasyon dalında birleşti; doğrulama özeti aşağıdadır. Yayın, panelin geri kalanıyla aynı Codex devrine bağlıdır ([ADMIN-RUNBOOK.md](ADMIN-RUNBOOK.md) §7).

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
| Sözleşme | `src/admin/emeklilik/contract.ts` | Tipler, `EmeklilikPlanlayici` ve `EmeklilikProfilKaynagi` arayüzleri; katmanlar yalnız buna bağlıdır |
| Model | `src/admin/emeklilik/model/` | Saf alan sınıfları: para ve ay değer nesneleri, senaryo çiftli tutar, hizmet seçenekleri (ortak soyut sınıf), aylık modeli stratejileri, hizmet takvimi, tarih hesabı, kesinti planı, yol karşılaştırıcısı, planlayıcı. React, DOM ve antd içe aktarmaz (kaynak kuralı `kaynakKurali.test.ts`) |
| ViewModel | `src/admin/emeklilik/viewmodel/` | `EmeklilikPlaniViewModel` sınıfı: durum, doğrulamalı komutlar, Türkçe sayı ayrıştırma, değişmez ekran anlık görüntüsü (`subscribe`/`getSnapshot`, `useSyncExternalStore`); planlayıcı enjekte edilir, hesap yapmaz |
| View | `src/admin/pages/EmeklilikPage.tsx`, `src/admin/pages/emeklilik/` | Telefon önce (yerel radyo grupları, akordeon tablo, açılır bölümler); geniş iki sütunlu sunum `EmeklilikGenis.wide.tsx` ile lazyWide, telefonda indirilmez; hesap yapmaz |
| Veri | `src/admin/emeklilik/data/` | Profil deposu (yalnız bellek), geliştirme yükleyicisi, dosya içe aktarma ve Zod şema doğrulaması |

Profil durumları adıyla gösterilir: yükleniyor, yok (dosya içe aktar), hata (yeniden dene ve içe aktar), hazır; kayıt 30 günden eskiyse "Eski veri". Planlayıcı hata atarsa ekran "Hesap yapılamadı: …" der, sayfa çökmez ve tutar gösterilmez.

## Hesap kuralları

İki kaynak araç (Codex'in ayrıntılı aracı ve sade karar aracı) uzlaştırıldı. Codex incelemesinin doğru bulduğu düzeltmeler uygulanır:

1. Bilinmeyen tutar uydurulmaz. Düzeltilmiş Bağ-Kur borcu bilinmiyorsa ödeme, fark ve geri kazanma "bilinmiyor" olur ve nedenini söyler. Aralık girdisi (alt ve üst uç) iki senaryo olarak taşınır ve aralık sonuç verir.
2. Ödenmeyen borcun aylık kesintisi yalnız borç bitene kadar sürer; oran varsayımdır (mevzuat oranı ve tavanı içinde, 0 kesintiyi kapatır).
3. Aylık tek değerdir ve modeli adıyla yazılır. Ölçülmemiş yüzde aralığı gösterilmez.
4. Yollar ortak dönemde karşılaştırılır: dönem erken yolun emekliliğinden başlar ve geç yolun emekliliğinden sonra seçilen yıl kadar sürer. Faiz, enflasyon ve ileride aylık ya da ücret zammı hesaba katılmaz.
5. Sekiz bileşimin hepsi değerlendirilir. Mali sıralama yapılamıyorsa öneri "en erken tarih senaryosu" adını taşır.
6. Para kuruş tamsayısıyla hesaplanır; oranlı çarpımlar kuruşa açıkça yuvarlanır.

Model kararları (em-model):

7. Ödenmemiş borç = düzeltilmiş borç − ortak ödeme. Ortak ödeme, Bağ-Kur'u seçmeyen (yalnız SSK) yolda da ödenecek Bağ-Kur tutarıdır. Bağ-Kur'u seçmeyen yolda aylıktan kesinti bu ödenmemiş borç üzerinden yapılır; ortak ödeme borcu aşamaz. Ek ödeme karşılaştırmasında Bağ-Kur yalnız bir yolda seçiliyse ortak ödeme farktan düşülür.
8. Gecikme oranı (aylık, isteğe bağlı; varsayılan tahmin yok) ödenmemiş borca basit faiz olarak kayıt ayından emeklilik ayına kadar eklenir: borç × oran × ay. Kesinti döneminde ayrıca gecikme eklenmez.
9. Aylık planlama ayından sonraki ay başlar: planlama ayının kendisinde aylık yoktur, her yol emeklilik ayını izleyen aydan itibaren aylık alır.
10. Geri kazanma, ek ödemeyi yolun kendi net aylığıyla (aylık − diğer kesintiler − borç kesintisi) karşılayan aylık sayısıdır. Aralıklı girdide iki senaryonun uzun olanı yazılır (ihtiyatlı).
11. Planlama ayı kayıt ayından önce olamaz: gün ve sigortalılık süresi geçmişte dolmuş olsa da planlama ayı en erken verilerin okunduğu aydır.
12. Kazanç tahmini kalibrasyonu yalnız kayıtlı günle yapılır: SGK referans aylığı hangi gün sayısıyla hesaplandıysa o gün sayısı kayıtlı günle aynı olmalıdır, değilse model "bilinmiyor" der ve nedenini yazar. Planlanan (henüz kayıtta olmayan) günler kalibrasyona karışmaz.
13. Dönem varsayılanı: askerlik borçlanması 2008 öncesi gün (eski dönem aylığı), Bağ-Kur borcu ve ihya 2008 sonrası gün (yeni dönem aylığı) sayılır. Borçlanılan, ihya edilen ve Bağ-Kur günleri kazanç tahmininde asgari düzeyden (kat 1) girer.

### Kaynak araçlardan bilinçli farklar

- ±%15 aralık yok: aylığa ölçülmemiş bir yüzde aralığı eklenmez; aylık tek değer ve model adıyla yazılır.
- Süresiz kesinti yok: ödenmeyen borç kesintisi borç (varsa gecikmesiyle) bitince durur; aylık sıfırsa "kesintiyle kapanmaz" denir.
- %30 maliyet zammı varsayılmaz: askerlik ve ihya bedeli girilen günlük bedelden ya da mevzuat yılının günlük kazanç alt sınırı × borçlanma oranından hesaplanır; ödeme ileride yapılacaksa yeni bedel elle girilir. Profildeki ücret zam oranı yalnız karşılaştırmadaki iş ücretine uygulanır.

Sade araçtan alınan karar yaklaşımı: üç bağımsız soru, seçtikçe anında sonuç, her seçimin payı, sekiz bileşim tablosu, otomatik öneri.

## Doğrulama

- Sentetik profilde sekiz bileşimin planlama ayı iki kaynak araçla aynıdır (profil `fixtures/emeklilik/profil-sentetik.json`, altın değer testi `src/admin/emeklilik/model/EmeklilikPlanlayici.test.ts`).
- Codex aracının `model.cjs` modeliyle 240 karşılaştırma uyuşuyor (em-model görevi, sentetik sabitlerle depo dışında). Depodaki altın testler bunun özetini taşır: her bileşim için erken ay, ek ödeme, fark ve geri kazanma (`compareCashToSsk`), iş bırakılınca vazgeçilen ücret ve elle aylıkla ihya karşılaştırması (`compareIhyaChoice`).
- Kişisel profille yerel ve bağımsız doğrulama yapıldı: depo dışında, bağımsız karar tablosuna karşı sekiz bileşimin tarihi, yaşı ve ödemesi birebir tuttu. Kişisel değerler hiçbir belgeye, teste veya commit'e yazılmadı.
- Kapılar: `pnpm exec vitest run src/admin/emeklilik`, `src/policy.test.ts` (sentetik dışı profil JSON'u yok), `pnpm check:privacy` (`retirement-profile`, `retirement-profile-path`) ve `e2e/admin-page-emeklilik.spec.ts` (Chromium ve WebKit, telefon önce; `@matrix` projelerinde de koşar).

## Gizlilik

Kişisel profil (doğum tarihi, gün sayıları, kazanç, borç) Git'e, `dist/` çıktısına ve test fikstürlerine girmez.

- Geliştirme sunucusu profili yalnız `AILE_EMEKLILIK_PROFILE` ortam değişkeninin gösterdiği Git dışı dosyadan, `/__aile/emeklilik/profil.json` yolundan salt okunur verir. Değişken yalnız süreç ortamından okunur; `.env` dosyaları okunmaz.
- Üretimde varsayılan kaynak yoktur ve istek yapılmaz; kullanıcı profil dosyasını içe aktarır ve profil yalnız bellekte tutulur.
- Testler `fixtures/emeklilik/profil-sentetik.json` dosyasını kullanır.

## Açık konular

- Düzeltilmiş Bağ-Kur borcu bilinmedikçe mali sıralama yapılamaz ve öneri "en erken tarih senaryosu" türündedir. Borç kaynağının sayfadan seçilmesi (bilinmiyor, sade aracın tahmin aralığı ya da elle tutar) ayrı bir görevde yapılıyor ve birleşmeyi bekliyor.
- En düşük aylık değeri kaynak araçlardaki 2026 değeridir; resmi tutar SGK'dan doğrulanmalıdır (`src/admin/emeklilik/model/mevzuat.ts`).

## Kaynak güncellemesi

Kaynak araçlar güncellendiğinde yalnız profil değerleri, mevzuat parametreleri ve varsayılan varsayımlar yenilenir. Yeni bir seçenek eklenirse model katmanında ortak soyut sınıftan yeni bir hizmet seçeneği türetilir. Kural değişikliği önce bu belgeye ve model testlerine girer.
