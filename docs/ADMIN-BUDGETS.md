# Yönetim paneli aktarım bütçesi

Bu belge `admin.html` girişinin ilk rotası için profil bazlı aktarım bütçesini tanımlar. Ölçüm üretim derlemesinden yapılır, tarayıcıdan değil. Komut `scripts/check-budgets.mjs`, bütçe dosyası `scripts/budgets.json`, birim testleri `scripts/check-budgets.test.mjs`. Teslim kapısı (`scripts/check-delivery.mjs`) hangi sınıfın telefona girmemesi gerektiğini söyler; bu kapı aynı derlemenin kaç bayt indirdiğini söyler.

## Komut sırası

```sh
VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 pnpm build
node scripts/check-delivery.mjs dist            # dist/delivery-report.json üretir
node scripts/check-budgets.mjs dist             # ratchet modu
node scripts/check-budgets.mjs dist --strict    # tavan listesi boşalınca (bugün beklenen FAIL: phone-js, wide-js)
```

Seçenekler: `[dist] [--strict] [--budgets <json>] [--delivery-report <json>] [--report <json>]`. Varsayılanlar `dist`, `scripts/budgets.json`, `dist/delivery-report.json` ve `dist/budget-report.json` dosyalarıdır.

Çıkış kodları: 0 PASS, 1 FAIL, 2 girdi hatası. Girdi hatası şunlardan biridir: eksik manifest, graph, delivery-report veya `admin.html`; başka derlemeden kalmış delivery-report; bozuk bütçe dosyası; dist dışındaki font; bilinmeyen seçenek. Komut ağ çağrısı yapmaz. Yalnız `dist` okunur ve rapor yazılır.

`check-delivery` aynı derlemede koşmalıdır. `check-budgets` delivery-report'taki statik kapanışı manifestle karşılaştırır. Dosya kümesi ya da ham bayt farklıysa "delivery-report eski" der ve 2 ile çıkar.

## Ölçüm koşulları

| Koşul | Karar |
|---|---|
| Sıkıştırma | `node:zlib` `gzipSync`, seviye 9, dosya başına. `check-delivery` ile aynı fonksiyon (`measureBuffer`) kullanılır. |
| Ham | Diskteki dosya boyutu, bayt. |
| Aktarım | HTML, JS ve CSS için gzip baytı. Font için ham bayt: sunucunun fontu sıkıştırdığı varsayılmaz, woff2 zaten sıkıştırılmıştır. Bu bir üst sınırdır. |
| Birim | Rapor alanları bayttır. Bütçeler KB cinsinden okunur ve **1 KB = 1000 B** sayılır (120 KB = 120000 B). `check-delivery` özeti KiB (1024 B) yazar. Vite'ın derleme çıktısındaki kB 1000 B'dir, ama kendi gzip ayarıyla hesaplanır; bu sayılarla karşılaştırılamaz (kesim öncesi antd: Vite 235,59 kB, bu kapı 233210 B). |
| Önbellek | Soğuk: HTTP önbelleği ve service worker yok. Her dosya bir istektir ve bir kez sayılır. Yönetim parçaları zaten ön belleğe alınmaz. Ana uygulamayla paylaşılan `shared` parçası, ana uygulamayı ziyaret etmiş bir cihazda ön bellekte olabilir. Bütçe yine de onu sayar. |
| Veri | Derleme veriden bağımsızdır. Nesil (sentetik ya da gerçek) ve e-tablo istekleri kullanıcı içeriğidir; sayılmaz. Kayıtlı ölçüm `VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098` ile alınan derlemedendir. Kimlik derlemeye gömülür. Başka bir kimlik birkaç bayt fark yaratır ve tam tavanlı bir ratchet'i düşürebilir. Bu yüzden kapı yalnız sentetik kimlikle derlenmiş çıktı üzerinde koşar. |
| Araçlar | Node v24.21.0, Vite 8.3.5 (rolldown), taban `b061e08` + geçiş kesimi (x-cut). Farklı bir Node zlib sürümü gzip baytını birkaç bayt oynatabilir. Sürüm değişince ölçümü yeniden kaydedin. |
| Donanım | Ölçüm statiktir; cihaz, ağ ve CPU içermez. Gerçek istek kümesini `e02-production` üretim ağ yalıtımı testi doğrular. Gerçek cihaz ölçümü yoktur (`not_run`). |
| Hariç | favicon (`icon.svg`), görseller, veri istekleri, sonradan açılan sayfalar ve yetenekler. |

