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
| Araçlar | Node v24.21.0, Vite 8.3.5 (rolldown), taban `0a8d903` + `t3-root` (önceki kayıt: `b061e08` + geçiş kesimi). Farklı bir Node zlib sürümü gzip baytını birkaç bayt oynatabilir. Sürüm değişince ölçümü yeniden kaydedin. |
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

- kaynağı `wideStartup.sources` içindedir (bugün boş);
- delivery-report sınıfı `wideStartup.classes` içindedir (`wide`).

Diğer sayfalar ve ECharts ilk rotada sayılmaz. `t3-root` sonrası antd sağlayıcısı (`adaptive/WideProviders.tsx`) geniş başlangıç kökü değildir: uygulama ağacını hiçbir profilde sarmaz, yalnız `lazyWide(…, { antd: true })` ile tanımlanmış bir ada geniş profilde render edilince iner ve bugün böyle ada yoktur. Derlemede tembel kök olarak durur (yükleyiciden dinamik import; antd, icons ve babel-runtime parçalarıyla), ama hiçbir profilde istenmez; bu yüzden `wideStartup.sources` boştur. Tek geniş başlangıç kökü `wide` grubudur. Bu grup bütün `*.wide` modüllerini taşır ve onlar sayfa modüllerini statik içe aktardığı için statik kapanışı sekiz sayfa parçasını (Alımlar, Projeler, Sözlükler, Ödemeler, Bütçe, Taraflar, Ev, Hesaplar) ve ortak geniş bileşenleri (Select, Dialog, Tabs, ResponsiveTable, Chart kabuğu, Overview, QueryBar, FilterDrawer) da ilk rotaya ekler. Tablet ve masaüstü aynı geniş kaynak kümesini alır: `lazyWide` iki profili ayırmaz.

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
| `wide-antd` | geniş | JS gzip, yalnız antd sınıfı | 0 B | Ölçülmüş istisna, `t3-root` sonrası kapalı (aşağıda) |

Seçilmeyen satırlar ve gerekçeleri:

| Satır | Neden seçilmedi |
|---|---|
| Tablet initial-route JS 150 KB | Tablet ve masaüstü aynı kaynak kümesini alır. Tek geniş bütçe (180 KB) görev kararıdır. 150 KB ayrı ölçülemez. Tabletlere özel bir ayrım gelirse eklenir. |
| Critical CSS 8 KB, capability bootstrap 4 KB, phone interaction JS 30 KB | Derlemede bu kesitler ayrı dosya değildir; ölçmek için iç içe sınır tanımı gerekir. `phone-js` ve `phone-css` rota toplamlarıdır, bu kesitleri kapsar. |
| Above-fold imagery 200 KB | Yönetim ilk rotasında görsel yok. |
| Lite/data-saving 250 KB | Yönetimde ayrı bir hafif profil yok. |

`phone-capability` sıfır istek hedefidir. Küçük bir bayt payına çevrilmez.

## Kayıtlı ölçüm (t3-root)

Ölçüm 2026-11-02 tarihinde, entegrasyon tabanı `0a8d903` üzerinde `t3-root` değişikliğiyle ve yukarıdaki koşullarla alındı. Değişiklik: antd sağlayıcısı uygulama ağacını hiçbir profilde sarmaz (ilk geniş profilde eklenen sarmalayıcı bütün çalışma alanını yeniden kuruyordu), WideProviders hiçbir profilde yüklenmez, `ui/antd.ts` yalnız `ConfigProvider`, `theme` ve `tr_TR` verir (`App`/`AntApp` ihracı kalktı), `lazyWide` yüklemesi sürerken kök `data-wide-loading` taşır. İlk rota `/genel`. `node scripts/check-delivery.mjs dist --strict` PASS: telefonun statik kapanışında antd, pro, icons, echarts ve wide yok (14 dosya, ham 565282 B, gzip 169816 B).

### Önce ve sonra (t3-root)

