# Yönetim paneli aktarım bütçesi

Bu belge `admin.html` girişinin ilk rotası için profil bazlı aktarım bütçesini tanımlar. Ölçüm üretim derlemesinden yapılır, tarayıcıdan değil. Komut `scripts/check-budgets.mjs`, bütçe dosyası `scripts/budgets.json`, birim testleri `scripts/check-budgets.test.mjs`. Teslim kapısı (`scripts/check-delivery.mjs`) hangi sınıfın telefona girmemesi gerektiğini söyler; bu kapı aynı derlemenin kaç bayt indirdiğini söyler.

## Komut sırası

```sh
VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 pnpm build
pnpm check:delivery                             # node scripts/check-delivery.mjs dist --strict; dist/delivery-report.json
pnpm check:budgets                              # node scripts/check-budgets.mjs dist (ratchet, tavanlar ölçüme eşit)
node scripts/check-budgets.mjs dist --strict    # tavan listesi boş (p-phonejs sonrası): PASS
```

Aynı iki kapı `src/admin/vite-config.test.ts` içinde gerçek üretim derlemesiyle de koşar (vitest): `check-delivery --strict`
PASS ve `scripts/delivery-baseline.json` boş; `check-budgets` PASS (tavansız her bütçe sınırında, tavanlı bütçe tavanında).
O derleme de sentetik e-tablo kimliğiyle yapılır.

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
| Araçlar | Node v24.21.0, Vite 8.3.5 (rolldown 1.2.15), taban `d70c0ef` + `p-phonejs2` (önceki kayıtlar: `429e068` + `p-phonejs`, `006ee49` + `r4-gates`, `0a8d903` + `t3-root`, `b061e08` + geçiş kesimi). Farklı bir Node zlib sürümü gzip baytını birkaç bayt oynatabilir. Sürüm değişince ölçümü yeniden kaydedin. |
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

Diğer sayfalar ve ECharts ilk rotada sayılmaz. `t3-root` sonrası antd sağlayıcısı (`adaptive/WideProviders.tsx`) geniş başlangıç kökü değildir: uygulama ağacını hiçbir profilde sarmaz, yalnız `lazyWide(…, { antd: true })` ile tanımlanmış bir ada geniş profilde render edilince iner ve bugün böyle ada yoktur. Derlemede tembel kök olarak durur (yükleyiciden dinamik import; antd, icons ve babel-runtime parçalarıyla), ama hiçbir profilde istenmez; bu yüzden `wideStartup.sources` boştur.

`r4-gates` sonrası geniş-özel kod birim başına parçadır (`vite.config.ts` `wideChunkName`): rota sayfası klasörü ya da sayfa dosyası `wide-<sayfa>` (ör. `wide-genel`, `wide-alimlar`), kabuk ve ui modülleri `wide-shell-workspacenav`, `wide-shell-querybar`, `wide-ui-kanban`, `wide-ui-pivot`. Sınıf yine `wide`dır. Bir wide parçası en çok kendi sayfasının parçasını statik çeker. `/genel` için geniş başlangıç kökleri `chunk:wide-shell-workspacenav` (masaüstü gezinme) ve `chunk:wide-genel`dir; statik kapanışları ortak geniş bileşenleri (Overview, Chart kabuğu, ResponsiveTable, Tag) ekler. Başka hiçbir sayfa parçası ilk rotaya girmez (önce tek `wide` parçası sekiz sayfa parçasını çekiyordu). Tablet ve masaüstü aynı geniş kaynak kümesini alır: `lazyWide` iki profili ayırmaz.

**Yetenek kaynağı** telefon rotasında istenen ve şu sınıflardan birini taşıyan parçanın her dosyasıdır: `antd`, `pro`, `icons`, `echarts`, `wide` (delivery-report `forbidden`). Birincil sınıf delivery-report `groups` listesinden okunur. Karma bir parçanın azınlık modülleri (örneğin ilk sayfa parçasına gömülü `zrender`) delivery-graph üyeliğinden okunur. `r4-gates` sonrası `check-delivery` de telefon profilini giriş kapanışı + her rota sayfasının (`src/admin/pages/*Page.tsx`) statik kapanışı olarak denetler; iki kapı aynı sızıntıyı ayrı ölçütle (ihlal kimliği ve istek sayısı) yakalar.

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

## Kayıtlı ölçüm (p-phonejs2, 2 Kasım 2026)