## Rota tanımları

**İlk sayfa.** `budgets.json` içindeki `firstRoute`, varsayılan yönetim rotasıdır: `/genel` → `src/admin/pages/GenelPage.tsx`. `b02-header-routes` varsayılanı `defaultAdminPath = adminPages[0].path` (Genel durum) yaptı ve yükleyiciyi `genel: () => import('./pages/GenelPage')` biçimine çevirdi. Test bu değerin `shell/navigation.ts` içindeki `defaultAdminPath` ile (dizge sabiti ya da `adminPages[N].path` sırası) ve `routes.tsx` sayfa importuyla (`page(() => import(…))` ya da `() => import(…)`) eşleştiğini doğrular. Sayfa `admin.html` statik kapanışından dinamik import ile erişilmiyorsa komut 2 ile çıkar.

**Telefon ilk rota** şu dosyalardan oluşur:

- `admin.html` (içine gömülü başlangıç betiği dahil).
- Girişin statik kapanışı: manifest `imports` zinciri, `check-delivery` ile aynı hesap.
- İlk sayfanın statik kapanışından, statik kapanışta olmayan parçalar.
- Bu parçaların `css[]` dosyaları.
- İlk ekran fontları. Rota CSS'indeki her `@font-face` kuralında `src` listesinin ilk `url()`'si sayılır, çünkü tarayıcı ilk desteklenen biçimi indirir. Bunlara `admin.html` içindeki `<link rel="preload" as="font">` adresleri eklenir. `data:` URL'ler CSS baytının içindedir. Mutlak adres yayın tabanından (`/aile/`), göreli adres CSS dosyasının klasöründen çözülür. Bugün Outfit'in iki yüzü sayılır: 400–500 gövde, 600–800 başlık. İlk ekranda ikisi de kullanılır.

**Geniş ilk rota** (tablet ve masaüstü), telefon ilk rotasına geniş başlangıç köklerinin statik kapanışını ekler. Bu kökler telefon rotasından dinamik import ile zincirleme erişilir ve şu iki koşuldan biriyle eşleşir:

- kaynağı `wideStartup.sources` içindedir (`src/admin/adaptive/WideProviders.tsx`);
- delivery-report sınıfı `wideStartup.classes` içindedir (`wide`).

Diğer sayfalar ve ECharts ilk rotada sayılmaz. Geçiş kesiminden sonra (`PHONE_WITHOUT_ANTD=true`) WideProviders tembel bir köktür (`wideResource('wide-providers', …)`); antd, icons ve babel-runtime parçalarını yalnız geniş profilde getirir. İkinci kök tek `wide` grubudur. Bu grup bütün `*.wide` modüllerini taşır ve onlar sayfa modüllerini statik içe aktardığı için statik kapanışı sekiz sayfa parçasını (Alımlar, Projeler, Sözlükler, Ödemeler, Bütçe, Taraflar, Ev, Hesaplar) ve ortak geniş bileşenleri (Select, Dialog, Tabs, ResponsiveTable, Chart kabuğu, Overview, QueryBar, FilterDrawer) da ilk rotaya ekler. Tablet ve masaüstü aynı geniş kaynak kümesini alır: `lazyWide` iki profili ayırmaz.

**Yetenek kaynağı** telefon rotasında istenen ve şu sınıflardan birini taşıyan parçanın her dosyasıdır: `antd`, `pro`, `icons`, `echarts`, `wide` (delivery-report `forbidden`). Birincil sınıf delivery-report `groups` listesinden okunur. Karma bir parçanın azınlık modülleri (örneğin ilk sayfa parçasına gömülü `zrender`) delivery-graph üyeliğinden okunur. `check-delivery` yalnız statik kapanışa bakar. Bu ölçüt, ilk sayfanın tembel ama ilk ekranda zorunlu kapanışını da kapsar.

