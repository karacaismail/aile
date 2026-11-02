# Yönetim paneli: paralel üretim planı

Tarih: 2 Kasım 2026. Durum: **uygulamada**. Bu belge [ADMIN-PANEL-ANT-DESIGN.md](ADMIN-PANEL-ANT-DESIGN.md) içindeki sıralı S0–S7 dilimlerinin yerine geçen yürütme planıdır. Ürün ve veri kararları (D1–D6) aynen geçerlidir. Bu belge onlara D7–D9'u ekler ve işi aynı anda 50'den fazla agent'ın ayrı worktree'lerde yürütebileceği biçimde böler.

## 1. Hedef ve yetki sınırı

- Hedef: `admin.html` yönetim panelini üretime hazır bir aday olarak `claude/admin-integration` dalında, tüm kapılar yeşil ve kanıtlı biçimde teslim etmek.
- Claude yalnız yerel dal ve yerel commit üretir. `main`, push, GitHub Pages yayını ve Apps Script dağıtımı Codex'indir; canlı yayın kullanıcının onayıyla yapılır.
- Gerçek aile verisi hiçbir dala, `dist/` çıktısına veya test fikstürüne girmez. Testler yalnız sentetik nesli kullanır.

## 2. Yeni kararlar

| # | Karar | Kural |
|---|---|---|
| D7 | 320 px telefon temel deneyimdir | Her yolculuk önce 320×568 ve 320×480'de çalışır. Sonra 360, 375, 390 ve yatay telefon gelir. Tablet ve masaüstü en son, uyarlamalı teslimle eklenir. Yatay telefon telefon profilinde kalır. |
| D8 | Uyarlamalı teslim | Üst düzey yerleşim profili tektir: phone, tablet veya desktop. Profil genişlik, yükseklik ve kısa kenardan birlikte seçilir. Giriş katmanları (coarse, fine, hover) eklemelidir. Telefon profili antd, Pro, ECharts ve geniş-özel (`*.wide.tsx`) parçaları istemez. Geniş arayüz bundler-görünür dinamik importla yüklenir. Kanıt üretim build manifesti ve ağ isteklerinden gelir. |
| D9 | Tarayıcı kapsamı | Yalnız Chromium (Chrome ailesi) ve WebKit (Safari ailesi). Firefox çalıştırılmaz. Emülasyon gerçek cihaz sayılmaz; gerçek iPhone Safari, Android Chrome ve macOS Safari kontrolü ayrı raporlanır. |

D8 geçişi: bugün ui bileşenlerinin çoğu antd'yi statik import ediyor. Geçiş boyunca antd sağlayıcısı tüm profillerde bağlı kalır. Tüm ui görevleri birleşince entegrasyon, telefonda antd'siz modu açar ve teslim kapısını `--strict` moduna geçirir.

## 3. Çalışma modeli

- **Bir görev, bir worktree, bir dal.** Görev `X`, `ux-worktrees/aw-X` worktree'sinde `claude/aw/X` dalında çalışır. Tüm görev dalları aynı entegrasyon commit'inden açılır.
- **Dosya sahipliği.** Her görevin değiştirebileceği dosyalar listelidir. Sahiplikler ayrıktır, bu yüzden birleştirmede çatışma beklenmez. Görev kendi dışındaki bir değişikliği yapmaz; `requests` alanına yazar. `package.json`, kilit dosyası, `ui/index.ts` ve `ui/antd.ts` W1 boyunca donuktur.
- **Ağır komut kilidi.** `kasa-work/admin-parallel-2026-11-02/ops/slot.mjs` kapasiteleri: `unit` 8, `e2e` 3, `build` 3. Görevler yalnız kendi testlerini koşar; tam paket entegrasyonda koşar.
- **Port yalıtımı.** Her görevin kendi `AILE_PORT` değeri vardır. Playwright başka worktree'nin sunucusunu yeniden kullanmaz.
- **Çıktı sözleşmesi.** Her görev durum, commit, dosya, RED ve GREEN kanıtı, çalıştırılan komutlar, `not_run` listesi ve dış istekler döner.
- **Eşzamanlılık.** Bir Workflow en çok 16 agent'ı aynı anda koşturur. W1 bu yüzden dört paralel hatta bölünür ve 51 görevin hepsi aynı anda çalışır.

