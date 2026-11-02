# Yönetim paneli: Pages yayın önerisi

Tarih: 2 Kasım 2026. Durum: **öneri, uygulanmadı**. Görev: `g02-deploy` (taban 67382b9).
Bu belge `.github/workflows/*.yml` dosyalarını değiştirmez. Önerilen yama aşağıda metin olarak verilir. Yamayı uygulamak, `main`'e birleştirmek, push ve Pages yayını Codex'in işidir. Canlı yayın kullanıcının onayıyla yapılır ([ADMIN-PANEL-PARALLEL-PLAN.md](ADMIN-PANEL-PARALLEL-PLAN.md) §1).

| Sahip | Sorumluluk |
|---|---|
| Codex | Workflow yaması, `main` birleştirme, push, Pages yayını, geri alma, Apps Script dağıtımı |
| Hüseyin Cengiz | Sunucu gerekmez; Pages statiktir. Yalnız özel alan adı seçilirse DNS kaydının teknik gereksinimi ve sonuç doğrulaması |
| Asistan Hüseyin | Yalnız özel alan adı seçilirse kaydı GoDaddy'de uygular |
| Kullanıcı | Yayın onayı; ortak köken kararı (§6); Sheet paylaşımı (bilinen, ertelenmiş risk) |

## 1. Özet

1. `admin.html` mevcut Pages iş akışıyla ek ayar olmadan çıkar. Adres `https://karacaismail.github.io/aile/admin.html#/genel` olur; hash rota sunucu yönlendirmesi istemez.
2. Bugün yayına engel beş konu var: `main` yayın akışı kırmızı (§3, Ö1). Admin birleşmesi ana uygulamanın planlayıcı rotalarına 233.210 B gzip antd ekliyor (§8). Sürüm kaymasında rota parçası düşerse panel boş sayfaya düşüyor (§5). Telefon teslim kapısı `--strict`'te geçmiyor; bu beklenen durum. Gizlilik taraması yayınlanan çıktıda koşamıyor (§4.3).
3. Gerçek aile verisi Pages kökeninde kalıcı saklanmamalı. `karacaismail.github.io` kökeni 79 Pages projesi tarafından paylaşılıyor (§6).
4. Canlı yazma yolunun önkoşulları: Apps Script fail-closed düzeltmesi (`claude/p0-api-fail-closed`, 98dff0d) ve ayrı köken (§7).
5. `dist/.vite/` ve `delivery-report.json` Pages artefaktına çıkmaz. İş akışı artefaktı olarak 14 gün tutulur (§4.4).

## 2. Bugünkü yapı (gözlem, 2 Kasım 2026)

- `deploy.yml` yalnız `main` push'unda ve `workflow_dispatch` ile koşar. `build` işi şu sırayla ilerler: typecheck, Vitest, finans testleri, dashboard E2E, hedefli legacy tarayıcı kapısı, sentetik `pnpm build`, finansman üretim kapısı, `vars.VITE_BUDGET_SHEET_ID` + `vars.VITE_API_URL` ile ikinci `pnpm build`, timeline üretim kapısı ve `actions/upload-pages-artifact@v5` (`path: dist`). `deploy` işi `actions/deploy-pages@v5` kullanır.
- `ci.yml` aynı kapıları PR ve `main` dışı push için koşar. Admin E2E, `check-dist-privacy` ve `check-delivery` iki iş akışında da yok. `AGENTS.md` bunları "yerel; CI'ya eklenmedi" diye yazıyor.
- Pages yapılandırması (`gh api repos/karacaismail/aile/pages`): `build_type: workflow`, özel alan adı yok, HTTPS zorunlu. `github-pages` ortamının dağıtım dalı kuralı yalnız `main`.
- Repo değişkenleri `VITE_API_URL` ve `VITE_BUDGET_SHEET_ID` tanımlı. Yalnız adları okundu, değerler okunmadı.
- Canlı yanıt başlığı `cache-control: max-age=600` (`/aile/`). HTML ve parçalar tarayıcı ve CDN önbelleğinde en çok 10 dakika kalabilir.
- Pages yayını atomiktir: yeni artefakt öncekinin yerine geçer, eski karma adlı parçalar silinir. `upload-pages-artifact` artefaktı 1 gün tutar. Eski bir yayın yeniden derlenmeden geri yüklenemez.
- `upload-pages-artifact` v4'ten beri nokta ile başlayan dosyaları varsayılan olarak artefakta koymaz. v5'teki `include-hidden-files` girdisinin varsayılanı `false`. Bu bilgi eylemin `action.yml` dosyasından ve sürüm notlarından alındı.

## 3. Yayın önkoşulları