## Bütçe seti

Kaynak, `adaptive-qa` başlangıç bütçe tablosudur. Tek tutarlı set seçildi; eski örnek sınırlar ayrı kapı olarak eklenmedi.

| Kimlik | Profil | Ölçüt | Bütçe | Kaynak satırı |
|---|---|---|---:|---|
| `phone-html` | telefon | `admin.html` gzip | 50 KB | Compressed initial HTML |
| `phone-js` | telefon | tüm JS gzip | 120 KB | Complete phone initial-route JS |
| `phone-css` | telefon | tüm rota CSS'i gzip | 35 KB | Phone profile CSS |
| `phone-capability` | telefon | yetenek kaynağı isteği | 0 istek | Unnecessary capability-specific resources |
| `phone-transfer` | telefon | aktarım toplamı | 500 KB | Initial transfer, excluding user content |
| `wide-js` | geniş | JS gzip, antd sınıfı hariç | 180 KB | Complete desktop initial-route JS |
| `wide-antd` | geniş | JS gzip, yalnız antd sınıfı | 84410 B | Ölçülmüş istisna (aşağıda) |

Seçilmeyen satırlar ve gerekçeleri:

| Satır | Neden seçilmedi |
|---|---|
| Tablet initial-route JS 150 KB | Tablet ve masaüstü aynı kaynak kümesini alır. Tek geniş bütçe (180 KB) görev kararıdır. 150 KB ayrı ölçülemez. Tabletlere özel bir ayrım gelirse eklenir. |
| Critical CSS 8 KB, capability bootstrap 4 KB, phone interaction JS 30 KB | Derlemede bu kesitler ayrı dosya değildir; ölçmek için iç içe sınır tanımı gerekir. `phone-js` ve `phone-css` rota toplamlarıdır, bu kesitleri kapsar. |
| Above-fold imagery 200 KB | Yönetim ilk rotasında görsel yok. |
| Lite/data-saving 250 KB | Yönetimde ayrı bir hafif profil yok. |

`phone-capability` sıfır istek hedefidir. Küçük bir bayt payına çevrilmez.

## Kayıtlı ölçüm (geçiş kesimi sonrası)

Ölçüm 2026-11-02 tarihinde, taban `b061e08` üzerinde geçiş kesimiyle (`PHONE_WITHOUT_ANTD=true`, WideProviders tembel, `ui/antd.ts` yalnız `ConfigProvider`, `App`, `theme` ve `tr_TR`) ve yukarıdaki koşullarla alındı. İlk rota `/genel`. `node scripts/check-delivery.mjs dist --strict` PASS: telefonun statik kapanışında antd, pro, icons, echarts ve wide yok (14 dosya, ham 558675 B, gzip 167963 B).

### Önce ve sonra

Aynı koşullar (`VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098`, Node v24.21.0, Vite 8.3.5). "Önce" sütunları `b061e08` kaynağının kesim öncesi derlemesidir. Önceki kayıt (`67382b9`, ilk rota `/alimlar`) karşılaştırma için ayrıca verilir; o kayıtta antd parçası tüm bileşen ihracını taşıyordu (233210 B).

| Ölçüt | `67382b9` kaydı (`/alimlar`) | Önce, `b061e08` (`/alimlar`) | Önce, `b061e08` (`/genel`) | Sonra, kesim (`/genel`) | Bütçe |
|---|---:|---:|---:|---:|---:|
| Telefon statik kapanış gzip | 409850 B | 258728 B | 258728 B | 167963 B | — |
| `phone-html` | 830 B | 2139 B | 2139 B | 2097 B | 50000 B |
| `phone-js` | 410050 B | 303883 B | 260974 B | 170163 B | 120000 B |
| `phone-css` | 13467 B | 26505 B | 9789 B | 9789 B | 35000 B |
| `phone-capability` | 2 istek | 2 istek | 2 istek | 0 istek | 0 istek |
| `phone-transfer` | 520531 B | 428711 B | 369086 B | 278233 B | 500000 B |
| `wide-js` (antd hariç) | 176840 B | 280648 B | 280648 B | 280464 B | 180000 B |
| `wide-antd` | 233210 B | 84404 B | 84404 B | 84410 B | 84410 B (istisna) |