## 4. Dalgalar

### W0 — Temel sözleşmeler (4 görev, paralel)

| Görev | Sonuç |
|---|---|
| `w0-infra` | `AILE_PORT` ile port yalıtımı, yol bağımsız `testMatch`, `@matrix` projeleri, yük altında kararsız birim testlerinin kök neden düzeltmesi |
| `w0-adaptive` | Profil modeli, giriş katmanları, `lazyWide` yükleyicisi, `WideProviders`, `PHONE_WITHOUT_ANTD` geçiş bayrağı |
| `w0-delivery` | Vite manifesti, `wide` parça grubu, `scripts/check-delivery.mjs` (ratchet ve strict), precache beklentisinin düzeltilmesi |
| `w0-actuals` | Bütçe "Gerçekleşen" anlamı: gelecek ay "Henüz yok", ödeme kanıtı yoksa "harcandı" oranı yok, plan aynası notu |

W0 dalları entegrasyona birleşir, kapılar koşar, sonra W1 worktree'leri bu commit'ten açılır.

### W1 — Paralel üretim (51 görev, 4 hat)

Her görev 320 yolculuğuyla başlar, önce başarısız test yazar, kendi dosyalarında uygular ve kendi testlerini Chromium ile WebKit'te koşar.

**Hat 1: arayüz bileşenleri.** Telefon sunumu antd'siz ve yerel; geniş sunum `ui/wide/*.wide.tsx` içinde tembel yüklenir. Genel API değişmez.

| Görev | Sahip olunan |
|---|---|
| `a01-button` | `ui/Button.*`, `ui/IconButton.*` |
| `a02-textfield` | `ui/TextField.*` |
| `a03-select` | `ui/Select.*`, `ui/wide/Select.wide.tsx` |
| `a04-dialog` | `ui/Dialog.*`, `ui/wide/Dialog.wide.tsx` |
| `a05-sheet` | `ui/BottomSheet.*`, `ui/Drawer.*`, `ui/wide/Drawer.wide.tsx` |
| `a06-menu` | `ui/Menu.*`, `ui/OverflowActions.*` |
| `a07-tabs` | `ui/Tabs.*` |
| `a08-status` | `ui/Tag.*`, `ui/StatusText.*`, `ui/DataStatus.*`, `ui/EmptyState.*`, `ui/ErrorState.*`, `ui/LoadingShell.*` |
| `a09-table` | `ui/Table.*`, `ui/ResponsiveTable.*`, `ui/AccordionList.*`, `ui/wide/Table.wide.tsx` |
| `a10-overview` | `ui/Overview.*`, `ui/Money.*` |
| `a11-detail` | `ui/DetailPanel.*`, `ui/ListRow.*`, `ui/Disclosure.*`, `ui/FormFooter.*`, `ui/ConflictView.*` |
| `a12-views` | `ui/Kanban.*`, `ui/Timeline.*`, `ui/PivotStack.*`, `ui/FilterArea.*` |
| `a13-chart-icons` | `ui/Chart.*`, `ui/icons.*`, `theme/antdTheme.*` |

**Hat 2: sayfalar.** Her sayfa kendi `pages/XPage.*` dosyalarına ve yeni `e2e/admin-page-x.spec.ts` dosyasına sahiptir.