"Önce" `0a8d903` kaynağının aynı koşullardaki derlemesidir; kayıtlı `budgets.json` ile `check-budgets` o derlemede FAIL veriyordu (`phone-js` 171608 B, tavan 170163 B).

| Ölçüt | Önce, `0a8d903` | Sonra, `t3-root` | Fark | Bütçe |
|---|---:|---:|---:|---:|
| Telefon statik kapanış gzip | 169650 B | 169816 B | +166 B | — |
| `phone-html` | 2097 B | 2097 B | 0 | 50000 B |
| `phone-js` | 171608 B | 171767 B | +159 B | 120000 B |
| `phone-css` | 10210 B | 10210 B | 0 | 35000 B |
| `phone-capability` | 0 istek | 0 istek | 0 | 0 istek |
| `phone-transfer` | 280099 B | 280258 B | +159 B | 500000 B |
| `wide-js` (antd hariç) | 277672 B | 275959 B | −1713 B | 180000 B |
| `wide-antd` | 37209 B | 0 B | −37209 B | 0 B (istisna kapandı) |
| Geniş ilk rota | 71 dosya, aktarım 448176 B | 67 dosya, aktarım 409254 B | −4 dosya, −38922 B | — |
| Geniş başlangıç kökleri | `chunk:wide`, `WideProviders.tsx` | `chunk:wide` | — | — |

Telefon +159 B: giriş parçası −319 B (App.tsx'teki tembel sağlayıcı kaynağı ve AdaptiveRoot sağlayıcı geçidi kalktı), `chunk:loader` +485 B (uçuştaki geniş yükleme sayacı ve `useWideLoading`, `lazyWide` antd adası seçeneği; WideProviders'ın dinamik importu girişten yükleyiciye taşındı), sayfa parçaları −7 B. Geniş ilk rota artık antd (37209 B), icons (139 B), babel-runtime (486 B) ve WideProviders (1220 B) parçalarını istemez.

Tavanlar ölçüme sabitlendi, pay yok: `phone-js` 170163 → 171767 B, `wide-js` 280464 → 275959 B, `wide-antd` istisnası 84410 → 0 B. `phone-js` tavanının yükselmesi entegrasyonun açık kararıdır (görev t3-root: "tavanları ölçülen değerlere sabitle"); artışın 1445 B'ı x-cut kaydından `0a8d903`'e kadar birleşen görevlerden, 159 B'ı bu görevden gelir.

## Önceki kayıt: geçiş kesimi (x-cut)

Ölçüm 2026-11-02 tarihinde, taban `b061e08` üzerinde geçiş kesimiyle (`PHONE_WITHOUT_ANTD=true`, WideProviders tembel, `ui/antd.ts` yalnız `ConfigProvider`, `App`, `theme` ve `tr_TR`) ve yukarıdaki koşullarla alındı. İlk rota `/genel`. `node scripts/check-delivery.mjs dist --strict` PASS: telefonun statik kapanışında antd, pro, icons, echarts ve wide yok (14 dosya, ham 558675 B, gzip 167963 B).

### Önce ve sonra (x-cut)

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

## Güncel ölçüm ayrıntısı (t3-root)

### Telefon ilk rota

23 dosya, aktarım 280258 B.

| Tür | Dosya | Ham B | Gzip B | Aktarım B |
|---|---:|---:|---:|---:|
| html | 1 | 6077 | 2097 | 2097 |
| js | 14 | 547685 | 171767 | 171767 |
| css | 6 | 51899 | 10210 | 10210 |
| font | 2 | 96184 | 54005 | 96184 |

| Bölüm | Dosya | Ham B | Gzip B |
|---|---:|---:|---:|
| `admin.html` | 1 | 6077 | 2097 |
| Statik kapanış (JS + CSS) | 14 | 565282 | 169816 |
| İlk sayfa (`GenelPage` + `AccordionList`, `Money`) | 6 | 34302 | 12161 |
| İlk ekran fontu (`outfit-regular.ttf`, `outfit-bold.ttf`) | 2 | 96184 | 54005 |

Parça başına gzip baytı (JS):