Kesimin telefona etkisi (`/genel`): JS −90811 B (antd 84404 B, icons 3608 B, babel-runtime 1873 B ve antd yüzeyinin giriş kodu), aktarım −90853 B, yetenek isteği 2 → 0. Geniş profilin ilk rotası neredeyse aynıdır: antd ve icons artık statik kapanış yerine tembel WideProviders kökünden gelir (+1177 B WideProviders parçası). `wide-js` kesim öncesinde de bütçeyi aşıyordu ve tavanı yoktu (ratchet FAIL); aşım kesimden değil, tek `wide` grubunun statik kapanışından gelir (aşağıda).

### Telefon ilk rota

23 dosya, aktarım 278233 B.

| Tür | Dosya | Ham B | Gzip B | Aktarım B |
|---|---:|---:|---:|---:|
| html | 1 | 6077 | 2097 | 2097 |
| js | 14 | 543656 | 170163 | 170163 |
| css | 6 | 48986 | 9789 | 9789 |
| font | 2 | 96184 | 54005 | 96184 |

| Bölüm | Dosya | Ham B | Gzip B |
|---|---:|---:|---:|
| `admin.html` | 1 | 6077 | 2097 |
| Statik kapanış (JS + CSS) | 14 | 558675 | 167963 |
| İlk sayfa (`GenelPage` + `AccordionList`, `Money`) | 6 | 33967 | 11989 |
| İlk ekran fontu (`outfit-regular.ttf`, `outfit-bold.ttf`) | 2 | 96184 | 54005 |

Parça başına gzip baytı (JS):

| Parça | Sınıf | Gzip B | Not |
|---|---|---:|---|
| `chunk:shared` | shared | 69276 | React, ReactDOM, scheduler, wouter hash kancası |
| `admin.html` girişi | entry | 38100 | ortak kabuk ve ui bileşenleri girişte |
| `chunk:data` | app | 30490 | veri katmanı; zod |
| `chunk:icons` | app | 7818 | Phosphor simgeleri (`ui/icons`); antd `icons` sınıfı değil |
| `chunk:X.es` | app | 6764 | Phosphor modülleri, idb-keyval |
| `src/admin/pages/GenelPage.tsx` | page | 6641 | ilk sayfa |
| `chunk:tokens` | tokens | 2330 | |
| `chunk:router` | router | 2088 | |
| `chunk:AccordionList` | app | 1649 | ilk sayfa kapanışı |
| `chunk:loader` | app | 1396 | uyarlamalı yükleyici |
| `chunk:Button` | app | 1089 | |
| `chunk:Money` | app | 1049 | ilk sayfa kapanışı |
| `chunk:context` | app | 1044 | profil bağlamı |
| `chunk:rolldown-runtime` | app | 429 | |

### Geniş ilk rota

71 dosya, aktarım 498152 B. Geniş başlangıç kökleri: `chunk:wide` ve `src/admin/adaptive/WideProviders.tsx` (48 dosya, ham 664784 B, gzip 219919 B). antd hariç JS 280464 B, antd 84410 B.

Geniş başlangıcın en büyük JS parçaları: `chunk:antd` 84410 B, `chunk:ui` 13248 B, `chunk:wide` 9595 B, sekiz sayfa parçası toplam 54123 B (`AlimlarPage` 9457 B, `ProjelerPage` 7804 B, `SozluklerPage` 7630 B, `OdemelerPage` 6655 B, `ButcePage` 6288 B, `TaraflarPage` 6188 B, `EvPage` 5825 B, `HesaplarPage` 4276 B), `chunk:Select` 4627 B, `chunk:icons` (antd simgeleri) 3608 B, `chunk:babel-runtime` 1877 B, `WideProviders` 1177 B.