| Görev | Sayfa ve ek konu |
|---|---|
| `c01-genel` | Genel durum; Gerçekleşen anlamı |
| `c02-butce` | Bütçe ve nakit; Gerçekleşen anlamı |
| `c03-odemeler` | Ödemeler |
| `c04-hesaplar` | Hesaplar ve borçlar |
| `c05-alimlar` | Alımlar ve eşyalar; kırık durum değişikliği testi |
| `c06-ev` | Ev ve odalar |
| `c07-projeler` | Projeler ve görevler; ham şablon anahtarının gösterilmesi |
| `c08-taraflar` | Taraflar ve teklifler |
| `c09-raporlar` | Raporlar; Gerçekleşen anlamı |
| `c10-sozlukler` | Sözlükler ve iş akışları |
| `c11-veri` | Veri kalitesi ve içe aktarma; Safari klasör içe aktarma yedeği |
| `c12-ayarlar` | Ayarlar |
| `b02-header-routes` | `shell/PageHeader.*`, `shell/navigation.*`, `routes.*` |

**Hat 3: kabuk, veri ve teslim.**

| Görev | Sahip olunan |
|---|---|
| `b01-shell` | `shell/WorkspaceShell.*`, `shell/shell.css`, `shell/MobileNavDrawer.*`, `shell/DetailSurface.tsx` |
| `b03-filters` | `shell/FilterDrawer.*`, `shell/FilterPanel.*`, `shell/QueryBar.*` |
| `b04-css-tokens` | `admin.css`, `theme/focus.test.ts`, `src/design/tokens.*` |
| `d01-live` | `data/live.*` |
| `d02-loading` | `data/sources.*`, `data/store.*`, `data/useGeneration.*`, `devServer/privateData.*` |
| `d03-changeset` | `data/changeSet.*` |
| `d04-query` | `data/query.*`, `data/indexes.*`, `data/views.*` |
| `d05-contract` | `data/contract.*`, `data/types.*` |
| `e01-budgets` | `scripts/check-budgets.*`, `docs/ADMIN-BUDGETS.md` |
| `e02-production` | `e2e/admin-production.spec.ts`, `playwright.admin-production.config.ts` |
| `e03-fonts` | `src/admin/fonts.css`, `e2e/admin-typography.spec.ts` |
| `g03-privacy` | `scripts/check-dist-privacy.*` |
| `g04-parity` | `src/admin/parity.test.ts` |

**Hat 4: kalite ve devir.** Bu görevler test ve belge yazar; ürün koduna dokunmaz. Kendi dallarında beklenen RED'i sahibi olan görevle birlikte kaydeder.

| Görev | Sahip olunan |
|---|---|
| `f01-focus` | `e2e/admin-focus.spec.ts` |
| `f02-min-text` | `e2e/admin-min-text.spec.ts` |
| `f03-layout` | `e2e/admin-layout.spec.ts` |
| `f04-table` | `e2e/admin-responsive-table.spec.ts` |
| `f05-states` | `e2e/admin-data-states.spec.ts` |
| `f06-header` | `e2e/admin-page-header.spec.ts`, `e2e/admin-smoke.spec.ts` |
| `f07-orientation` | `e2e/admin-orientation.spec.ts` |
| `f08-sheets` | `e2e/admin-sheets.spec.ts` |
| `f09-detectors` | `e2e/admin-detectors.ts`, `src/admin/e2e-detectors.test.ts` |
| `f10-a11y` | `e2e/admin-a11y.spec.ts` |
| `g01-docs` | `AGENTS.md` yönetim bölümü, `docs/ADMIN-RUNBOOK.md` |
| `g02-deploy` | `docs/ADMIN-DEPLOY-PROPOSAL.md` |

### W2 — Entegrasyon (tek sıralı hat ve paralel düzeltme turları)