Ölçüm 2026-11-02 tarihinde, entegrasyon tabanı `d70c0ef` üzerinde `p-phonejs2` değişikliğiyle ve yukarıdaki koşullarla
alındı (`VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098`, Node v24.21.0, Vite 8.3.5, gzip seviye 9, 1 KB = 1000 B, ilk
rota `/genel`). Değişiklik: `PageHeader` → `OverflowActions` → `Menu` → `BottomSheet` zincirinde "Diğer" tetiği (menü
düğmesi) statik kaldı; açılır gövde (menü listesi, açılır panel, telefonda alt sayfa sarmalı) ve kipli katman
(`BottomSheet`, `BottomSheet.layer`) ilk niyette tembel iner (`adaptive` `lazyResource`, Sayfalar çekmecesiyle aynı kalıp).
`check-delivery --strict` PASS; `check-budgets` ratchet ve `--strict` PASS.

Modül sınırları (davranış ve genel adlar değişmedi; `Menu.tsx` aynı adları dışa verir):

| Modül | İlk rotada | İçerik |
|---|---|---|
| `ui/Menu.shared.ts` | statik | `MenuItem`/`MenuProps` türleri, `MENU_POPUP_MIN_WIDTH`, `DANGER_GROUP_LABEL`, düğme ile gövde arasındaki sözleşme |
| `ui/Menu.lazy.tsx` + `Menu.lazy.css` | statik | menü düğmesi: durum, klavye, niyet, bekleme (`aria-busy`) ve kurtarma bildirimi |
| `ui/Menu.panel.tsx` + `Menu.css` | tembel kök | liste (APG Menu), açılır panel, telefonda `BottomSheet` sarmalı |
| `ui/Menu.tsx` | yok | genel yüzey: liste kipi ve eşzamanlı `<Menu trigger>`; gövdeyi statik alır (ilk tıklamada aynı karede açılır) |

### Önce ve sonra (p-phonejs2)

| Ölçüt | Önce, `d70c0ef` | Sonra, `p-phonejs2` | Fark | Bütçe |
|---|---:|---:|---:|---:|
| `phone-html` | 2046 B | 2030 B | −16 B | 50000 B |
| `phone-js` | 118815 B | 113715 B | −5100 B | 120000 B |
| `phone-css` | 9663 B | 8606 B | −1057 B | 35000 B |
| `phone-capability` | 0 istek | 0 istek | 0 | 0 istek |
| `phone-transfer` | 226708 B | 220535 B | −6173 B | 500000 B |
| `wide-js` (antd hariç) | 121457 B | 116357 B | −5100 B | 180000 B |
| `wide-antd` | 0 B | 0 B | 0 | 0 B |
| Telefon JS dosyası | 12 | 11 | −1 | — |
| Telefon statik kapanış (JS + CSS) | 9 dosya, gzip 114997 B | 8 dosya, gzip 108865 B | −6132 B | — |
| `admin.html` giriş JS | 31965 B | 26961 B | −5004 B | — |

`p-phonejs` kaydı (118807 B) `429e068` tabanındadır; aynı ölçüm `d70c0ef` tabanında 118815 B'dir (ara birleşmeler, +8 B).
"Önce" sütunu `d70c0ef`'in kendi derlemesidir. `chunk:reload` (71 B) giriş parçasına katıldı (dosya sayısı −1).

**Hedef `phone-js` ≤ 110 KB: ulaşılamadı (113715 B, hedefin 3715 B üstünde).** Ölçümle açıklama:

- Zincirin üst sınırı: aynı tabanda (`d70c0ef`) `PageHeader`'dan `OverflowActions` tamamen çıkarılarak alınan deney
  derlemesi (kaynağa işlenmedi) `phone-js` 112169 B verdi (−6646 B). "Diğer" tetiği hiç olmasa bile bu zincirle 110 KB'ye
  inilemez (2169 B eksik kalır).
- Statik kalan tetik (`OverflowActions` + `Menu.lazy` + `Menu.shared`) derlemede 1546 B'dir (113715 − 112169). Tetik
  sözleşme gereği statiktir: "Diğer" başlıkla aynı karede çizilir, ilk basış kaybolmaz.
- Kalan 3715 B bu görevin dosyaları dışındadır: ortak çekirdek (`chunk:shared`, React/ReactDOM) 69276 B, giriş parçası
  26961 B (kabuk, uyarlama, rotalar, nesil sağlayıcısı, depo, değişiklik kümesi, `PageHeader` + `DataStatus`), Genel sayfası
  6288 B. `DataStatus` Genel'in ilk boyamasında çizilir (tazelik satırı); tembel yapılamaz. 110 KB için aday yön
  (ölçülmedi): giriş parçasında ilk boyamada gerekmeyen kabuk/veri kodunu aynı kalıpla bölmek (b01-shell, d02-loading,
  d03-changeset sahipleri).

Tembel kalan parça (delivery-report `lazy`):