| Parça | Sınıf | Gzip B | Not |
|---|---|---:|---|
| `chunk:shared` | shared | 69276 | React, ReactDOM, scheduler, wouter hash kancası |
| `admin.html` girişi | entry | 39052 | ortak kabuk ve ui bileşenleri girişte |
| `chunk:data` | app | 30490 | veri katmanı; zod |
| `chunk:icons` | app | 7818 | Phosphor simgeleri (`ui/icons`); antd `icons` sınıfı değil |
| `chunk:X.es` | app | 6764 | Phosphor modülleri, idb-keyval |
| `src/admin/pages/GenelPage.tsx` | page | 6714 | ilk sayfa |
| `chunk:tokens` | tokens | 2330 | |
| `chunk:router` | router | 2088 | |
| `chunk:loader` | app | 1881 | uyarlamalı yükleyici; hazır sinyali ve antd adası seçeneği dahil |
| `chunk:AccordionList` | app | 1745 | ilk sayfa kapanışı |
| `chunk:Button` | app | 1089 | |
| `chunk:Money` | app | 1047 | ilk sayfa kapanışı |
| `chunk:context` | app | 1044 | profil bağlamı |
| `chunk:rolldown-runtime` | app | 429 | |

### Geniş ilk rota

67 dosya, aktarım 409254 B. Geniş başlangıç kökü: `chunk:wide` (44 dosya, ham 397716 B, gzip 128996 B). antd hariç JS 275959 B, antd 0 B.

Geniş başlangıcın en büyük JS parçaları: `chunk:ui` 13491 B, `chunk:wide` 9563 B, sekiz sayfa parçası toplam 54368 B (`AlimlarPage` 9732 B, `ProjelerPage` 7800 B, `SozluklerPage` 7625 B, `OdemelerPage` 6649 B, `ButcePage` 6289 B, `TaraflarPage` 6183 B, `EvPage` 5817 B, `HesaplarPage` 4273 B), `chunk:Select` 4408 B, `chunk:Dialog` 3340 B, `chunk:Tabs` 3175 B, `chunk:ResponsiveTable` 2779 B, `chunk:Chart` 2679 B, `chunk:Overview` 2493 B.

### Bütçe durumu

| Kimlik | Ölçüm | Bütçe | Ratchet tavanı | Ratchet | Strict |
|---|---:|---:|---:|---|---|
| `phone-html` | 2097 B | 50000 B | — | PASS | PASS |
| `phone-js` | 171767 B | 120000 B | 171767 B | RATCHET | FAIL |
| `phone-css` | 10210 B | 35000 B | — | PASS | PASS |
| `phone-capability` | 0 istek | 0 istek | — | PASS | PASS |
| `phone-transfer` | 280258 B | 500000 B | — | PASS | PASS |
| `wide-js` | 275959 B | 180000 B | 275959 B | RATCHET | FAIL |
| `wide-antd` | 0 B | 0 B | — | PASS | PASS |

Sonuç: ratchet PASS (2 bütçe kayıtlı tavanında, uyarı yok). `--strict` FAIL (`phone-js`, `wide-js`). Tavanlar ve istisna kayıtlı ölçümün aynısıdır, pay içermez; `budgets.json` `measured` alanı ölçümü taşır ve `check-budgets.test.mjs` eşitliği doğrular. `phone-capability` ve `phone-transfer` tavanları silindi: sıfır yetenek isteği ratchet modunda da zorunludur.

## antd istisnası

antd parçası (`antd` codeSplitting grubu: antd, `@ant-design/*`, `@rc-component/*`, cssinjs yardımcıları) derlemede 37209 B gzip'tir. `ui/antd.ts` yalnız `ConfigProvider`, `theme` ve `tr_TR` verir; hiçbir ui sarmalayıcısı antd kullanmaz. `t3-root` sonrası parçayı hiçbir profil istemez: antd sağlayıcısı (`adaptive/WideProviders.tsx`) uygulama ağacını sarmaz, yalnız `lazyWide(…, { antd: true })` adası geniş profilde render edilince iner. Bugün böyle ada yoktur. Parça yükleyiciden tembel erişilen bir kök olarak derlemede kalır; teslim kapısı ve üretim ağ testleri antd sınıfını gerçek bir parça üzerinde sınamaya devam eder.