| # | Önkoşul | Bugün | Sahip |
|---|---|---|---|
| Ö1 | `main` yayın akışı yeşil | Kırmızı. Son koşu c62f2a6 (run 41304097996) dashboard E2E adımında düştü: `e2e/family-dashboard.spec.ts:498` (chromium-desktop) başarısız, 11 test kararsız. Canlı site son başarılı koşudan (25a5ed5, run 41302668945) geliyor. | Codex |
| Ö2 | Entegrasyon adayı tüm kapılarda yeşil; `check-delivery --strict` PASS | Ratchet PASS. `--strict` FAIL (çıkış 1, bilinen 2 ihlal). | entegrasyon |
| Ö3 | LegacyApp → antd statik kenarı kapalı (§8) | Açık: planlayıcı rotaları +735.269 B ham / +233.210 B gzip indiriyor | entegrasyon |
| Ö4 | Rota parçası düşünce boş sayfa yok (§5) | Rota katmanında hata sınırı yok | b02-header-routes, entegrasyon |
| Ö5 | Workflow yaması (§4) uygulanmış ve PR CI'da yeşil | Uygulanmadı | Codex |
| Ö6 | Gerçek veri için ortak köken kararı (§6) | Karar yok | Kullanıcı |
| Ö7 | Canlı yazma için fail-closed + ayrı köken (§7) | 98dff0d `main`'de değil; canlı yazma yolu yok | Codex, kullanıcı |

Ö1–Ö5 `admin.html`'in yayını için gereklidir. Ö6 gerçek nesli Pages adresinde içe aktarmak için, Ö7 canlı yazma için gereklidir.

## 4. admin.html Pages'e nasıl çıkar

### 4.1 Adres, taban ve rota

- Vite `base: '/aile/'` ve `rolldownOptions.input: { index: 'index.html', admin: 'admin.html' }` ile `dist/admin.html` üretilir. Artefakt `dist`'in tamamı olduğu için ek adım gerekmez.
- Kanonik adres `/aile/admin.html`. Rota hash'tedir (wouter `useHashLocation`), örneğin `admin.html#/alimlar/<kimlik>`. Sunucu yalnız `/aile/admin.html` görür; `404.html` veya yeniden yazma gerekmez. Derin bağlantılar ve yenileme çalışır.
- Pages uzantısız adresi de çözer: canlıda `/aile/index` 200 döndü. Yayından sonra `/aile/admin` da `admin.html`'i döndürecektir. Ancak ana service worker'ın `navigateFallbackDenylist` kuralı yalnız `/\/admin\.html/` desenini dışlar. SW kurulu tarayıcıda `/aile/admin` ana uygulamayı (`index.html`) açar. İstek: denylist `/\/admin(?:\.html)?(?:\?|$)/` olsun (entegrasyon, `vite.config.ts`). Bağlantılarda yalnız `admin.html` kullanılır.
- `admin.html` ön belleğe alınmaz: `globIgnores` `**/admin.html`, `**/admin-*`, `**/antd-*`, `**/pro-*`, `**/icons-*`, `**/wide-*` ve `adminPrecacheScope` dönüşümü. Bugünkü precache: 19 giriş, 897,82 KiB (sentetik build).

### 4.2 Ortam değişkenleri

- `VITE_BUDGET_SHEET_ID` repo değişkenidir, gizli değer değildir. Yayın build'i onu zaten kullanıyor. Panel bu kimliği yalnız "E-tabloyu aç" bağlantısında (`shell/WorkspaceShell.tsx`) ve Ayarlar'daki tanımlı/tanımsız satırında kullanır; Ayarlar kimliği yazmaz. Değişken yoksa bağlantı gizlenir, panel bozulmaz.
- Bu kimlik ana uygulama paketinde (`assets/data-*.js`) zaten açık metin olarak yer alıyor. GViz anonim okuması bunu gerektiriyor. Admin yeni bir ifşa eklemez. Sheet'in "bağlantıya sahip herkes düzenleyebilir" paylaşımı kullanıcı kararıyla (1 Kasım 2026) bilinçli olarak ertelenmiş, bilinen bir P0 riskidir. Bu belge onu değiştirmez, yeniden sormaz; güvenli de saymaz.
- `VITE_API_URL`'yi panel doğrudan okumaz. `data/live.ts` `liveAppRecords(url, key)` adres ve anahtarı parametre olarak alır. Bugün hiçbir sayfa bu uyarlayıcıları çağırmıyor (kod incelemesi).
- Nesil verisi: `GenerationProvider` varsayılan olarak `HttpGenerationSource('/__aile/generation')` kullanır. Bu yol köke mutlaktır, `/aile/` altında değildir ve yalnız dev sunucusunda vardır. Pages'te `https://karacaismail.github.io/__aile/generation/manifest.json` 404 döner (canlıda doğrulandı). Gerçek veri yalnız klasör içe aktarmayla girer. File System Access API Chromium'dadır; Safari yedeği c11-veri görevindedir. İstek (d02-loading): üretim build'inde dev yoluna istek atılmasın, panel doğrudan "Klasör içe aktar" durumuyla açılsın.

### 4.3 Gizlilik taraması ve gerçek Sheet kimliği

Deneme: sentetik ama gerçek uzunlukta (≥30 karakter) bir kimlikle build alındı ve `node scripts/check-dist-privacy.mjs` koşturuldu.

```
dist-privacy: spreadsheet-id  assets/admin-*.js  (synthe…00)
dist-privacy: 1 bulgu
```