| Kök | Gzip | Ne zaman |
|---|---:|---|
| `src/admin/ui/Menu.panel.tsx` (+ `chunk:BottomSheet`) | 9309 B (4 dosya: `Menu.panel` JS 2952, `Menu.css` 1142, `BottomSheet` JS 4011, `BottomSheet.css` 1204) | "Diğer"e ilk basış, odak ya da tuş (niyet indirir, açmaz); açma isteği indirme sürerken kaybolmaz (`aria-expanded` + `aria-busy`, gövde gelince menü açılır, odak ilk/son öğede). Bir kez kendiliğinden yeniden denenir; olmazsa düğmenin altında "Menü yüklenemedi · Yeniden dene" ya da çevrim içi parça hatasında "Yeni sürüm var · Yenile". `BottomSheet` parçası onu statik içe aktaran sayfalarda (Select, Dialog, FilterDrawer kullanan rotalar) sayfa parçasıyla zaten gelir; orada "Diğer" yalnız `Menu.panel` + `Menu.css` ister. |

Gerçek tarayıcı kanıtı (üretim önizlemesi `vite preview`, soğuk bağlam, service worker kapalı, dış ağ kesik; Chromium
320×568 ve WebKit 390×844 dokunmatik; iki motorda aynı liste):

- `admin.html#/genel`: istenen JS tam olarak ölçülen 11 dosyadır (`admin`, `rolldown-runtime`, `shared`, `router`,
  `tokens`, `context`, `IconBase.es`, `GenelPage`, `views.sums`, `Money`, `AccordionList`) + 4 CSS (`admin`, `GenelPage`,
  `Money`, `AccordionList`). `Menu.panel`, `Menu.css` ve `BottomSheet` istenmez.
- Uygulama içinde `#/hesaplar`: `HesaplarPage`, `Select`, `BottomSheet`, `Dialog` (+ CSS) ve `icons.extra`; `Menu.panel`
  istenmez.
- "Diğer"e ilk basış: `Menu.panel-*.js` ve `Menu-*.css` tam bir kez; Escape ile kapatıp yeniden açmak yeni istek yapmaz.

Emülasyondur, gerçek cihaz ölçümü yoktur (`not_run`). Aynı davranış geliştirme sunucusunda `e2e/admin-ui-p-phonejs2.spec.ts`
ile (modül istek yolları, bekleme sırasında basış, odak, sürüm kayması bildirimi) Chromium ve WebKit'te sınanır.

## Önceki kayıt: p-phonejs (2 Kasım 2026)

Ölçüm 2026-11-02 tarihinde, entegrasyon tabanı `429e068` üzerinde `p-phonejs` değişikliğiyle ve yukarıdaki koşullarla
alındı (`VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098`, Node v24.21.0, Vite 8.3.5, gzip seviye 9, 1 KB = 1000 B, ilk
rota `/genel`). `phone-js` bütçe içine indi: ratchet kaydı ve `CEILING_LOCK` girdisi silindi, tavan listesi boş;
`check-budgets` hem ratchet hem `--strict` PASS. `check-delivery --strict` PASS (telefon profilinde antd, pro, icons,
echarts ve wide yok).

### Önce ve sonra (p-phonejs)

| Ölçüt | Önce, `429e068` | Sonra, `p-phonejs` | Fark | Bütçe |
|---|---:|---:|---:|---:|
| `phone-html` | 2079 B | 2045 B | −34 B | 50000 B |
| `phone-js` | 174066 B | 118807 B | −55259 B | 120000 B |
| `phone-css` | 9945 B | 9663 B | −282 B | 35000 B |
| `phone-capability` | 0 istek | 0 istek | 0 | 0 istek |
| `phone-transfer` | 282274 B | 226699 B | −55575 B | 500000 B |
| `wide-js` (antd hariç) | 174576 B | 121447 B | −53129 B | 180000 B |
| `wide-antd` | 0 B | 0 B | 0 | 0 B |
| Telefon JS dosyası | 14 | 12 | −2 | — |
| Telefon statik kapanış (JS + CSS) | 12 dosya, gzip 171910 B | 9 dosya, gzip 114995 B | −56915 B | — |

Gerçek tarayıcı kanıtı (üretim önizlemesi, Chromium 320×568 ve WebKit 390×844, soğuk açılış `admin.html#/genel`):
istenen JS tam olarak ölçülen 12 dosyadır (gzip 118807 B); ölçüm dışı ek JS isteği yok. Sayfalar düğmesine basınca
yalnız `MobileNavDrawer` parçası (2092 B) iner. Emülasyondur, gerçek cihaz ölçümü yoktur (`not_run`).

### Değişiklik başına kazanç

Her satır önceki satırın üstüne uygulanmış derlemenin ölçümüdür (aynı koşullar).

