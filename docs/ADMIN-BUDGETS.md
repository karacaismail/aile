# Yönetim paneli aktarım bütçesi

Bu belge `admin.html` girişinin ilk rotası için profil bazlı aktarım bütçesini tanımlar. Ölçüm üretim derlemesinden yapılır, tarayıcıdan değil. Komut `scripts/check-budgets.mjs`, bütçe dosyası `scripts/budgets.json`, birim testleri `scripts/check-budgets.test.mjs`. Teslim kapısı (`scripts/check-delivery.mjs`) hangi sınıfın telefona girmemesi gerektiğini söyler; bu kapı aynı derlemenin kaç bayt indirdiğini söyler.

## Komut sırası

```sh
VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 pnpm build
node scripts/check-delivery.mjs dist            # dist/delivery-report.json üretir
node scripts/check-budgets.mjs dist             # ratchet modu
node scripts/check-budgets.mjs dist --strict    # kesim sonrası, tavan listesi boşalınca
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
| Birim | Rapor alanları bayttır. Bütçeler KB cinsinden okunur ve **1 KB = 1000 B** sayılır (120 KB = 120000 B). `check-delivery` özeti KiB (1024 B) yazar. Vite'ın derleme çıktısındaki kB 1000 B'dir, ama kendi gzip ayarıyla hesaplanır; bu sayılarla karşılaştırılamaz (antd: Vite 235,59 kB, bu kapı 233210 B). |
| Önbellek | Soğuk: HTTP önbelleği ve service worker yok. Her dosya bir istektir ve bir kez sayılır. Yönetim parçaları zaten ön belleğe alınmaz. Ana uygulamayla paylaşılan `shared` parçası, ana uygulamayı ziyaret etmiş bir cihazda ön bellekte olabilir. Bütçe yine de onu sayar. |
| Veri | Derleme veriden bağımsızdır. Nesil (sentetik ya da gerçek) ve e-tablo istekleri kullanıcı içeriğidir; sayılmaz. Kayıtlı ölçüm `VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098` ile alınan derlemedendir. Kimlik derlemeye gömülür. Başka bir kimlik birkaç bayt fark yaratır ve tam tavanlı bir ratchet'i düşürebilir. Bu yüzden kapı yalnız sentetik kimlikle derlenmiş çıktı üzerinde koşar. |
| Araçlar | Node v24.21.0, Vite 8.3.5 (rolldown), taban `67382b9`. Farklı bir Node zlib sürümü gzip baytını birkaç bayt oynatabilir. Sürüm değişince ölçümü yeniden kaydedin. |
| Donanım | Ölçüm statiktir; cihaz, ağ ve CPU içermez. Gerçek istek kümesini `e02-production` üretim ağ yalıtımı testi doğrular. Gerçek cihaz ölçümü yoktur (`not_run`). |
| Hariç | favicon (`icon.svg`), görseller, veri istekleri, sonradan açılan sayfalar ve yetenekler. |

## Rota tanımları

**İlk sayfa.** `budgets.json` içindeki `firstRoute`, varsayılan yönetim rotasıdır: `/alimlar` → `src/admin/pages/AlimlarPage.tsx`. Test, bu değerin `shell/navigation.ts` içindeki `defaultAdminPath` ve `routes.tsx` sayfa importuyla eşleştiğini doğrular. Sayfa `admin.html` statik kapanışından dinamik import ile erişilmiyorsa komut 2 ile çıkar.

**Telefon ilk rota** şu dosyalardan oluşur:

- `admin.html` (içine gömülü başlangıç betiği dahil).
- Girişin statik kapanışı: manifest `imports` zinciri, `check-delivery` ile aynı hesap.
- İlk sayfanın statik kapanışından, statik kapanışta olmayan parçalar.
- Bu parçaların `css[]` dosyaları.
- İlk ekran fontları. Rota CSS'indeki her `@font-face` kuralında `src` listesinin ilk `url()`'si sayılır, çünkü tarayıcı ilk desteklenen biçimi indirir. Bunlara `admin.html` içindeki `<link rel="preload" as="font">` adresleri eklenir. `data:` URL'ler CSS baytının içindedir. Mutlak adres yayın tabanından (`/aile/`), göreli adres CSS dosyasının klasöründen çözülür. Bugün Outfit'in iki yüzü sayılır: 400–500 gövde, 600–800 başlık. İlk ekranda ikisi de kullanılır.

**Geniş ilk rota** (tablet ve masaüstü), telefon ilk rotasına geniş başlangıç köklerinin statik kapanışını ekler. Bu kökler telefon rotasından dinamik import ile zincirleme erişilir ve şu iki koşuldan biriyle eşleşir:

- kaynağı `wideStartup.sources` içindedir (`src/admin/adaptive/WideProviders.tsx`);
- delivery-report sınıfı `wideStartup.classes` içindedir (`wide`).

Diğer sayfalar ve ECharts ilk rotada sayılmaz. Bugün `PHONE_WITHOUT_ANTD=false` olduğundan WideProviders statiktir ve henüz `wide` parçası yoktur. Bu yüzden bugün geniş rota telefon rotasına eşittir. Tablet ve masaüstü aynı geniş kaynak kümesini alır: `lazyWide` iki profili ayırmaz.

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
| `wide-antd` | geniş | JS gzip, yalnız antd sınıfı | 240 KB | Ölçülmüş istisna (aşağıda) |

Seçilmeyen satırlar ve gerekçeleri:

| Satır | Neden seçilmedi |
|---|---|
| Tablet initial-route JS 150 KB | Tablet ve masaüstü aynı kaynak kümesini alır. Tek geniş bütçe (180 KB) görev kararıdır. 150 KB ayrı ölçülemez. Tabletlere özel bir ayrım gelirse eklenir. |
| Critical CSS 8 KB, capability bootstrap 4 KB, phone interaction JS 30 KB | Derlemede bu kesitler ayrı dosya değildir; ölçmek için iç içe sınır tanımı gerekir. `phone-js` ve `phone-css` rota toplamlarıdır, bu kesitleri kapsar. |
| Above-fold imagery 200 KB | Yönetim ilk rotasında görsel yok. |
| Lite/data-saving 250 KB | Yönetimde ayrı bir hafif profil yok. |

`phone-capability` sıfır istek hedefidir. Küçük bir bayt payına çevrilmez.

## Bugünkü ölçüm

Ölçüm 2026-11-02 tarihinde, taban `67382b9` üzerinde ve yukarıdaki koşullarla alındı. İlk rota `/alimlar`.

### Telefon ilk rota

21 dosya, aktarım 520531 B.

| Tür | Dosya | Ham B | Gzip B | Aktarım B |
|---|---:|---:|---:|---:|
| html | 1 | 2541 | 830 | 830 |
| js | 14 | 1311011 | 410050 | 410050 |
| css | 4 | 88180 | 13467 | 13467 |
| font | 2 | 96184 | 54005 | 96184 |

| Bölüm | Dosya | Ham B | Gzip B |
|---|---:|---:|---:|
| `admin.html` | 1 | 2541 | 830 |
| Statik kapanış (JS + CSS) | 12 | 1363293 | 409850 |
| İlk sayfa (`AlimlarPage` + `views`, `QueryBar`, `contracts`) | 6 | 35898 | 13667 |
| İlk ekran fontu (`outfit-regular.ttf`, `outfit-bold.ttf`) | 2 | 96184 | 54005 |

Parça başına gzip baytı (JS):

| Parça | Sınıf | Gzip B | Not |
|---|---|---:|---|
| `chunk:antd` | antd | 233210 | yetenek kaynağı; `ui/antd.ts` ve `QueryBar` statik çeker |
| `chunk:shared` | shared | 69276 | React, ReactDOM, scheduler, wouter hash kancası |
| `chunk:PageHeader` | app | 40957 | ortak kabuk: 77 proje modülü, 20 Phosphor modülü, zod, ulid |
| `chunk:data` | app | 30440 | veri katmanı; 18 zod modülü |
| `src/admin/pages/AlimlarPage.tsx` | page | 7952 | ilk sayfa |
| `chunk:icons` | icons | 6785 | yetenek kaynağı; antd üzerinden |
| `chunk:X.es` | app | 6704 | 28 Phosphor modülü, idb-keyval |
| `admin.html` girişi | entry | 5809 | |
| `chunk:QueryBar` | app | 2848 | ilk sayfa kapanışı; antd'yi statik çeker |
| `chunk:tokens` | tokens | 2108 | |
| `chunk:router` | router | 2088 | |
| `chunk:views` | app | 1284 | |
| `chunk:rolldown-runtime` | app | 429 | |
| `chunk:contracts` | app | 160 | |

### Geniş ilk rota

Bugün telefon rotasına eşittir: 21 dosya, aktarım 520531 B, geniş başlangıç kökü yok. antd hariç JS 176840 B, antd 233210 B.

### Bütçe durumu

| Kimlik | Ölçüm | Bütçe | Ratchet tavanı | Ratchet | Strict |
|---|---:|---:|---:|---|---|
| `phone-html` | 830 B | 50000 B | — | PASS | PASS |
| `phone-js` | 410050 B | 120000 B | 410050 B | RATCHET | FAIL |
| `phone-css` | 13467 B | 35000 B | — | PASS | PASS |
| `phone-capability` | 2 istek | 0 istek | 2 | RATCHET | FAIL |
| `phone-transfer` | 520531 B | 500000 B | 520531 B | RATCHET | FAIL |
| `wide-js` | 176840 B | 180000 B | — | PASS | PASS |
| `wide-antd` | 233210 B | 240000 B | — | PASS | PASS |

Sonuç: ratchet PASS (3 bütçe kayıtlı tavanında). `--strict` FAIL; kesimden önce bu beklenir.

## antd istisnası

antd parçası (`antd` codeSplitting grubu: antd, `@ant-design/*`, `@rc-component/*`, cssinjs yardımcıları) bugün 233210 B gzip'tir. Vite aynı parçayı ~236 kB yazar. Tek başına 180 KB'lık geniş JS bütçesini aşar. Geniş profilde ürünün seçtiği UI ailesidir (Ant Design ve Pro). Bu yüzden `wide-js` bütçesinden çıkarılır ve `wide-antd` olarak ayrı ölçülür.

- Tavan 240000 B'dir: bugünkü ölçüm artı geniş bileşenlerin ekleyeceği antd kullanımı için 6790 B açık pay. Tavanı aşmak ya da yükseltmek entegrasyon sahibinin açık kararıdır.
- `icons` ve `pro` istisna değildir. Geniş profilde `wide-js` içinde sayılırlar.
- Telefonda istisna yoktur. antd telefonda yetenek kaynağıdır (`phone-capability`) ve kesimle telefondan çıkar.

## Ratchet, strict ve geçiş

Varsayılan mod ratchet'tir. Bütçeyi aşan bir ölçüm, `ratchet.ceilings` içinde kayıtlı tavanı aşmıyorsa geçer (`RATCHET`). Tavanı olmayan ya da tavanı aşan ölçüm FAIL olur. Tavan yalnız düşer:

- Komut "daraltılabilir: tavan X → Y" derse tavanı Y'ye indirin.
- Ölçüm bütçeye inince komut "silinebilir" der; kaydı silin.
- Tavanı yükseltmek ya da yeni tavan eklemek bütçeyi gevşetir. Bu yalnız entegrasyon sahibinin açık kararıyla yapılır.
- Bütçe dosyası doğrulaması, bütçeden küçük ya da ona eşit bir tavanı reddeder.

`--strict` tavanları yok sayar. Her bütçe aşımı FAIL olur. Tavan listesi boşalınca kapı `--strict` ile koşar.

Entegrasyon (W2) için sıra:

1. Dalları birleştirdikten sonra ve kesimden önce telefon baytları büyüyebilir. Bütçe kapısı plan gereği kesimden sonra koşar.
2. `PHONE_WITHOUT_ANTD` açılır ve `ui/antd.ts` telefondan çıkar. Beklenen etki:
   - `phone-js` yetenek sınıfları olmadan ölçülür. Bugünkü değer 170055 B'dir, ama W1 dallarının eklediği kod bu sayıyı değiştirir.
   - `phone-transfer` yaklaşık 240 KB düşer.
3. Kesimden sonra `phone-capability` 0 olmalıdır. `QueryBar` bugün ilk sayfa kapanışında antd'yi statik çekiyor (`b03-filters`). Kesimden hemen sonra `phone-capability` tavanını silin. Böylece sıfır hedefi ratchet modunda da zorunlu olur. `e02-production` ağ testi de aynı sıfırı ister.
4. `phone-js` ve `phone-transfer` tavanlarını komutun önerdiği yeni ölçüme indirin.
5. `phone-js` kesimden sonra da 120 KB'ın üstünde kalır. Kalan açık ~50 KB'tır. Aday kaynaklar:
   - `chunk:data` (30440 B, büyük kısmı zod): ilk ekranda zorunlu olmayan doğrulama sonraya alınabilir.
   - `chunk:PageHeader` (40957 B) ve `chunk:X.es` (6704 B): ortak kabuk ve Phosphor ikonları.
   - `shared` (69276 B): React ve ReactDOM'un taban maliyeti. Bütçeyle uyuşmazsa bu, bütçe değişikliği olarak açıkça kararlaştırılır; sessizce gevşetilmez.
6. Geniş rota bayrak açılınca WideProviders kapanışını ve `wide` parçasını ilk rotaya ekler. `wide-js` bugün 180 KB'a 3160 B uzaklıktadır. Geniş bileşenler bu payı aşarsa kapı FAIL olur. Bu durumda karar entegrasyon sahibindedir: azaltma ya da açık bir tavan.

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

- `node --test scripts/check-budgets.test.mjs` ve `pnpm exec vitest run scripts/check-budgets.test.mjs` sentetik manifest, graph ve delivery-report kullanır. Kapsanan konular: rota kümeleri, font çözümleme, yetenek kaynağı (tembel ilk sayfa ve karma parça dahil), ratchet ve strict, bütçe dosyası doğrulaması, CLI çıkış kodları ve mutlak yolsuz rapor. Ayrıca `budgets.json` aday değerleri ve ilk rotanın `navigation.ts` ile `routes.tsx`'e uyumu da test edilir.
- Gerçek ölçüm: yukarıdaki komut sırası. Bu belgedeki sayılar o çıktıdan alındı.