### Bütçe durumu

| Kimlik | Ölçüm | Bütçe | Ratchet tavanı | Ratchet | Strict |
|---|---:|---:|---:|---|---|
| `phone-html` | 2097 B | 50000 B | — | PASS | PASS |
| `phone-js` | 170163 B | 120000 B | 170163 B | RATCHET | FAIL |
| `phone-css` | 9789 B | 35000 B | — | PASS | PASS |
| `phone-capability` | 0 istek | 0 istek | — | PASS | PASS |
| `phone-transfer` | 278233 B | 500000 B | — | PASS | PASS |
| `wide-js` | 280464 B | 180000 B | 280464 B | RATCHET | FAIL |
| `wide-antd` | 84410 B | 84410 B | — | PASS | PASS |

Sonuç: ratchet PASS (2 bütçe kayıtlı tavanında, uyarı yok). `--strict` FAIL (`phone-js`, `wide-js`). Tavanlar ve istisna kayıtlı ölçümün aynısıdır, pay içermez; `budgets.json` `measured` alanı ölçümü taşır ve `check-budgets.test.mjs` eşitliği doğrular. `phone-capability` ve `phone-transfer` tavanları silindi: sıfır yetenek isteği ratchet modunda da zorunludur.

## antd istisnası

antd parçası (`antd` codeSplitting grubu: antd, `@ant-design/*`, `@rc-component/*`, cssinjs yardımcıları) kesimden sonra 84410 B gzip'tir. `ui/antd.ts` artık yalnız `ConfigProvider`, `App` (`AntApp`), `theme` ve `tr_TR` verir; hiçbir ui sarmalayıcısı antd kullanmaz. Parçayı yalnız geniş profilin tembel sağlayıcısı (`adaptive/WideProviders.tsx`) getirir. Geniş profilde ürünün seçtiği UI ailesinin sağlayıcısı olduğu için `wide-js` bütçesinden çıkarılır ve `wide-antd` olarak ayrı ölçülür.

- İstisna 84410 B'dir: kayıtlı ölçümün aynısı, pay yok. Önceki 240000 B kaydı (233210 B ölçüm artı 6790 B pay) tüm bileşen ihracı içindi ve kesimle geçersiz oldu. İstisnayı aşmak ya da yükseltmek entegrasyon sahibinin açık kararıdır.
- `icons` ve `pro` istisna değildir. `icons` (antd simgeleri, 3608 B) geniş profilde `wide-js` içinde sayılır; `pro` artık hiçbir parçada yok.
- Telefonda istisna yoktur. antd telefonda yetenek kaynağıdır (`phone-capability`) ve kesimden sonra telefon onu hiç istemez.

## Ratchet, strict ve geçiş

Varsayılan mod ratchet'tir. Bütçeyi aşan bir ölçüm, `ratchet.ceilings` içinde kayıtlı tavanı aşmıyorsa geçer (`RATCHET`). Tavanı olmayan ya da tavanı aşan ölçüm FAIL olur. Tavan yalnız düşer:

- Komut "daraltılabilir: tavan X → Y" derse tavanı Y'ye indirin.
- Ölçüm bütçeye inince komut "silinebilir" der; kaydı silin.
- Tavanı yükseltmek ya da yeni tavan eklemek bütçeyi gevşetir. Bu yalnız entegrasyon sahibinin açık kararıyla yapılır.
- Bütçe dosyası doğrulaması, bütçeden küçük ya da ona eşit bir tavanı reddeder.

`--strict` tavanları yok sayar. Her bütçe aşımı FAIL olur. Tavan listesi boşalınca kapı `--strict` ile koşar.