| Adım | Değişiklik | `phone-js` | Fark |
|---|---|---:|---:|
| 0 | Önce (`429e068`) | 174066 B | — |
| 1 | `App.tsx` sağlayıcıyı veri barrel'ı yerine doğrudan alır; `vite.config.ts` `src/admin/data/*.ts` modüllerini yan etkisiz sayar (barrel'dan kullanılmayan katman — canlı veri, görünüm, CSV — sayfa parçasına da girmez). Yalnız birinci kısım +1061 B'dir (parça bölünmesi), ikisi birlikte: | 171196 B | −2870 B |
| 2 | Kabuğun e-tablo adresi `src/dashboard/data.ts` (GViz okuyucusu + Zod) içe aktarılmadan aynı biçimde kurulur (`shell/navigation.ts`) | 166133 B | −5063 B |
| 3 | Sözleşme doğrulaması (`data/contract.ts` + Zod) depodan tembel yüklenir (`data/store.ts` `loadContract`) | 138300 B | −27833 B |
| 4 | Phosphor simgeleri derlemede yalnız regular ağırlığıyla paketlenir (`ui/icons.build.ts` eklentisi; çıktı aynı SVG) | 127015 B | −11285 B |
| 5 | `useGeneration` modül sınırları: sağlayıcı (`useGeneration.provider.tsx`), bağlam (`useGeneration.context.ts`), satır/sorgu (`useGeneration.rows.tsx`: `indexes.ts`, `query.ts` girişte yok) | 123189 B | −3826 B |
| 6 | Sayfalar çekmecesi (`MobileNavDrawer`) ilk niyette iner (`adaptive` `lazyResource`); üst çubuk simgesi `shell/ShellIcon.tsx` | 121655 B | −1534 B |
| 7 | Simgeler: ilk rotanın çizdiği 6 çekirdek simge statik, 17'si `ui/icons.extra.tsx` parçasında (rota yükleyicisi Genel dışındaki sayfalarla paralel ister) | 119080 B | −2575 B |
| 8 | Sayfa hook'ları (`useGeneration`, `useChangeSet` …) bağlam modülünde: ayrı küçük sayfa parçası kalktı | 118746 B | −334 B |
| 9 | Doğrulama modülü manifest okumasıyla paralel istenir; kaynak baştan belliyse (geliştirme, `VITE_AILE_GENERATION_URL`) açılışta | 118807 B | +61 B |
| | Sonra | 118807 B | −55259 B |

Tembel kalan parçalar ve ne zaman indikleri (delivery-report `lazy`):

| Kök | Gzip | Ne zaman |
|---|---:|---|
| `chunk:contract` (+ Zod `schemas` parçası) | 28623 B (2 dosya) | Bir nesil okunurken: klasör içe aktarılınca ya da kaynak verilmişse ilk okumada; geliştirme ve `VITE_AILE_GENERATION_URL` ile açılışta. Üretim varsayılanında (kaynak seçilmemiş) telefon ilk rotası istemez. |
| `ui/icons.extra.tsx` | 2734 B | Genel durum dışındaki bir sayfa parçasıyla paralel ya da çekirdek dışı bir simge ilk çizildiğinde. Gelmeden çizilen simge aynı kutu ve erişilebilir adla boştur. |
| `shell/MobileNavDrawer.tsx` | 2092 B | Sayfalar düğmesine ilk basış ya da odak; hata olursa "Sayfalar yüklenemedi · Yeniden dene" ya da "Yeni sürüm var · Yenile". |

### Telefon ilk rota (p-phonejs)

| Parça | Sınıf | Gzip B | Not |
|---|---|---:|---|
| `chunk:shared` | shared | 69276 | React, ReactDOM, scheduler, wouter hash kancası (değişmedi) |
| `admin.html` girişi | entry | 31963 | kabuk, uyarlama, rotalar, nesil sağlayıcısı, depo, değişiklik kümesi, PageHeader (Menu/BottomSheet dahil), 6 simge |
| `src/admin/pages/GenelPage.tsx` | page | 6308 | ilk sayfa |
| `chunk:Money` | app | 2466 | `Money` + `data/actuals.ts` (ilk sayfa kapanışı) |
| `chunk:tokens` | tokens | 2341 | |
| `chunk:router` | router | 2088 | |
| `chunk:AccordionList` | app | 1764 | ilk sayfa kapanışı |
| `chunk:context` | app | 1042 | profil bağlamı |
| `chunk:IconBase.es` | app | 851 | Phosphor `IconBase` + idb-keyval (ana uygulamayla ortak) |
| `chunk:rolldown-runtime` | app | 429 | |
| `chunk:views.sums` | app | 208 | |
| `chunk:reload` | app | 71 | |

Önceki dağılım (`429e068`): ortak çekirdek 69276 B, giriş 49774 B, `chunk:data` (Zod + `src/dashboard/data.ts`) 30937 B,
`chunk:X.es` (Phosphor + idb-keyval) 6764 B, Genel sayfası 6351 B, kalan küçük parçalar 10964 B.