- İstisna 0 B'dir (kapandı): kayıtlı ölçümün aynısı, pay yok. Önceki kayıtlar 84410 B (x-cut: WideProviders geniş başlangıç kökü) ve 240000 B (tüm bileşen ihracı) idi. antd'yi geniş ilk rotaya geri getiren bir ada entegrasyon sahibinin açık kararı ve yeni ölçüm ister; istisna o gün ölçümle yeniden açılır.
- `icons` ve `pro` istisna değildir. antd simgeleri (`icons`, 139 B) ve `babel-runtime` (486 B) yalnız antd parçasıyla gelir, geniş ilk rotada yoktur; `pro` hiçbir parçada yok.
- Telefonda istisna yoktur. antd telefonda yetenek kaynağıdır (`phone-capability`) ve telefon onu hiç istemez.

## Ratchet, strict ve geçiş

Varsayılan mod ratchet'tir. Bütçeyi aşan bir ölçüm, `ratchet.ceilings` içinde kayıtlı tavanı aşmıyorsa geçer (`RATCHET`). Tavanı olmayan ya da tavanı aşan ölçüm FAIL olur. Tavan yalnız düşer:

- Komut "daraltılabilir: tavan X → Y" derse tavanı Y'ye indirin.
- Ölçüm bütçeye inince komut "silinebilir" der; kaydı silin.
- Tavanı yükseltmek ya da yeni tavan eklemek bütçeyi gevşetir. Bu yalnız entegrasyon sahibinin açık kararıyla yapılır.
- Bütçe dosyası doğrulaması, bütçeden küçük ya da ona eşit bir tavanı reddeder.

`--strict` tavanları yok sayar. Her bütçe aşımı FAIL olur. Tavan listesi boşalınca kapı `--strict` ile koşar.

Geçiş kesimi (x-cut) yapıldı: `PHONE_WITHOUT_ANTD=true`, `scripts/delivery-baseline.json` boş ve `check-delivery --strict` PASS; `phone-capability` ve `phone-transfer` tavanları silindi, `phone-js` tavanı 410050 → 170163 B indi, `wide-js` için kesim sonrası ölçüm (280464 B) entegrasyonun kararıyla tavan olarak kaydedildi. `t3-root` tavanları yeniden ölçüme sabitledi (`phone-js` 171767 B, `wide-js` 275959 B; yukarıda). Kalan açıklar:

1. `phone-js` 120 KB'ın 51767 B üstünde. Aday kaynaklar:
   - `chunk:data` (30490 B, büyük kısmı zod): ilk ekranda zorunlu olmayan doğrulama sonraya alınabilir.
   - `admin.html` girişi (39052 B): ortak kabuk ve ilk ekranda görünmeyen ui bileşenleri (diyalog, alt sayfa, menü) tembel yapılabilir.
   - `chunk:icons` (7818 B) ve `chunk:X.es` (6764 B): Phosphor simgeleri; yalnız ilk ekranın simgeleri statik kalabilir.
   - `shared` (69276 B): React ve ReactDOM'un taban maliyeti. Bütçeyle uyuşmazsa bu, bütçe değişikliği olarak açıkça kararlaştırılır; sessizce gevşetilmez.
2. `wide-js` 180 KB'ın 95959 B üstünde. Ana neden tek `wide` codeSplitting grubudur: bütün `*.wide` modülleri tek parçadadır ve sayfa modüllerini statik içe aktardıkları için geniş ilk rota sekiz sayfa parçasını (54368 B) ve onların ortak bileşenlerini önceden indirir. Grubu sayfa başına bölmek (`vite.config.ts`, entegrasyon) bu payın büyük kısmını kaldırır. antd artık geniş ilk rotada değildir (`t3-root`).

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