`WorkspaceShell.tsx` modül sabitini şablon dizgisine gömüyor. Küçültücü bunu tek dizgiye katlıyor: `https://docs.google.com/spreadsheets/d/<kimlik>/edit`. Ana uygulama URL'yi çalışma anında kurduğu için desene takılmıyor. Sonuç: tarama yayınlanan (gerçek kimlikli) build'de koşarsa yayın düşer. Bugünkü 27 karakterlik sentetik kimlik (`synthetic-budget-sheet-2098`) desenin 30 karakter alt sınırının altında kalıyor.

Öneri:
- Şimdi: gizlilik taraması sentetik build'de koşar. Kod aynıdır; iki build yalnız `define` ile gömülen iki değerde ayrılır.
- Sonra (g03-privacy): tarama, yapılandırılmış kamu kimliğini yalnız tam eşleşmeyle muaf tutacak bir seçenek alır (örneğin `--allow-sheet-id-from-env VITE_BUDGET_SHEET_ID`). Değer hiçbir zaman yazdırılmaz. Ardından tarama yayınlanan build'de de koşar.
- Bağlantıyı katlanmayacak biçimde yazmak (örneğin `sheetUrl`'yi `dashboard/data.ts`'den almak) bir düzeltme değildir. İfşa aynı kalır, yalnız dedektör kör olur.

### 4.4 Karar: build kanıtı Pages'e çıkmaz

| Dosya | Boyut (sentetik build) |
|---|---|
| `dist/.vite/manifest.json` | 18.073 B |
| `dist/.vite/delivery-graph.json` | 305.560 B |
| `dist/delivery-report.json` (varsayılan `--report`) | 17.182 B |

Gerekçeler:
- Tarayıcı bu dosyaları kullanmaz. `sw.js` 19 URL ön belleğe alır, hiçbiri bu dosyalar değildir. `globPatterns` json içermez.
- Dosyalar modül yolu ve paket envanteri yayınlar. Gizli değildirler ama gereksiz kamu yüzeyi ve bayttırlar.
- Kanıt ölçüm ve bütçe kapısı (e01) için gereklidir, yayın için değil.

Mekanizma (yama §4.5):
- `check-delivery --report` hedefi `dist` dışına alınır (`delivery-evidence/...`). Betik rapor klasörünü oluşturmadığı için önce `mkdir -p`.
- Son build'den ve tüm kapılardan sonra `.vite` içeriği `delivery-evidence/pages/` altına kopyalanır, `dist/.vite` ve olası `delivery-report.json` silinir. Ardından `dist` içinde nokta dosyası veya rapor kalmadığı denetlenir.
- `delivery-evidence` iş akışı artefaktı olarak 14 gün tutulur. Klasör adı nokta ile başlamaz, çünkü `upload-artifact` gizli dosyaları varsayılan olarak atlar.
- `upload-pages-artifact@v5` `.vite`'yi zaten dışarıda bırakır, ama bu öneri buna dayanmaz. `delivery-report.json` gizli dosya değildir, ve ileride `include-hidden-files: true` eklenirse `.vite` de yayına çıkar. Önerilen koruma testi bu ayarı reddeder.

Yerel benzetim: sentetik `dist` kopyasında adım koşturuldu. Önce `dist/.vite` ve `dist/delivery-report.json` vardı; sonra `find` boş döndü. `admin.html`, `index.html` ve `sw.js` yerinde kaldı.

### 4.5 Önerilen yama

`git apply --check` ile 67382b9 üzerinde temiz uygulanır. Kapı sırası:
- Telefon önce: `chromium` 320×568 dokunmatik ve `webkit` 390×844 dokunmatik.
- Sonra `@matrix` telefon projeleri: 320×480, 360×640, 375×667 ve 568×320 yatay telefon.
- Geniş en son: WebKit tablet 820×1180, WebKit ve Chromium masaüstü 1440×900.

Notlar:
- Yalnız Chromium ve WebKit kurulur.
- Her admin koşusu ayrı `AILE_PORT` alır. Böylece `test-results/admin-<port>` ve `playwright-report/admin-<port>` çıktıları birbirini silmez (W0 port sözleşmesi).
- Matris ve geniş adımları telefon adımı düşse de koşar. Kanıt kaybolmaz; iş yine kırmızı biter. Bu, dashboard için kurulan desenle aynıdır.
- `deploy.yml` yalnız telefon projelerini koşar. Tam matris yalnız PR/CI'dadır; legacy kapıyla aynı politika.
- Bugün `@matrix` etiketli test yok (`--list` sonucu 0). Matris adımı bu yüzden "No tests found" ile düşer. Bu bilinçlidir: boş geçen matris kapısı yoktur ve `--pass-with-no-tests` eklenmez. Yama, `@matrix` testleri entegrasyonda birleştikten sonra uygulanır.
- Teslim kapısı bugün ratchet modundadır. Baseline boşalınca (entegrasyonun `PHONE_WITHOUT_ANTD` kesimi) her `check-delivery` satırına `--strict` eklenir. Toplam üç satırdır: `ci.yml`'de bir, `deploy.yml`'de iki.

`ci.yml`:

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -41,9 +41,15 @@
       - run: pnpm build
         env:
           VITE_BUDGET_SHEET_ID: synthetic-budget-sheet-2098