Önbellek: ana uygulamanın ön belleği 19 → 20 girdi (899,92 → 899,96 KiB). Aynı modüller (Zod ve `src/dashboard/data.ts`)
iki ana grafik parçasına bölündü (`schemas`, `data`), çünkü yönetim girişi artık `data` parçasını statik çekmez; ön
bellek üyelik kuralları aynıdır (yalnız ana grafik + kök kabuk dosyaları, yönetim parçası yok; `vite-config.test.ts` PASS).

(Sonraki not, p-phonejs2: aşağıda önerilen ui sınırı yapıldı; "Kayıtlı ölçüm (p-phonejs2)".) Kalan sabit bedel: telefon JS'inin %58'i (69276 B) React/ReactDOM ortak çekirdeğidir. Girişte, Genel'in çizmediği ama
`PageHeader` → `OverflowActions` → `Menu` → `BottomSheet` yoluyla statik kalan açılır menü/alt sayfa kodu vardır (modül
gzip toplamı ~12 KB); `PageHeader` sözleşmesi (telefonda "Diğer" düğmesi ve menünün eşzamanlı açılması) değişmeden tembel
yapılamaz. Yön: Menu'nün açılır içeriğini ilk açılışta yükleyen bir ui sınırı (a06-menu, a05-sheet).

## Önceki kayıt: r4-gates

Ölçüm 2026-11-02 tarihinde, entegrasyon tabanı `006ee49` üzerinde `r4-gates` değişikliğiyle ve yukarıdaki koşullarla alındı. Değişiklik: geniş-özel kod tek `wide` parçası yerine sayfa/birim başına parçalara bölündü; kendiliğinden sayfa yenileyen `preloadRecovery` (giriş parçası) kaldırıldı; yükleyici geçersiz modülü hata sayar. İlk rota `/genel`. `node scripts/check-delivery.mjs dist --strict` PASS: telefon profilinde (giriş kapanışı 14 dosya, ham 565490 B, gzip 169652 B + 12 rota sayfasının kapanışı; toplam 69 dosya, gzip 317469 B) antd, pro, icons, echarts ve wide yok.

### Önce ve sonra (r4-gates)

"Önce" `006ee49` kaynağının aynı koşullardaki derlemesidir. Kayıtlı `budgets.json` ile `check-budgets` o derlemede FAIL veriyordu: `phone-js` 171836 B > tavan 171767 B (+69 B, `t3-root` kaydından sonra birleşen görevler) ve `wide-js` 276074 B > tavan 275959 B. Bu kapı entegrasyon kapı listesinde koşmuyordu; artık `vite-config.test.ts` gerçek derlemede koşar.

| Ölçüt | Önce, `006ee49` | Sonra, `r4-gates` | Fark | Bütçe |
|---|---:|---:|---:|---:|
| Telefon statik kapanış gzip | 169897 B | 169652 B | −245 B | — |
| `phone-html` | 2105 B | 2104 B | −1 B | 50000 B |
| `phone-js` | 171836 B | 171040 B | −796 B | 120000 B |
| `phone-css` | 10288 B | 10288 B | 0 | 35000 B |
| `phone-capability` | 0 istek | 0 istek | 0 | 0 istek |
| `phone-transfer` | 280413 B | 279616 B | −797 B | 500000 B |
| `wide-js` (antd hariç) | 276074 B | 181585 B | −94489 B | 180000 B |
| `wide-antd` | 0 B | 0 B | 0 | 0 B |
| Geniş ilk rota | 67 dosya, aktarım 409575 B | 35 dosya, aktarım 294900 B | −32 dosya, −114675 B | — |
| Geniş başlangıç kökleri | `chunk:wide` (44 dosya, gzip 129162 B) | `chunk:wide-shell-workspacenav`, `chunk:wide-genel` (12 dosya, gzip 15284 B) | −32 dosya, −113878 B | — |

Telefon −796 B: giriş parçası 39054 → 38680 B (−374 B, `preloadRecovery` kalktı), `chunk:loader` 1879 → 2008 B (+129 B, geçersiz modül denetimi), ilk sayfa parçası `GenelPage` 6775 → 6222 B (−553 B; aynı dört modül, fark parçalar arası bağlama kodundan: sayfa artık tek ortak wide parçasına değil yalnız `wide-genel`e dışa aktarır), `chunk:Money` +2 B. Geniş ilk rota artık sekiz başka sayfa parçasını (54368 B) ve onların ortak bileşenlerini (Select, Dialog, Tabs, QueryBar, FilterDrawer, ui) indirmez.

Tavanlar ölçüme indirildi (yalnız düşüş, pay yok): `phone-js` 171767 → 171040 B, `wide-js` 275959 → 181585 B. Tavanlar `scripts/check-budgets.test.mjs` `CEILING_LOCK` ile kilitlidir: yükseltmek kilidi de değiştirmeyi gerektirir. `wide-js` bütçenin 1585 B üstünde kaldı (aşağıda).

## Önceki kayıt: t3-root

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

## Önceki ölçüm ayrıntısı (r4-gates)