Geçiş kesimi (x-cut) yapıldı: `PHONE_WITHOUT_ANTD=true`, `scripts/delivery-baseline.json` boş ve `check-delivery --strict` PASS; `phone-capability` ve `phone-transfer` tavanları silindi, `phone-js` tavanı 410050 → 170163 B indi, `wide-js` için kesim sonrası ölçüm (280464 B) entegrasyonun kararıyla tavan olarak kaydedildi. Kalan açıklar:

1. `phone-js` 120 KB'ın 50163 B üstünde. Aday kaynaklar:
   - `chunk:data` (30490 B, büyük kısmı zod): ilk ekranda zorunlu olmayan doğrulama sonraya alınabilir.
   - `admin.html` girişi (38100 B): ortak kabuk ve ilk ekranda görünmeyen ui bileşenleri (diyalog, alt sayfa, menü) tembel yapılabilir.
   - `chunk:icons` (7818 B) ve `chunk:X.es` (6764 B): Phosphor simgeleri; yalnız ilk ekranın simgeleri statik kalabilir.
   - `shared` (69276 B): React ve ReactDOM'un taban maliyeti. Bütçeyle uyuşmazsa bu, bütçe değişikliği olarak açıkça kararlaştırılır; sessizce gevşetilmez.
2. `wide-js` 180 KB'ın 100464 B üstünde. Ana neden tek `wide` codeSplitting grubudur: bütün `*.wide` modülleri tek parçadadır ve sayfa modüllerini statik içe aktardıkları için geniş ilk rota sekiz sayfa parçasını (54123 B) ve onların ortak bileşenlerini önceden indirir. Grubu sayfa başına bölmek (`vite.config.ts`, entegrasyon) bu payın büyük kısmını kaldırır. İkinci aday antd'nin kendisidir: kesimden sonra hiçbir bileşen antd kullanmadığından WideProviders'ın geniş profilde getirdiği 84410 B antd + 3608 B icons + 1877 B babel-runtime yalnız sağlayıcı içindir; sağlayıcıyı kaldırmak ürün kararıdır.

## Rapor

`dist/budget-report.json` (schema 1) şu alanları taşır:

- `entry`, `mode` (`ratchet` | `strict`), `status` (`pass` | `fail`).
- `measurement`: gzip seviyesi, KB tabanı, ham, gzip ve aktarım tanımları, önbellek, veri, kapsam, kaynaklar.
- `base`: yayın tabanı, `admin.html` giriş script'inden çıkarılır.
- `firstRoute`: `{path, page}`.
- `profiles.phone` ve `profiles.wide`, her biri şunlarla:
  - `files[{file, kind, part, label, class, contains, capability, raw, gzip, transfer}]`;
  - `totals{html, js, css, font, all}` ve `byPart{html, static, page, wide?, font}`;
  - `capability{requests, raw, gzip, files, classes}` ve `withoutCapability.js`;
  - telefonda `firstPage`, geniş profilde `startupRoots`.
- `budgets[{id, profile, metric, classes, unit, max, ceiling, measured, status, exception, source}]`.
- `warnings[]`, `budgetsFile`.

Rapor mutlak yol taşımaz. `delivery-report.json` gibi `dist` içinde durur. `check-dist-privacy` bu raporla 0 bulgu verdi.

## Doğrulama

- `node --test scripts/check-budgets.test.mjs` ve `pnpm exec vitest run scripts/check-budgets.test.mjs` sentetik manifest, graph ve delivery-report kullanır. Kapsanan konular: rota kümeleri, font çözümleme, yetenek kaynağı (tembel ilk sayfa ve karma parça dahil), ratchet ve strict, bütçe dosyası doğrulaması, CLI çıkış kodları ve mutlak yolsuz rapor. Ayrıca `budgets.json` aday değerleri, ilk rotanın `navigation.ts` ile `routes.tsx`'e uyumu (iki yazım biçimi için çözümleyici testleriyle) ve kesim sonrası tavan sözleşmesi (yetenek ve aktarım tavanı yok; tavanlar ve antd istisnası kayıtlı ölçüme eşit) test edilir.
- Gerçek ölçüm: yukarıdaki komut sırası. Bu belgedeki sayılar o çıktıdan alındı.