+      - run: node scripts/check-dist-privacy.mjs dist
+      - run: mkdir -p delivery-evidence && node scripts/check-delivery.mjs dist --report delivery-evidence/delivery-report.json
+      - run: cp dist/.vite/manifest.json dist/.vite/delivery-graph.json delivery-evidence/
       - run: pnpm exec playwright test --config playwright.timeline-production.config.ts
         env:
           CI: 1
+      - run: pnpm exec playwright test --config playwright.admin-production.config.ts
+        env:
+          CI: 1
       - uses: actions/upload-artifact@v5
         if: failure()
         with:
@@ -55,3 +61,47 @@
             test-results-dashboard
             playwright-report-dashboard-long
             test-results-dashboard-long
+            delivery-evidence
+      - uses: actions/upload-artifact@v5
+        if: ${{ !cancelled() }}
+        with:
+          name: delivery-evidence
+          path: delivery-evidence
+          retention-days: 14
+  admin:
+    runs-on: ubuntu-latest
+    steps:
+      - uses: actions/checkout@v7
+      - uses: pnpm/action-setup@v6
+      - uses: actions/setup-node@v7
+        with:
+          node-version: 24
+          cache: pnpm
+      - run: pnpm install --frozen-lockfile
+      - run: pnpm exec playwright install --with-deps chromium webkit
+      # Phone first: Chromium 320x568 touch + WebKit 390x844 touch run every admin spec.
+      - id: admin_phone
+        run: pnpm e2e:admin --project=chromium --project=webkit
+        env:
+          CI: 1
+          AILE_PORT: 5300
+      # Phone matrix (@matrix): 320x480, 360x640, 375x667 and 568x320 landscape (still the phone profile).
+      - id: admin_matrix
+        if: ${{ !cancelled() && (steps.admin_phone.outcome == 'success' || steps.admin_phone.outcome == 'failure') }}
+        run: pnpm e2e:admin --project=chromium-short --project=chromium-360 --project=chromium-375 --project=chromium-landscape
+        env:
+          CI: 1
+          AILE_PORT: 5302
+      # Wide last: WebKit tablet 820x1180, WebKit and Chromium desktop 1440x900.
+      - if: ${{ !cancelled() && (steps.admin_phone.outcome == 'success' || steps.admin_phone.outcome == 'failure') }}
+        run: pnpm e2e:admin --project=webkit-tablet --project=webkit-desktop --project=chromium-desktop
+        env:
+          CI: 1
+          AILE_PORT: 5304
+      - uses: actions/upload-artifact@v5
+        if: failure()
+        with:
+          name: admin-test-report
+          path: |
+            playwright-report
+            test-results
```

`deploy.yml`:

```diff
--- a/.github/workflows/deploy.yml
+++ b/.github/workflows/deploy.yml
@@ -45,13 +45,21 @@
       - run: pnpm build
         env:
           VITE_BUDGET_SHEET_ID: synthetic-budget-sheet-2098
+      # Admin release gates on the synthetic build (no real sheet id in dist yet).
+      - run: node scripts/check-dist-privacy.mjs dist
+      - run: mkdir -p delivery-evidence/synthetic && node scripts/check-delivery.mjs dist --report delivery-evidence/synthetic/delivery-report.json
       - run: pnpm exec playwright test --config playwright.finansman.config.ts
         env:
           CI: 1
+      - run: pnpm exec playwright test --config playwright.admin-production.config.ts
+        env:
+          CI: 1
       - run: pnpm build
         env:
           VITE_BUDGET_SHEET_ID: ${{ vars.VITE_BUDGET_SHEET_ID }}
           VITE_API_URL: ${{ vars.VITE_API_URL }}
+      # The published build must pass the phone delivery gate too (graph does not depend on env).
+      - run: mkdir -p delivery-evidence/pages && node scripts/check-delivery.mjs dist --report delivery-evidence/pages/delivery-report.json
       - run: pnpm exec playwright test --config playwright.timeline-production.config.ts
         env:
           CI: 1
@@ -66,12 +74,52 @@
             test-results-dashboard
             playwright-report-dashboard-long
             test-results-dashboard-long
+            delivery-evidence
+      # Build evidence stays out of the Pages artifact; it is kept as a workflow artifact instead.
+      - name: Move build evidence out of dist
+        run: |
+          mkdir -p delivery-evidence/pages
+          cp dist/.vite/manifest.json dist/.vite/delivery-graph.json delivery-evidence/pages/
+          rm -rf dist/.vite
+          rm -f dist/delivery-report.json
+          leftovers="$(find dist -name '.*' -o -name 'delivery-report.json')"
+          if [ -n "$leftovers" ]; then echo "evidence left in dist: $leftovers"; exit 1; fi
+      - uses: actions/upload-artifact@v5
+        with:
+          name: delivery-evidence
+          path: delivery-evidence
+          retention-days: 14
       - uses: actions/configure-pages@v6
       - uses: actions/upload-pages-artifact@v5
         with:
           path: dist