### Telefon ilk rota

23 dosya, aktarım 279616 B.

| Tür | Dosya | Ham B | Gzip B | Aktarım B |
|---|---:|---:|---:|---:|
| html | 1 | 6093 | 2104 | 2104 |
| js | 14 | 546280 | 171040 | 171040 |
| css | 6 | 52548 | 10288 | 10288 |
| font | 2 | 96184 | 54005 | 96184 |

| Bölüm | Dosya | Ham B | Gzip B |
|---|---:|---:|---:|
| `admin.html` | 1 | 6093 | 2104 |
| Statik kapanış (JS + CSS) | 14 | 565490 | 169652 |
| İlk sayfa (`GenelPage` + `AccordionList`, `Money`) | 6 | 33338 | 11676 |
| İlk ekran fontu (`outfit-regular.ttf`, `outfit-bold.ttf`) | 2 | 96184 | 54005 |

Parça başına gzip baytı (JS):

| Parça | Sınıf | Gzip B | Not |
|---|---|---:|---|
| `chunk:shared` | shared | 69276 | React, ReactDOM, scheduler, wouter hash kancası |
| `admin.html` girişi | entry | 38680 | ortak kabuk ve ui bileşenleri girişte |
| `chunk:data` | app | 30490 | veri katmanı; zod |
| `chunk:icons` | app | 7818 | Phosphor simgeleri (`ui/icons`); antd `icons` sınıfı değil |
| `chunk:X.es` | app | 6764 | Phosphor modülleri, idb-keyval |
| `src/admin/pages/GenelPage.tsx` | page | 6222 | ilk sayfa |
| `chunk:tokens` | tokens | 2341 | |
| `chunk:router` | router | 2088 | |
| `chunk:loader` | app | 2008 | uyarlamalı yükleyici; hazır sinyali, geçersiz modül denetimi ve antd adası seçeneği dahil |
| `chunk:AccordionList` | app | 1745 | ilk sayfa kapanışı |
| `chunk:Button` | app | 1090 | |
| `chunk:Money` | app | 1047 | ilk sayfa kapanışı |
| `chunk:context` | app | 1042 | profil bağlamı |
| `chunk:rolldown-runtime` | app | 429 | |

### Geniş ilk rota

35 dosya, aktarım 294900 B. Geniş başlangıç kökleri: `chunk:wide-shell-workspacenav` ve `chunk:wide-genel` (birlikte 12 dosya, ham 42081 B, gzip 15284 B). antd hariç JS 181585 B, antd 0 B.

Geniş başlangıcın JS parçaları: `chunk:ResponsiveTable` 2777 B, `chunk:Chart` 2676 B (ECharts değil, grafik kabuğu), `chunk:Overview` 2493 B, `chunk:wide-genel` 1387 B, `chunk:Tag` 705 B, `chunk:wide-shell-workspacenav` 507 B.

### Bütçe durumu

| Kimlik | Ölçüm | Bütçe | Ratchet tavanı | Ratchet | Strict |
|---|---:|---:|---:|---|---|
| `phone-html` | 2104 B | 50000 B | — | PASS | PASS |
| `phone-js` | 171040 B | 120000 B | 171040 B | RATCHET | FAIL |
| `phone-css` | 10288 B | 35000 B | — | PASS | PASS |
| `phone-capability` | 0 istek | 0 istek | — | PASS | PASS |
| `phone-transfer` | 279616 B | 500000 B | — | PASS | PASS |
| `wide-js` | 181585 B | 180000 B | 181585 B | RATCHET | FAIL |
| `wide-antd` | 0 B | 0 B | — | PASS | PASS |

Sonuç: ratchet PASS (2 bütçe kayıtlı tavanında, uyarı yok). `--strict` FAIL (`phone-js`, `wide-js`). Tavanlar ve istisna kayıtlı ölçümün aynısıdır, pay içermez; `budgets.json` `measured` alanı ölçümü taşır ve `check-budgets.test.mjs` eşitliği ve `CEILING_LOCK` kilidini doğrular. `phone-capability` ve `phone-transfer` tavanları silindi: sıfır yetenek isteği ratchet modunda da zorunludur. Tavan ölçüme eşit olduğu için ratchet pratikte katıdır: ilk rota JS'i bir bayt büyürse FAIL; sonraki birleşmeler ölçümü değiştirirse entegrasyon sahibi yeniden ölçer (düşüşte tavanı indirir, artışta açık karar verir).

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

`--strict` tavanları yok sayar. Her bütçe aşımı FAIL olur. Tavan listesi boşalınca kapı `--strict` ile koşar. `check-delivery` ise artık her yerde `--strict` koşar (`pnpm check:delivery`, `vite-config.test.ts`): telefon profilinde bilinen ihlal yoktur ve baseline boştur.

