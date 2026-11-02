# Emeklilik planı sayfası

Tarih: 2 Kasım 2026. Durum: **aday**. Sayfa yönetim panelinde `#/emeklilik` rotasıdır (Para bölümünde, Hesaplar ve borçlar'dan sonra). Model, görünüm modeli, veri katmanı ve sayfa entegrasyon dalında birleşti; doğrulama özeti aşağıdadır. Yayın, panelin geri kalanıyla aynı Codex devrine bağlıdır ([ADMIN-RUNBOOK.md](ADMIN-RUNBOOK.md) §7).

## Amaç

Kullanıcı üç bağımsız seçimi (askerlik borçlanması, Bağ-Kur borcunun ödenmesi, durdurulmuş Bağ-Kur sürelerinin ihyası) Evet/Hayır ile değiştirir. Sayfa her seçimde şunları anında hesaplar:

- emeklilik planlama ayı, o aydaki yaş ve tarihi belirleyen koşul (gün, sigortalılık süresi; ikisi de daha önce dolmuşsa kayıt ayı, profilde varsa asgari yaş),
- geçmiş günler için ödeme ve kalemleri,
- seçili aylık modeline göre aylık ve varsa borç kesintisi,
- hiçbir şey ödemeyen yola göre ortak dönemdeki birikimli fark ve geri kazanma (başa baş) süresi,
- her seçimin tek başına etkisi, sekiz bileşimin tablosu ve öneri.

Gün ve tutarlar, aylık modeli, kesinti, karşılaştırma süresi ve iş ücretinin iki yolda devam edip etmediği düzenlenebilir. İş ücretinin tutarı düzenlenmez: profilden gelir (net ücret × (1 + zam oranı)) ve bayrağın yanında tutarı ve kaynağıyla yazılır. İhya için iki yolu net aylıklarla karşılaştıran ayrı bir bölüm vardır; boş bırakılan net aylık seçili aylık modelini kullanır.

## Katmanlar (MVVM, OOP)

| Katman | Yer | Sorumluluk |
|---|---|---|
| Sözleşme | `src/admin/emeklilik/contract.ts` | Tipler, `EmeklilikPlanlayici` ve `EmeklilikProfilKaynagi` arayüzleri; katmanlar yalnız buna bağlıdır |
| Model | `src/admin/emeklilik/model/` | Saf alan sınıfları: para ve ay değer nesneleri, senaryo çiftli tutar, hizmet seçenekleri (ortak soyut sınıf), aylık modeli stratejileri, hizmet takvimi, tarih hesabı, kesinti planı, yol karşılaştırıcısı, planlayıcı. React, DOM ve antd içe aktarmaz (kaynak kuralı `kaynakKurali.test.ts`) |
| ViewModel | `src/admin/emeklilik/viewmodel/` | `EmeklilikPlaniViewModel` sınıfı: durum, doğrulamalı komutlar, Türkçe sayı ayrıştırma, değişmez ekran anlık görüntüsü (`subscribe`/`getSnapshot`, `useSyncExternalStore`); planlayıcı enjekte edilir, hesap yapmaz |
| View | `src/admin/pages/EmeklilikPage.tsx`, `src/admin/pages/emeklilik/` | Telefon önce (yerel radyo grupları, akordeon tablo, açılır bölümler); geniş sunum `EmeklilikGenis.wide.tsx` ile lazyWide, telefonda indirilmez: tek ızgara, belge sırası dar sıra (öneri → seçimler → sonuç → paylar → varsayımlar → ihya); kapsayıcı 760 px'ten darsa (ör. 768 px tablet dikey) tek sütun ve sonuç seçimlerin altında, genişse sonuç sağda yapışkan sütunda; hesap yapmaz |
| Veri | `src/admin/emeklilik/data/` | Profil deposu (yalnız bellek), geliştirme yükleyicisi, dosya içe aktarma ve Zod şema doğrulaması |

Profil durumları adıyla gösterilir: yükleniyor, yok (dosya içe aktar), hata (yeniden dene ve içe aktar), hazır; kayıt 30 günden eskiyse "Eski veri". Profili depo okur (geliştirmede ilk abonelikte); sayfa ayrıca yenilemez, profil bir kez istenir.

Alanlar arası kural (yalnız SSK yolunda da ödenecek Bağ-Kur tutarı düzeltilmiş borcu aşamaz) planlayıcıya gitmeden ViewModel formunda denetlenir: ihlal düzenlenen alanın yanında (borç alanı ya da ortak ödeme alanı) "Hata: …" olarak yazılır, hesap borç/ortak ödeme çiftinin son geçerli hâliyle sürer ve diğer değişiklikler uygulanır. Uçlar ayrı karşılaştırılır (alt ≤ alt, üst ≤ üst), tutarlardan biri bilinmiyorsa kural uygulanmaz. Planlayıcı yine de hata atarsa ekran "Hesap yapılamadı: …" der, sayfa çökmez ve tutar gösterilmez; hata tek sabit ağaçta çizilir (ErrorState üstte, seçimler ve form yerinde; açık bölüm ve odak korunur) ve eylemin adı "Varsayımları sıfırla"dır (hesap girdiye bağlı olduğundan "Yeniden dene" yoktur).

## Hesap kuralları

İki kaynak araç (Codex'in ayrıntılı aracı ve sade karar aracı) uzlaştırıldı. Codex incelemesinin doğru bulduğu düzeltmeler uygulanır:

1. Bilinmeyen tutar uydurulmaz. Düzeltilmiş Bağ-Kur borcu bilinmiyorsa ödeme, fark ve geri kazanma "bilinmiyor" olur ve nedenini söyler. Aralık girdisi (alt ve üst uç) iki senaryo olarak taşınır ve aralık sonuç verir.
2. Ödenmeyen borcun aylık kesintisi yalnız borç bitene kadar sürer; oran varsayımdır (mevzuat oranı ve tavanı içinde, 0 kesintiyi kapatır).
3. Aylık tek değerdir ve modeli adıyla yazılır. Ölçülmemiş yüzde aralığı gösterilmez.
4. Yollar ortak dönemde karşılaştırılır: dönem erken yolun emekliliğinden başlar ve geç yolun emekliliğinden sonra seçilen yıl kadar sürer. Faiz, enflasyon ve ileride aylık ya da ücret zammı hesaba katılmaz.
5. Sekiz bileşimin hepsi değerlendirilir. Mali sıralama yapılamıyorsa öneri "en erken tarih senaryosu" adını taşır.
6. Para kuruş tamsayısıyla hesaplanır; oranlı çarpımlar kuruşa açıkça yuvarlanır (yarım kuruş sıfırdan uzağa). Yuvarlama sırası: günlük bedel (günlük kazanç alt sınırı × borçlanma oranı) önce kuruşa yuvarlanır, sonra gün sayısıyla çarpılır; ör. ₺1.000,01 × %45 = 450,0045 → ₺450,00 ve 360 gün → ₺162.000,00 (yuvarlanmadan çarpılsa ₺162.001,62 olurdu).

Model kararları (em-model):

7. Ödenmemiş borç = düzeltilmiş borç − ortak ödeme. Ortak ödeme, Bağ-Kur'u seçmeyen (yalnız SSK) yolda da ödenecek Bağ-Kur tutarıdır. Bağ-Kur'u seçmeyen yolda aylıktan kesinti bu ödenmemiş borç üzerinden yapılır; ortak ödeme borcu aşamaz. Ek ödeme karşılaştırmasında Bağ-Kur yalnız bir yolda seçiliyse ortak ödeme farktan düşülür. İki yolda da seçili aynı kalem (aynı tutar bilgisi) ek ödemede birbirini götürür: borç bilinmese de, iki yolda da Bağ-Kur seçiliyken ihya ve askerlik farkı bilinir (Codex aracı: ortak borç ve askerlik bedeli düşer).
8. Gecikme oranı (aylık, isteğe bağlı; varsayılan tahmin yok) ödenmemiş borca basit faiz olarak kayıt ayından emeklilik ayına kadar eklenir: borç × oran × ay. Kesinti döneminde ayrıca gecikme eklenmez.
9. Aylık planlama ayından sonraki ay başlar: planlama ayının kendisinde aylık yoktur, her yol emeklilik ayını izleyen aydan itibaren aylık alır.
10. Geri kazanma (başa baş, Codex aracının tanımı): karşılaştırılan yola (çoğunlukla hiçbir şey ödemeyen yol) göre birikimli fark(t) = gelir farkı − ek ödeme, vazgeçilen ücret dahil, senaryo başına ilk kez ≥ 0 olduğu aydır. Ortak dönemin başından (erken yolun emeklilik ayı) ay olarak sayılır ve "N ay sonra" yazılır; ek ödeme yoksa "Gerekmez". Ortak dönem içinde başa baş yoksa "Dönem içinde geri dönmüyor" (sonuç null, neden yok); girdi bilinmiyorsa "Bilinmiyor" ve nedeni. Aralıklı girdide iki senaryonun uzun olanı yazılır; senaryolardan biri dönem içinde dönmüyorsa sonuç "geri dönmüyor"dur (ihtiyatlı). Ek ödemeyi yolun kendi aylığıyla karşılayan aylık sayısı ayrı bir ölçü olarak gösterilmez.
11. Planlama ayı kayıt ayından önce olamaz: gün ve sigortalılık süresi geçmişte dolmuş olsa da planlama ayı en erken verilerin okunduğu aydır.
12. Kazanç tahmini kalibrasyonu yalnız kayıtlı günle yapılır: SGK referans aylığı hangi gün sayısıyla hesaplandıysa o gün sayısı kayıtlı günle aynı olmalıdır, değilse model "bilinmiyor" der ve nedenini yazar. Planlanan (henüz kayıtta olmayan) günler kalibrasyona karışmaz.
13. Dönem varsayılanı: askerlik borçlanması 2008 öncesi gün (eski dönem aylığı), Bağ-Kur borcu ve ihya 2008 sonrası gün (yeni dönem aylığı) sayılır. Borçlanılan, ihya edilen ve Bağ-Kur günleri kazanç tahmininde asgari düzeyden (kat 1) girer.

Düzeltme turu kararları (em-fix):

14. Net aylık eksiye düşmez: her ay aylık − diğer kesintiler − o ayın borç kesintisi, en az 0 (kişi aldığından fazlasını ödemez). Borç kesintisi borç bitince durur, son ay yalnız kalan borç kesilir.
15. Tarihi belirleyen koşul: prim günü ya da sigortalılık süresi. İkisi de kayıt ayından önce dolmuşsa planlama ayı kayıt ayıdır ve ekran bunu adıyla yazar ("Gün ve sigortalılık süresi kayıt ayından önce dolmuş; planlama ayı kayıt ayı"); "Tarihi prim günü belirliyor" denmez. Sözleşmede `sinirlayanKosul` null ve isteğe bağlı `sinirlayanAyrinti` 'kayitAyi'dir.
16. Yaş şartı kapsam dışıdır: kaynak araçlar yaş şartı uygulamaz, model de varsayılan olarak uygulamaz. Profil isteğe bağlı `asgariYas` (tam yıl, 0–100) taşırsa planlama ayı bu yaşın dolduğu aydan önce olamaz, planlanan çalışma o aya kadar sürer ve ekran "Tarihi yaş şartı belirliyor (N yaş)" der (`sinirlayanAyrinti` 'asgariYas'). Alan yoksa hesap değişmez. Hangi yaşın geçerli olduğu SGK'dan doğrulanmalıdır.
17. İş ücreti: karşılaştırmadaki aylık net iş ücreti profildeki net ücret × (1 + zam oranı)'dır (sözleşmede isteğe bağlı `isUcreti`). Düzenlenmez; iş ücreti bayrağının yanında tutarı ve kaynağıyla yazılır. Bayrak açıkken iki yolda aynıdır ve farka girmez; kapalıyken emekli olan yol bu ücretten vazgeçer ve vazgeçilen ücret farka ve geri kazanmaya girer.

### Kaynak araçlardan bilinçli farklar

- ±%15 aralık yok: aylığa ölçülmemiş bir yüzde aralığı eklenmez; aylık tek değer ve model adıyla yazılır.
- Süresiz kesinti yok: ödenmeyen borç kesintisi borç (varsa gecikmesiyle) bitince durur; aylık sıfırsa "kesintiyle kapanmaz" denir.
- %30 maliyet zammı varsayılmaz: askerlik ve ihya bedeli girilen günlük bedelden ya da mevzuat yılının günlük kazanç alt sınırı × borçlanma oranından hesaplanır; ödeme ileride yapılacaksa yeni bedel elle girilir. Profildeki ücret zam oranı yalnız karşılaştırmadaki iş ücretine uygulanır.

Sade araçtan alınan karar yaklaşımı: üç bağımsız soru, seçtikçe anında sonuç, her seçimin payı, sekiz bileşim tablosu, otomatik öneri.

## Doğrulama

- Sentetik profilde sekiz bileşimin planlama ayı iki kaynak araçla aynıdır (profil `fixtures/emeklilik/profil-sentetik.json`, altın değer testi `src/admin/emeklilik/model/EmeklilikPlanlayici.test.ts`).
- Codex aracının `model.cjs` modeliyle 240 karşılaştırma uyuşuyor (em-model görevi, sentetik sabitlerle depo dışında). Depodaki altın testler bunun özetini taşır: her bileşim için erken ay, ek ödeme, fark ve geri kazanma (`compareCashToSsk`), iş bırakılınca vazgeçilen ücret ve elle aylıkla ihya karşılaştırması (`compareIhyaChoice`).
- Geri kazanmanın yeni tanımı (kural 10) ve ortak kalemin ek ödemede düşmesi (kural 7), `compareCashToSsk` ve `compareIhyaChoice` formüllerinin parametreli kopyasına karşı sentetik profille 1.080 karşılaştırmada uyuştu: fark, geç yol farkı ve geri kazanma; iş ücreti devam/bırak, dönem 0/1/10 yıl, bilinen ve bilinmeyen borç, geç yoldan sonra başa baş (em-fix, depo dışında). Altın değerler `EmeklilikPlanlayici.test.ts` ve `YolKarsilastirici.test.ts` içindedir.
- Sahte planlayıcı (ViewModel ve sayfa testleri) ile gerçek model aynı sözleşme testini geçer (`src/admin/emeklilik/planlayiciSozlesmesi.test.ts`): ihya karşılaştırmasında elle aylık anahtarı yoksa seçili model, varsa (null dahil) elle model.
- Kişisel profille yerel ve bağımsız doğrulama yapıldı: depo dışında, bağımsız karar tablosuna karşı sekiz bileşimin tarihi, yaşı ve ödemesi birebir tuttu. Kişisel değerler hiçbir belgeye, teste veya commit'e yazılmadı.
- Kapılar: `pnpm exec vitest run src/admin/emeklilik`, `src/policy.test.ts` (sentetik dışı profil JSON'u yok), `pnpm check:privacy` (`retirement-profile`, `retirement-profile-path`) ve `e2e/admin-page-emeklilik.spec.ts` (Chromium ve WebKit, telefon önce; `@matrix` projelerinde de koşar). E2E ayrıca alanlar arası kuralı (borç "4": alan hatası, odak ve açık bölüm korunur), geniş sunumun dar kapsayıcısını (767/768/769 × 1024 ve 1023/1024/1025 × 768) ve bütün bölümler açıkken sayfadaki her etkileşimli denetimin dokunma hedefini sınar.

## Gizlilik

Kişisel profil (doğum tarihi, gün sayıları, kazanç, borç) Git'e, `dist/` çıktısına ve test fikstürlerine girmez. Belge, yorum, test ve commit mesajlarındaki örnek değerler yalnız sentetik profilden türer (ör. askerlik bedeli ₺178.362,00, sigortalılık süresi 10 Mart 2029) ya da nötrdür (ör. ₺8.500,00); kişisel profilden türeyen tarih, gün, tutar ya da senaryo farkı yazılmaz ve teslimden önce kişisel değer taramasıyla denetlenir.

- Geliştirme sunucusu profili yalnız `AILE_EMEKLILIK_PROFILE` ortam değişkeninin gösterdiği Git dışı dosyadan, `/__aile/emeklilik/profil.json` yolundan salt okunur verir. Değişken yalnız süreç ortamından okunur; `.env` dosyaları okunmaz.
- Üretimde varsayılan kaynak yoktur ve istek yapılmaz; kullanıcı profil dosyasını içe aktarır ve profil yalnız bellekte tutulur.
- Testler `fixtures/emeklilik/profil-sentetik.json` dosyasını kullanır.

## Açık konular

- Düzeltilmiş Bağ-Kur borcu bilinmedikçe mali sıralama yapılamaz ve öneri "en erken tarih senaryosu" türündedir. Borcun kaynağı sayfada seçilir ("Bağ-Kur borcunun kaynağı": SGK düzeltilmiş tutarı bilinmiyor, sade aracın tahmin aralığı ya da girilen tutar); SGK'nın düzeltilmiş tutarı öğrenilince "Tutarı gir" ile girilir.
- En düşük aylık değeri kaynak araçlardaki 2026 değeridir; resmi tutar SGK'dan doğrulanmalıdır (`src/admin/emeklilik/model/mevzuat.ts`).

## Kaynak güncellemesi

Kaynak araçlar güncellendiğinde yalnız profil değerleri, mevzuat parametreleri ve varsayılan varsayımlar yenilenir. Yeni bir seçenek eklenirse model katmanında ortak soyut sınıftan yeni bir hizmet seçeneği türetilir. Kural değişikliği önce bu belgeye ve model testlerine girer.