+  admin:
+    runs-on: ubuntu-latest
+    permissions:
+      contents: read
+    steps:
+      - uses: actions/checkout@v7
+      - uses: pnpm/action-setup@v6
+      - uses: actions/setup-node@v7
+        with:
+          node-version: 24
+          cache: pnpm
+      - run: pnpm install --frozen-lockfile
+      - run: pnpm exec playwright install --with-deps chromium webkit
+      # Release gate for admin.html: phone projects only (Chromium 320x568 touch, WebKit 390x844 touch).
+      - run: pnpm e2e:admin --project=chromium --project=webkit
+        env:
+          CI: 1
+          AILE_PORT: 5300
+      - uses: actions/upload-artifact@v5
+        if: failure()
+        with:
+          name: admin-test-report
+          path: |
+            playwright-report
+            test-results
   deploy:
-    needs: build
+    needs: [build, admin]
     runs-on: ubuntu-latest
     environment:
       name: github-pages
```

Neden ayrı `admin` işi: dev kapısı `test-results/admin-<port>` altına yazar. Aynı işte sonradan koşan legacy ve üretim koşucuları kendi kök çıktı klasörlerini temizler. Ayrı iş bu kanıtı korur ve dashboard E2E (son koşuda 16,5 dk) ile paralel ilerler. `admin-production` kapısı sentetik `dist`'e ihtiyaç duyduğu için `build` işinde, sentetik build'in arkasında kalır. Admin işi yalnız `contents: read` yetkisi alır.

### 4.6 Önerilen koruma testi

Codex yamayla aynı commit'te bu bloğu `src/browser-matrix.test.ts` sonuna ekler: önce test (RED), sonra yama (GREEN).

```ts
// Yönetim paneli yayın kapısı (docs/ADMIN-DEPLOY-PROPOSAL.md): admin E2E ayrı işte ve telefon projeleri önce koşar;
// gizlilik + teslim kapıları sentetik build'den sonra gelir; build kanıtı (.vite, delivery-report.json) Pages'e çıkmaz.
describe('yönetim paneli CI ve yayın kapısı', () => {
  const read = (name: string) => readFileSync(join(workflowDir, name), 'utf8');
  const lines = (source: string) => source.split('\n');
  const adminRuns = (source: string) => lines(source).filter(line => /run: pnpm e2e:admin\b/.test(line));
  const at = (source: string, needle: string) => lines(source).findIndex(line => line.includes(needle));
  for (const workflow of ['ci.yml', 'deploy.yml']) {
    it(`${workflow} sentetik build'den sonra gizlilik, teslim ve yönetim üretim kapısını koşar`, () => {
      const source = read(workflow);
      const build = lines(source).findIndex((line, i, all) => /- run: pnpm build$/.test(line) && (all[i + 2] ?? '').includes('synthetic-budget-sheet-2098'));
      expect(build, 'sentetik pnpm build adımı').toBeGreaterThanOrEqual(0);
      for (const needle of ['- run: node scripts/check-dist-privacy.mjs dist', 'node scripts/check-delivery.mjs dist', '--config playwright.admin-production.config.ts']) {
        expect(at(source, needle), needle).toBeGreaterThan(build);
      }
    });
    it(`${workflow} yönetim E2E'sini ayrı işte, önce telefon projeleriyle koşar`, () => {
      const source = read(workflow);
      expect(source).toMatch(/^ {2}admin:\n {4}runs-on: ubuntu-latest$/m);
      const runs = adminRuns(source);
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0]).toContain('--project=chromium --project=webkit');
      expect(runs[0]).not.toMatch(/--project=\S*(?:tablet|desktop|short|landscape|360|375)/);
    });
  }
  it('ci.yml telefon → @matrix telefon → geniş sırasını korur', () => {
    const runs = adminRuns(read('ci.yml'));
    expect(runs).toHaveLength(3);
    expect(runs[1]).toMatch(/--project=chromium-short .*--project=chromium-landscape/);
    expect(runs[2]).toMatch(/--project=webkit-tablet .*--project=chromium-desktop/);
  });
  it('deploy.yml yalnız telefon projelerini koşar, yayını admin işine bağlar ve kanıtı artefakttan çıkarır', () => {
    const source = read('deploy.yml');
    expect(adminRuns(source)).toHaveLength(1);
    expect(source).toContain('needs: [build, admin]');
    const lastBuild = lines(source).findLastIndex(line => /- run: pnpm build$/.test(line));
    const removal = at(source, 'rm -rf dist/.vite');
    expect(removal).toBeGreaterThan(lastBuild);
    expect(at(source, 'rm -f dist/delivery-report.json')).toBeGreaterThan(lastBuild);
    expect(at(source, '- uses: actions/upload-pages-artifact@')).toBeGreaterThan(removal);
    expect(source).not.toMatch(/include-hidden-files:\s*true/);
  });
});
```

Doğrulama (yerel, workflow dosyalarının kopyasında):
- Bugünkü workflow'larla 6 yeni test RED düştü. Nedenler doğru: privacy satırı yok (`-1`), `admin` işi yok, admin koşusu yok. Mevcut 16 test geçti.
- Yamalı kopyada 22/22 GREEN.
- Mevcut koruma testleri (Firefox yasağı, legacy hedefli kapı, dashboard çıktı klasörleri, `if: failure()` yükleme) yamalı kopyada 16/16 geçti. Kontrol amaçlı `firefox` eklenen kopyada 1 test düştü; yani kopya gerçekten okunuyor.
- Blok, repo derleyici ayarlarıyla `tsc` hatasız geçti.
- İki dosya Ruby YAML ile ayrıştırıldı: `ci.yml` işleri `test`, `admin`; `deploy.yml` işleri `build`, `admin`, `deploy` (`needs: [build, admin]`).
- `actionlint` bu makinede yok. GitHub üzerinde koşu yapılmadı.

## 5. Sürüm kayması: eski admin.html ve yeni parçalar

Pages yayını eski karma adlı dosyaları siler. İçeriği değişmeyen parçalar aynı adı korur; yalnız değişen parçalar 404 olur.

| Durum | Bugünkü davranış | Öneri | Sahip |
|---|---|---|---|
| Açık sekme, yayından sonra henüz yüklenmemiş bir sayfaya gidiş | `routes.tsx` sayfaları `React.lazy` ile yükler ve yalnız `Suspense` vardır. Eski parça 404 olunca lazy hata fırlatır. Rota katmanında hata sınırı yoktur, React kökü söker ve sayfa boş kalır. Kaynak: kod incelemesi, tarayıcıda koşulmadı. | Her rota `Suspense`'inin dışında hata sınırı. `isChunkLoadError` doğruysa (`../adaptive` dışa aktarır) `WideNotice kind="stale-build"`: "Yeni sürüm var · Yenile". Değilse ErrorState "Yeniden dene" (lazy yeniden kurulur). PageHeader ve gezinme yerinde kalır. Önce başarısız birim testi. | b02-header-routes |
| Geniş-özel parça (`lazyWide`) | 800 ms sonra bir kez yeniden dener. Çevrimiçi ve parça hatasıysa "Yeni sürüm var · Yenile" çıkar. Telefon sunumu kullanılabilir kalır (W0). | Yeterli. Entegrasyonda üretim kanıtı. | entegrasyon |
| ECharts (`ui/Chart.tsx`) | Hata sınırı var; tablo ve metin alternatifi kalır | Yeterli | a13-chart-icons |
| Vite ön yükleme (CSS/JS bağımlılığı) | Yardımcı iptal edilebilir `vite:preloadError` olayı yayar. Dinleyici yoksa hata yeniden fırlatılır ve yukarıdaki satıra düşer (`dist/assets/shared-*.js` içinde doğrulandı). | `main.tsx`'te dinleyici: parça hatasıysa tek seferlik yenileme. Döngüye karşı zaman damgalı koruma kullanılır. `preventDefault` yalnız yenilerken çağrılır. | entegrasyon |
| Eski `admin.html` HTTP önbelleğinden (en çok 600 sn) | Eski giriş parçası yoksa modül betiği yüklenmez. `admin.html` başlangıç betiği yalnız klavye modunu kurar; sayfa mesajsız boş kalır. | Ana girişteki `startupFailureScript` benzeri düz HTML hata betiği: "Uygulama yüklenemedi. Yenile". | entegrasyon (`vite.config.ts`, `src/admin/startup.ts`) |
| Ana SW denetimindeki admin sekmesi | SW kapsamı `/aile/` olduğu için `admin.html` de denetlenir. `aile-visited-modules` CacheFirst önbelleği (30 giriş, 7 gün) admin parçalarını da saklar. Önce ziyaret edilmiş eski parça 404 yerine önbellekten gelir; bu kaymayı yumuşatır. Ama admin parçaları 30 girişlik sınırı doldurup ana uygulamanın tembel parçalarını önbellekten itebilir. Ölçülmedi. | Üretim kapısında ölç: admin gezintisinden sonra ana uygulamanın çevrimdışı tembel parçaları. Gerekirse admin için ayrı önbellek. | e02-production, entegrasyon |
| Yerel durum (IndexedDB) | Eski ve yeni sekme aynı depoları paylaşır: change set `aile:admin:changeset:v1`, nesil önbelleği `aile-admin/partitions` | Şema değişirse yeni sürüm anahtarı ve göç testi. Eski sürüm bilinmeyen sürümü yok sayar. | d03-changeset, d02-loading |

Kabul ölçütü (entegrasyon E2E, üretim önizlemesi): açık sekmede bir sayfa parçası silinip başka bir rotaya gidilir. Sonuç boş sayfa değil, "Yeni sürüm var · Yenile" olmalı; PageHeader ve gezinme görünür kalmalı. Ölçüt 320×568 Chromium ve 390×844 WebKit'te sağlanmalı.

## 6. Ortak köken: gerçek veri ve anahtar

`karacaismail.github.io` tek kökendir. Hesabın 98 açık reposundan 79'unda Pages açık (GitHub API, 2 Kasım 2026). Bu projelerin her sayfası aynı kökende çalışır ve aynı depolara erişir:
- `aile-admin/partitions` IndexedDB'si: panelin nesil önbelleği. Klasör içe aktarılınca gerçek aile verisini tutar.
- Change set: notlar ve durum değişiklikleri.
- `localStorage` içindeki `aile:appKey` (ana uygulamanın Apps Script anahtarı).

Service worker kapsamı klasöre bağlı olduğu için başka bir proje `/aile/` SW'sini ele geçiremez. Depolama ise köken düzeyindedir.

Seçenekler (kullanıcı kararı):

| Seçenek | Etkisi | Sahipler |
|---|---|---|
| A. Ayrı köken (özel alan adı, örneğin `aile.<alan-adı>`; alan adı bilinmiyor) | Kalıcı çözüm. Vite `base` `/aile/`'den `/`'e iner. `manifest` `start_url`/`scope`, `admin.html` simge yolları, Playwright `baseURL`'leri ve README bağlantıları değişir. Ayrı bir görevdir. | Hüseyin Cengiz kayıt gereksinimini hazırlar: `CNAME aile → karacaismail.github.io.` ve GitHub alan doğrulaması için TXT `_github-pages-challenge-karacaismail.<alan-adı>`. Asistan Hüseyin GoDaddy'de uygular. Codex Pages özel alan adını ve kod PR'ını yapar. Hüseyin Cengiz `dig` ve `curl -I https://…` ile sonucu doğrular. |
| B. Pages build'inde kalıcı nesil önbelleği kapalı | Veri yalnız sekme belleğinde kalır, her oturumda klasör yeniden seçilir. Change set'in kalıcılığı ayrı bir karardır (D4). | d02-loading, entegrasyon (`App.tsx`) |
| C. Gerçek veriyle yalnız yerel önizleme (`127.0.0.1`) | Pages'teki panel yalnız arayüz incelemesi içindir. Telefondan gerçek veri kullanımı yoktur. | Kullanıcı |