Tavanlar iki yerde kilitlidir: `budgets.json` `ratchet.ceilings` (ölçüme eşit) ve `scripts/check-budgets.test.mjs` `CEILING_LOCK` (üst sınır; yalnız düşer). Gerçek derlemedeki ölçüm `vite-config.test.ts` ile vitest içinde denetlenir. CI'ya ekleme kararı ve teknik kurulumu AGENTS.md'de "Codex/Hüseyin Cengiz devri" olarak kayıtlıdır; workflow dosyaları bu görevde değişmedi.

Geçiş kesimi (x-cut) yapıldı: `PHONE_WITHOUT_ANTD=true`, `scripts/delivery-baseline.json` boş ve `check-delivery --strict` PASS; `phone-capability` ve `phone-transfer` tavanları silindi, `phone-js` tavanı 410050 → 170163 B indi, `wide-js` için kesim sonrası ölçüm (280464 B) entegrasyonun kararıyla tavan olarak kaydedildi. `t3-root` tavanları yeniden ölçüme sabitledi (`phone-js` 171767 B, `wide-js` 275959 B; yukarıda). Kalan açıklar:

1. (Kapandı, p-phonejs: `phone-js` 118807 B ≤ 120000 B; yukarıdaki tablo.) Önceki durum: `phone-js` 120 KB'ın 51767 B üstünde. Aday kaynaklar:
   - `chunk:data` (30490 B, büyük kısmı zod): ilk ekranda zorunlu olmayan doğrulama sonraya alınabilir.
   - `admin.html` girişi (39052 B): ortak kabuk ve ilk ekranda görünmeyen ui bileşenleri (diyalog, alt sayfa, menü) tembel yapılabilir.
   - `chunk:icons` (7818 B) ve `chunk:X.es` (6764 B): Phosphor simgeleri; yalnız ilk ekranın simgeleri statik kalabilir.
   - `shared` (69276 B): React ve ReactDOM'un taban maliyeti. Bütçeyle uyuşmazsa bu, bütçe değişikliği olarak açıkça kararlaştırılır; sessizce gevşetilmez.
2. `wide-js` 180 KB'ın 1585 B üstünde (önce 95959 B). Tek `wide` grubu `r4-gates`'te sayfa/birim başına bölündü; geniş ilk rota artık yalnız telefon rotası + masaüstü gezinme + `wide-genel` ve ortak geniş bileşenleridir (gzip 15284 B). Kalan aşım telefon rotasının kendisinden gelir (`phone-js` 171040 B, geniş JS'in %94'ü); `phone-js` açığı kapanınca `wide-js` de bütçeye iner. antd geniş ilk rotada değildir (`t3-root`).

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

- `node --test scripts/check-budgets.test.mjs` ve `pnpm exec vitest run scripts/check-budgets.test.mjs` sentetik manifest, graph ve delivery-report kullanır. Kapsanan konular: rota kümeleri, font çözümleme, yetenek kaynağı (tembel ilk sayfa ve karma parça dahil), ratchet ve strict, bütçe dosyası doğrulaması, CLI çıkış kodları ve mutlak yolsuz rapor. Ayrıca `budgets.json` aday değerleri, ilk rotanın `navigation.ts` ile `routes.tsx`'e uyumu (iki yazım biçimi için çözümleyici testleriyle), kesim sonrası tavan sözleşmesi (yetenek ve aktarım tavanı yok; tavanlar ve antd istisnası kayıtlı ölçüme eşit) ve tavan kilidi (`CEILING_LOCK`: tavanlar yalnız düşer, bütçe değerleri sabit) test edilir.
- Gerçek derleme: `pnpm exec vitest run src/admin/vite-config.test.ts` geçici klasöre sentetik kimlikle üretim derlemesi yapar; `check-delivery --strict` ve `check-budgets` o derlemede PASS olmalıdır.
- Gerçek ölçüm: yukarıdaki komut sırası. Bu belgedeki sayılar o çıktıdan alındı.
- Telefon girişinin kaynak düzeyi kuralı: `src/admin/phoneEntry.test.ts` (`main.tsx` statik kapanışında Zod, `contract.ts`,
  `src/dashboard/data.ts`, veri barrel'ı, canlı veri/görünüm/CSV/indeks/sorgu katmanları ve `MobileNavDrawer` yok; kabuğun
  e-tablo adresi `dashboard/data.ts` ile aynı; `store.ts` sözleşmeyi yalnız dinamik içe aktarır; giriş + Genel durum
  kapanışında `Menu.tsx`, `Menu.panel.tsx`, `BottomSheet` ve kipli katman yok, "Diğer" tetiği gövdeyi yalnız
  `import('./Menu.panel')` ile ister). Menü gövdesinin bekleme, iptal, hata ve yeniden deneme yolu:
  `src/admin/ui/Menu.lazy.test.tsx`; gerçek tarayıcıda `e2e/admin-ui-p-phonejs2.spec.ts`. Tembel doğrulamanın
  sıkılığı ve indirme hatası: `src/admin/data/store.contract.test.ts`. Simge derleme eklentisinin çıktısı paketin kendi
  bileşeniyle 23 simgede birebir aynı SVG'dir: `src/admin/ui/icons.build.test.tsx`. Çekmece hata/yeniden deneme yolu:
  `src/admin/shell/WorkspaceShell.drawer.test.tsx`.