1. Dalları bu sırayla birleştir: veri, `b04`, arayüz bileşenleri, kabuk, sayfalar, teslim, kalite, belgeler. Her gruptan sonra tür denetimi ve etkilenen birim testleri koşar.
2. Geçiş kesimi: `PHONE_WITHOUT_ANTD` açılır, `ui/antd.ts` daraltılır, teslim kapısı `--strict` olur.
3. Tam kapılar: tür denetimi, tam Vitest, build, gizlilik taraması, teslim ve bütçe kapıları, Chromium ve WebKit E2E (önce telefon projeleri, sonra `@matrix`, sonra geniş), üretim ağ yalıtımı.
4. Düşen her kapı, sahibine göre yeni bir düzeltme görevine dönüşür. Düzeltmeler paralel koşar, birleşir, kapılar yeniden koşar. En çok üç tur yapılır. Kalan hata gizlenmez, raporlanır.

### W3 — Bağımsız inceleme ve aday

Üç salt okunur `standards-reviewer` paralel çalışır: mimari ve uyarlamalı teslim, arayüz kuralları ve erişilebilirlik, veri bütünlüğü ve güvenlik. Bulgular düzeltme görevine dönüşür. Son kapılardan sonra entegrasyon dalında yerel aday commit'i alınır.

### W4 — Devir

Codex'e devir notu: dal adı, commit, kapı kanıtları, `main` birleştirme, push ve Pages yayını adımları. Görsel referans değişiklikleri kullanıcı incelemesine sunulur; sessizce onaylanmaz.

## 5. Kapılar ve test matrisi

| Kapı | Görev koşusu | Entegrasyon koşusu |
|---|---|---|
| Tür denetimi | Etkilenen proje | Tam |
| Vitest | Kendi dosyaları ve doğrudan bağımlıları | Tam paket |
| Playwright | `chromium` (320×568) ve `webkit` (390×844) | Bunlara ek `@matrix`: 320×480, 360, 375, 568×320, 820×1180 WebKit, 1440 Chromium ve WebKit |
| Üretim ağ yalıtımı | `e02` görevi | Soğuk bağlam; telefon antd/Pro/ECharts/wide istemez |
| Teslim | `check-delivery` ratchet | `check-delivery --strict` |
| Bütçe | `e01` ölçümü | Ölçülmüş bütçe seti |
| Gizlilik | `g03` | `check-dist-privacy` 0 bulgu |

Gerçek cihaz kontrolleri bu planın otomatik kapılarında yoktur; teslimde `not_run` olarak yazılır.

## 6. Durmadan devam etme kuralları

- Koşu durumu Git dışında, `kasa-work/admin-parallel-2026-11-02/` altındadır: `tasks.json` her görevin worktree, dal, port ve durumunu tutar; `STATUS.md` insan okur; `evidence/` görev kanıtlarını tutar.
- Her görev yeniden başlatılabilir: dalda önceki commit varsa agent oradan sürdürür.
- Workflow kesilirse aynı betik `resumeFromRunId` ile sürdürülür; biten görevler önbellekten döner.
- Kullanım sınırı veya oturum kopması olursa "devam" yeterlidir: orkestratör `STATUS.md` ve `tasks.json` okuyup kalan dalgadan sürer.
- Cron veya zamanlanmış iş kurulmaz. Devam, oturum içi Workflow bildirimleriyle sağlanır.

## 7. Riskler

| Risk | Önlem |
|---|---|
| 50 agent makineyi kilitler | Ağır komut kilidi, görev başına dar test kapsamı |
| Kullanım sınırına takılma | Görev başına sürdürülebilir dal, Workflow resume, `STATUS.md` |
| Sahiplik dışı değişiklik ihtiyacı | `requests` alanı; entegrasyon turunda sahibine görev olarak verilir |
| Geçiş boyunca telefonda antd kalması | Geçiş bayrağı ve ratchet; kesim entegrasyonda tek adım |
| Hat 4 testlerinin ürünle eşzamansız olması | Beklenen RED sahibiyle kaydedilir; entegrasyonda yeniden koşar |
| antd parçası 735 KB (gzip ~236 KB) | Telefonda hiç istenmez; geniş profilde ölçülmüş bütçe istisnası yazılır |