Öneri: kalıcı çözüm A. A gelene kadar B veya C. Telefon (iOS Safari) klasör seçimi bilinmiyor; c11-veri yedeği ve gerçek cihaz kontrolü gerekir.

## 7. Canlı yazma yolu ve Apps Script fail-closed

- Bugün panelde ağa yazma yok. `data/changeSet.ts` yalnız yerel IndexedDB'ye yazar. `toBatch()` yalnız dönüştürür; `data/live.ts` yalnız okur. Yayın bu haliyle Sheets'e yazmaz.
- Önkoşul 98dff0d (`claude/p0-api-fail-closed`, `main`'de değil). `APP_KEY` tanımsızken Apps Script her okuma, yazma ve `wire`/`unwire` isteğini `unauthorized` ile reddeder. `?action=setup` web adresinden çalışmaz. Bugünkü `main`'de `APP_KEY` yoksa adresi bilen herkes okuyup yazabilir. Adres de `VITE_API_URL` olarak kamu paketindedir.
- Sıra (Codex):
  1. Script Properties'te `APP_KEY` tanımlı olduğunu doğrula. Tanımsızsa önce tanımla; aile cihazları anahtarı Ayarlar'a girer. Anahtar değeri bu belgeye, Git'e veya sohbet çıktısına yazılmaz.
  2. 98dff0d'yi `main`'e al.
  3. `scripts/gas-setup.sh push` ve `scripts/gas-setup.sh deploy` (aynı `deploymentId`).
  4. Doğrula. `curl -sL "<exec adresi>?action=health"` sonucunda `ok: true` olmalı. Anahtarsız `read` isteği `unauthorized`, `?action=setup` isteği `bad_request` dönmeli.
- Paneldeki "Sheets'e gönder" özelliği ancak bu adımlardan, ayrı köken kararından (§6 A) ve change set gönderiminin kendi TDD'sinden (idempotent `opId`, çakışma görünümü, geri alma) sonra açılır. Paylaşılan anahtar kullanıcı, rol veya hane yetkilendirmesi değildir. Ortak kökende diğer Pages projeleri bu anahtarı okuyabilir.

## 8. Entegrasyon kararı: @babel/runtime antd grubundan ayrılır

Ölçüm (sentetik build, manifest `imports` kapanışı, gzip düzey 9):
- `@babel/runtime` bugün `antd` grubunda. `antd-*.js` 28 `@babel/runtime` modülü taşıyor.
- Ana uygulamanın tembel `LegacyApp` girişi, `@mantine/notifications` ve `react-transition-group` yardımcıları için `antd-*.js`'yi statik import ediyor (delivery-graph kenarları). Bu giriş planlayıcı rotalarında açılır: `satinalma`, `aydinlatma`, `tadilat`, `yerlesim`, `butce` (PWA "Harcama ekle" kısayolu dahil) ve `ayarlar`.
- `LegacyApp` statik kapanışı 20 dosya, 2.465.817 B ham / 683.389 B gzip. antd parçası olmasa 1.730.548 / 450.179 olurdu. Fark +735.269 B ham ve +233.210 B gzip; gzip'te %51,8 artış.
- `main`'de (c62f2a6) antd yok. Bu gerileme ana uygulamaya admin birleşmesiyle gelir.

Öneri (entegrasyon, `vite.config.ts` `CHUNK_GROUPS`):
- Ayrı grup ekle: `{ name: 'babel-runtime', priority: 11, test: (id) => /node_modules[\\/]@babel[\\/]runtime[\\/]/.test(id) }`. Önceliği antd'den yüksek, pro/icons'tan düşüktür. `antd` testinden `@babel[\\/]runtime` çıkarılır.
- Ana ön bellek erişimi `LegacyApp`'te durur. Yeni parça bu yüzden `adminPrecacheScope` ile ön bellek dışında kalır; precache 19 giriş ve 897,8 KiB değişmemelidir. Bu `vite-config.test` ile kanıtlanır.
- Yeni grup yasak sınıf değildir. Telefon profilinde `@babel/runtime` isteyen bir modül artık antd'yi çekmez; `PHONE_WITHOUT_ANTD` kesimi de bundan yararlanır.
- Kabul: build manifestinde `src/LegacyApp.tsx` `imports` listesi `_antd-*` içermez. `check-delivery` ratchet PASS kalır. e02 üretim kapısı ve precache sayısı değişmez.

## 9. Geri alma

1. Kalıcı geri alma (Codex): `main`'de admin birleşme commit'i geri alınır (`git revert -m 1 <birleşme-sha>`), push edilir, `deploy.yml` koşar. Doğrulama:
   - `curl -s -o /dev/null -w "%{http_code}\n" https://karacaismail.github.io/aile/admin.html` 404 döner.
   - `/aile/` 200 döner.
   - Ana uygulama SW'si `autoUpdate` ile yeni precache'e geçer.
2. Acil geri alma: son başarılı `main` yayın koşusu yeniden koşturulur (`gh run rerun <run-id>`; bugün 41302668945 / 25a5ed5). Yeniden koşu o commit'i güncel repo değişkenleriyle yeniden derler.
   - Sınır: GitHub yeniden koşuyu ilk koşudan sonraki 30 gün içinde kabul eder.
   - `concurrency: pages` / `cancel-in-progress` yüzünden geri alma sürerken yeni push yapılmaz.
   - `main` HEAD yeni kodda kalır. Ardından 1. adım uygulanır.
3. Yapılamayan: etiket veya başka dal üzerinden `workflow_dispatch`. `github-pages` ortamı yalnız `main`'e izin verir. Eski Pages artefaktı da 1 gün sonra silinir.
4. Apps Script (Codex):
   - Sürümleri listele: `pnpm exec clasp list-versions`.
   - Geri dön: `pnpm exec clasp create-deployment -i <deploymentId> -V <sürüm> -d "geri alma"`. clasp 3.4.1 bayrakları `--help` ile doğrulandı.
   - Fail-closed öncesi bir sürüme asla dönülmez.
   - Geri dönüşten sonra §7'deki doğrulama tekrarlanır.
5. Tarayıcı durumu: geri alma IndexedDB'yi (change set, nesil önbelleği) ve `localStorage`'ı silmez. Bu bilinçlidir: veri kaybı olmaz. Kullanıcı isterse temizlemeyi Ayarlar'dan yapar.
6. Kanıt: `delivery-evidence` artefaktı (14 gün) önceki ve sonraki yayının teslim raporunu karşılaştırmaya yeter.

## 10. Devir adımları (Codex)

1. Ö1: `main` yayın akışını yeşile döndür.
2. Entegrasyon adayı Ö2–Ö4'ü kanıtla teslim etsin.
3. Önce §4.6 testi (RED), sonra §4.5 yaması (GREEN). Aynı commit'te `AGENTS.md`'deki "yerel; CI'ya eklenmedi" satırı güncellenir (g01-docs).
4. PR CI'da `test` ve `admin` işleri yeşil olsun.
5. Kullanıcı onayıyla `main`'e birleştir ve push et. `deploy.yml` sırasıyla `build` ve `admin`, ardından `deploy` işlerini koşar.
6. Yayından sonra doğrula:
   - `curl -sI https://karacaismail.github.io/aile/admin.html` 200 ve `text/html` döner.
   - `.../aile/.vite/manifest.json` ve `.../aile/delivery-report.json` 404 döner.
   - `admin.html#/genel` 320 px Chromium ve WebKit'te açılır.
   - `/aile/` soğuk açılışında admin parçası istenmez (e02 kapısının canlı karşılığı).
7. Gerçek iPhone Safari, Android Chrome ve macOS Safari kontrolleri ayrı raporlanır; emülasyon yerine geçmez.

## 11. Bu görevde koşulanlar ve koşulmayanlar

Koşulanlar (yerel, 2 Kasım 2026):
- Sentetik `pnpm build`: precache 19 giriş, 897,82 KiB.
- `check-dist-privacy`: 0 bulgu.
- `check-delivery`: ratchet PASS. `--strict` çıkış 1 (beklenen).
- Uzun sentetik kimlikle deneme build'i: gizlilik taraması 1 bulgu (§4.3).
- Admin E2E `--list` sayıları: telefon 282 test (10 dosya), `@matrix` 0, geniş 141, üretim 10.
- `git apply --check`, §4.6 RED/GREEN, YAML ayrıştırma.
- Canlı Pages başlıkları ve yol yanıtları.
- GitHub API ve `gh` okumaları: Pages ayarı, değişken adları, ortam dal kuralı, koşu geçmişi.

Koşulmayanlar:
- Önerilen iş akışlarının GitHub üzerinde koşusu ve `actionlint`.
- Admin E2E tam matrisi; görev sınırı gereği.
- §5 sürüm kayması senaryolarının tarayıcıda yeniden üretimi.
- SW önbellek dolması ölçümü.
- Gerçek cihaz kontrolleri.