## Entegrasyon kararı — 2 Kasım 2026 (Emeklilik planı ve barrel düzeltmesi sonrası)

Ölçüm koşulları değişmedi (gzip seviye 9, 1 KB = 1000 B, ilk rota `/genel`, sentetik nesil).

| Bütçe | Önceki tavan | Ölçüm | Yeni tavan | Not |
|---|---:|---:|---:|---|
| phone-js | 171.040 | 174.066 | 174.066 | Entegrasyon sahibinin açık kararı; gerekçe `scripts/budgets.json` → `ratchet.karar` |
| wide-js | 181.585 | 174.576 | — | Bütçe (180.000) içinde; ratchet kaydı kaldırıldı |
| phone-transfer | — | 282.274 | — | Bütçe 500.000 içinde |

Aynı ölçümde sayfa ve kabuk modüllerindeki `../ui` barrel importları doğrudan modül importlarına çevrildi; Alımlar ve Ödemeler telefon kapanışından Chart ve Overview parçaları çıktı (kural testi: `src/admin/pages/barrelKurali.test.ts`).

Açık iş (kapandı, p-phonejs: 118807 B; "Önceki kayıt: p-phonejs"; sonra p-phonejs2: 113715 B): telefon ilk rota JS hedefi 120 KB; o gün 174,1 KB. Dağılım (gzip): ortak çekirdek (React) 69,3 KB, yönetim girişi (kabuk, uyarlama, rotalar) 49,8 KB, veri katmanı (Zod dahil) 30,9 KB, simge parçası 6,8 KB, Genel sayfası 6,4 KB. Azaltma yönü: veri katmanını ve girişi rota başına bölmek.

## Entegrasyon kaydı — 2 Kasım 2026 (p-phonejs2, p-fix ve simge tokenı sonrası)

Ölçüm koşulları değişmedi (gzip seviye 9, 1 KB = 1000 B, ilk rota `/genel`, sentetik nesil, soğuk önbellek). Ratchet tavanı yok; `check-budgets` hem ratchet hem `--strict` modunda PASS.

| Bütçe | 429e068 (barrel sonrası) | p-phonejs | p-phonejs2 | Entegrasyon (son) | Bütçe |
|---|---:|---:|---:|---:|---:|
| `phone-html` | 2079 B | 2045 B | 2030 B | 2050 B | 50000 B |
| `phone-js` | 174066 B | 118807 B | 113715 B | 114662 B | 120000 B |
| `phone-css` | 9945 B | 9663 B | 8606 B | 8780 B | 35000 B |
| `phone-capability` | 0 istek | 0 istek | 0 istek | 0 istek | 0 istek |
| `phone-transfer` | 282274 B | 226699 B | 220535 B | 221676 B | 500000 B |
| `wide-js` (antd hariç) | 174576 B | 121447 B | 116357 B | 117303 B | 180000 B |
| `wide-antd` | 0 B | 0 B | 0 B | 0 B | 0 B |

p-fix (p-phonejs bağımsız inceleme bulguları: niyetle yükleme yardımcısı `adaptive/intent.ts`, tek parça hata sınıflandırıcısı `adaptive/chunkError.ts`, sözleşme ve simge parçasında eski sürüm bildirimi, çekmecenin bekleme şeridi ve canlı bölge) kendi tabanında +781 B; simge ölçüsünün tek kaynağa (`src/design/tokens.ts` `iconTokens.simgeOlcu`) taşınması +42 B. `ui/icons` → `adaptive/*` ve `ShellIcon` → `ui/icons` statik kenarları derleyicinin girişten ayrı parça bölmesine yol açar (+150–500 B); tokens parçası zaten ilk rotada olduğu için ona bağlanmak bölme yapmaz.

Entegrasyon kararı: 110 KB, p-phonejs2'nin pay hedefiydi, bütçe değil. Ölçülen üst sınır (PageHeader'dan tüm menü zinciri çıkarılsa) 112.169 B'dir; kalan bayt React (69.276 B), yönetim girişi (~27 KB) ve Genel sayfasıdır ve DataStatus ilk boyamada çizildiği için tembel olamaz. Bütçe 120.000 B kalır; bugünkü pay 5.338 B. Yeni bir özellik ilk rota kapanışına girerse pay ölçümle izlenir (`src/admin/phoneEntry.test.ts` kural testleri, `check-budgets --strict`).
