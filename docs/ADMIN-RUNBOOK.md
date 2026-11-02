# Yönetim paneli çalıştırma kılavuzu

Tarih: 2 Kasım 2026. Kapsam: `admin.html` yönetim paneli (`src/admin`). Kalıcı kurallar kökteki `AGENTS.md` "Yönetim paneli" bölümünde, yürütme planı `docs/ADMIN-PANEL-PARALLEL-PLAN.md` içindedir. Bu belge nasıl yapılacağını anlatır: önizleme, kapılar, kanıt, Codex devri ve kullanıcı incelemesi.

Bu belgede hiçbir gizli değer yoktur ve olmamalıdır. Sheet kimliği, Apps Script adresi, `APP_KEY`, özel nesil yolu, nesil kimliği ve emeklilik profili yolu yalnız adıyla geçer; değerler `<...>` ya da `/PRIVATE/...` yer tutucusudur.

## 1. Roller ve sınırlar

- Claude: ayrı worktree'de uygulama, test ve yerel commit. `main`, push, GitHub Pages yayını ve Apps Script dağıtımı yetkisi yoktur.
- Codex: `main` birleştirmesi, push, Pages yayını ve Apps Script dağıtımı; canlı yayın kullanıcının açık onayıyla yapılır.
- Kullanıcı: yayın onayı, görsel referans onayı, gerçek veriyle önizleme isteği.
- Bu teslimde sunucu işi (Hüseyin Cengiz) ve alan adı/DNS işi (Asistan Hüseyin) yoktur.
- Komutları ajan çalıştırır; kullanıcıya "şunu çalıştırın" denmez. Parola, `sudo` ya da kullanıcı onayı gereken adım olursa nedeni açıkça yazılır.

## 2. Hazırlık

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
```

Yalnız Chromium (Chrome ailesi) ve WebKit (Safari ailesi) kurulur; Firefox kurulmaz ve çalıştırılmaz. Node sürümü `package.json` `engines` alanındadır (≥ 22.12). Bağımlılık eklenmez ya da yükseltilmez; `package.json` ve kilit dosyası yalnız açıkça izinli görevde değişir.

## 3. Sentetik önizleme (varsayılan)

Ajan, kullanıcıya göstermek veya kendisi denetlemek için önizlemeyi şöyle açar. Değerler kabukta verildiği için `.env.local` içindeki gerçek değerler bu sunucuya girmez (Vite kabuktaki `VITE_` değerini dosyadakine tercih eder).

```bash
AILE_GENERATION_DIR="$PWD/fixtures/generation-synthetic" VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 \
  AILE_EMEKLILIK_PROFILE="$PWD/fixtures/emeklilik/profil-sentetik.json" \
  pnpm exec vite --host 127.0.0.1 --port <P> --strictPort
```

- Adres: `http://127.0.0.1:<P>/aile/admin.html#/genel`. Diğer sayfalar `#/butce`, `#/odemeler`, `#/hesaplar`, `#/emeklilik`, `#/alimlar`, `#/ev`, `#/projeler`, `#/taraflar`, `#/raporlar`, `#/sozlukler`, `#/veri`, `#/ayarlar`.
- Emeklilik planı (`#/emeklilik`) sentetik profili `/__aile/emeklilik/profil.json` yolundan okur. `AILE_EMEKLILIK_PROFILE` verilmezse sayfa "AILE_EMEKLILIK_PROFILE tanımlı değil" nedeniyle profilsiz açılır; profil dosyası sayfadan içe aktarılabilir.
- Port seçimi: kullanıcının açık sunucularına (5174, 5175, 5176) dokunulmaz, kapatılmaz. 5300 ve üstündeki çift yuvalar paralel E2E koşularınındır. Boş bir port seçilir; `--strictPort` dolu portta koşuyu durdurur.
- İş bitince sunucu kapatılır (Ctrl+C). `lsof -nP -iTCP:<P> -sTCP:LISTEN` boş dönmelidir.

## 4. Gerçek veriyle yerel önizleme

Bu adım gerçek aile verisine dokunur. Yalnız kullanıcının açık isteğiyle, kullanıcının ana kopyasında (`site/`) yapılır. Paralel üretim agent'ları bu adımı yapmaz; `.env.local` dosyasını okumaz, kopyalamaz, yazdırmaz.

Kullanılan anahtarlar ana kopyanın `.env.local` dosyasındadır (Git dışında; değerler hiçbir belgeye, commit'e veya sohbete yazılmaz). `AILE_EMEKLILIK_PROFILE` isteğe bağlıdır ve gösterdiği profil dosyası da Git dışında durur:

| Anahtar | Okuyan | Not |
|---|---|---|
| `VITE_BUDGET_SHEET_ID` | Vite, istemci koduna (`import.meta.env`) | Canlı bütçe okuması ve "E-tabloyu aç" bağlantısı |
| `AILE_GENERATION_DIR` | Yalnız dev middleware `/__aile/generation/*` (`src/admin/devServer/privateData.ts`), yalnız süreç ortamından | data-platform ile üretilmiş özel nesil kökü (`/PRIVATE/data` gibi; `generations/<sha256>/manifest.json` taşır) |
| `AILE_EMEKLILIK_PROFILE` (isteğe bağlı) | Yalnız dev middleware `/__aile/emeklilik/profil.json` (aynı dosya), yalnız süreç ortamından | Git dışındaki kişisel emeklilik profili (`/PRIVATE/emeklilik/profil.json` gibi; tek `.json` dosyası, sözleşmesi `src/admin/emeklilik/contract.ts` `EmeklilikProfili`) |

Emeklilik profili `AILE_EMEKLILIK_PROFILE` değişkeninin gösterdiği Git dışı tek `.json` dosyasıdır; değer ve dosya hiçbir belgeye, commit'e, teste veya kanıta girmez. Geliştirmede ara katman onu yalnız okur. Üretimde (Pages) varsayılan profil kaynağı yoktur ve istek yapılmaz: kullanıcı dosyayı Emeklilik planı sayfasından içe aktarır ve profil yalnız sekmenin belleğinde tutulur; tarayıcı depolamasına yazılmaz (9. bölüm).

Vite `.env.local` içinden yalnız `VITE_` önekli anahtarları alır; `AILE_GENERATION_DIR` ve `AILE_EMEKLILIK_PROFILE`'ı süreç ortamına koymaz. Ara katman da `.env` / `.env.local` dosyalarını okumaz (birim testi `privateData.test.ts` bunu denetler). Bu yüzden düz `pnpm dev` gerçek nesli ve kişisel profili göremez ve sunucu Node'un `--env-file=.env.local` seçeneğiyle açık komutla başlatılır. Kabukta aynı adlı bir değişken varsa hem Node hem Vite onu dosyaya tercih eder; `env -u` bu yüzden üçünü de temizler.

1. Değer yazdırmadan anahtarların tanımlı olduğunu denetleyin:

   ```bash
   env -u VITE_BUDGET_SHEET_ID -u AILE_GENERATION_DIR -u AILE_EMEKLILIK_PROFILE node --env-file=.env.local \
     -e 'for (const k of ["VITE_BUDGET_SHEET_ID", "AILE_GENERATION_DIR", "AILE_EMEKLILIK_PROFILE"]) console.log(k, process.env[k]?.trim() ? "tanımlı" : "TANIMSIZ")'
   ```

   İlk ikisi "tanımlı" olmalıdır. `AILE_EMEKLILIK_PROFILE` isteğe bağlıdır; tanımsızsa Emeklilik planı profilsiz açılır. `.env.local` yoksa Node açık hatayla durur.

2. Sunucuyu başlatın (port kuralları 3. bölümdeki gibidir):

   ```bash
   env -u VITE_BUDGET_SHEET_ID -u AILE_GENERATION_DIR -u AILE_EMEKLILIK_PROFILE \
     node --env-file=.env.local node_modules/vite/bin/vite.js --host 127.0.0.1 --port <P> --strictPort
   ```

3. Neslin servis edildiğini yalnız durum koduyla doğrulayın: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<P>/__aile/generation/_meta` → `200`. `404` ise gövde (`curl -s` ile) nedeni yol vermeden söyler: "AILE_GENERATION_DIR tanımlı değil" ya da "geçerli nesil yok". Emeklilik profili için de yalnız durum kodu denetlenir, gövde yazdırılmaz (kişisel değer taşır): `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<P>/__aile/emeklilik/profil.json` → `200`. `404` "tanımlı değil" ya da "dosyası bulunamadı", `422` dosyanın JSON olmadığı demektir; nedeni görmek için yalnız hata gövdesi okunur.
4. `http://127.0.0.1:<P>/aile/admin.html#/genel` adresini açın. Tazelik satırında yüklenen nesil kısa kimliğiyle görünmelidir.
5. İş bitince sunucuyu kapatın.

Yerel klasör içe aktarma Chromium ailesinde File System Access API (`showDirectoryPicker`), Safari/WebKit'te `<input webkitdirectory>` yedeğiyle yapılır; Veri sayfası yolu özellik algılamayla seçer. Üretim build'i varsayılan olarak hiçbir nesil isteği yapmaz ve klasör içe aktarma durumunda açılır; `VITE_AILE_GENERATION_URL` yalnız açık seçimle HTTP kaynağı verir (yalnız yerel önizleme için).

Gerçek veriyle yapılan önizleme kanıt üretmez: ekran görüntüsü, trace, `dist/` veya rapor Git'e ya da paylaşılan kanıta girmez. Kanıta yalnız "gerçek nesil yüklendi: evet/hayır" gibi değer içermeyen metin yazılır. Kapılar her zaman sentetik veriyle koşar; gerçek değerlerle yapılmış bir build kapı girdisi olamaz.

## 5. Kapıları koşma

Paralel koşularda her ağır komut koşu kilidinden geçer: `node <koşu klasörü>/ops/slot.mjs <unit|build|e2e> -- <komut>`. Kilit Git dışındadır; kapasite unit 6, build 2, e2e 4 ve kilit vitest komutuna `--maxWorkers=2` ekler (sınırsız işçiyle eşzamanlı koşular makineyi kilitliyordu). Kilidi beklemek normaldir; komut arka plana atılmaz.

| # | Kapı | Komut | Geçme ölçütü |
|---|---|---|---|
| 1 | Tür denetimi | `pnpm typecheck` | Çıkış 0 |
| 2 | Birim testleri | Görevde `pnpm exec vitest run <dosyalar>`; entegrasyonda `pnpm test` | Hepsi geçer; atlanan test yok |
| 3 | Sentetik nesil | `node scripts/synthetic-generation.mjs <boş geçici klasör>` ve `diff -r <boş geçici klasör> fixtures/generation-synthetic` | `diff` çıktısı boş (nesil deterministik) |
| 4 | Build | `VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098 pnpm build` | Çıkış 0; `dist/.vite/manifest.json` ve `dist/.vite/delivery-graph.json` var |
| 5 | Gizlilik | `pnpm check:privacy` (`node scripts/check-dist-privacy.mjs dist`), 4. adımın sentetik build'inden sonra | "dist-privacy: 0 bulgu, dist tarandı." |
| 6 | Teslim | `pnpm check:delivery` (`node scripts/check-delivery.mjs dist --strict`); görevde ve entegrasyonda aynı, tek mod `--strict` | "sonuç: PASS (strict: ihlal yok)"; rapor `dist/delivery-report.json`; telefon kümesi `admin.html` ve her rota sayfasının statik kapanışıdır. `src/admin/vite-config.test.ts` aynı denetimi gerçek build'de koşar |
| 7 | Bütçe | `pnpm check:budgets` (`node scripts/check-budgets.mjs dist`); aynı build'de 6. adımdan sonra, çünkü `dist/delivery-report.json`'ı okur | Ölçülmüş bütçe seti aşılmaz. Tavanlar ölçüme eşittir, `scripts/check-budgets.test.mjs` `CEILING_LOCK` ile kilitlidir ve yalnız düşer; `src/admin/vite-config.test.ts` kapıyı gerçek build'de koşar. Eşikler ve ölçüm koşulları `docs/ADMIN-BUDGETS.md` |
| 8 | E2E (dev) | Görevde `AILE_PORT=<P> pnpm exec playwright test --config playwright.admin.config.ts --project chromium --project webkit <spec>` | Hepsi geçer |
| 9 | Üretim ağ yalıtımı | `AILE_PORT=<P> pnpm exec playwright test --config playwright.admin-production.config.ts` (4. adımın `dist` çıktısıyla; port P+1) | Hepsi geçer |

Notlar:

- Build kabukta sentetik Sheet kimliğiyle koşar. Kabuk değeri `.env.local`'daki değeri ezer; aksi halde gerçek kimlik `dist/` içine gömülür ve kapı girdisi geçersiz olur.
- Gizlilik kapısı yalnız sentetik build içindir: yayın build'i gerçek Sheet kimliğini ve Apps Script adresini bilerek gömer ve bu kapıdan geçmez. Kurallar Git dışı çalışma klasörü ve mutlak kullanıcı yolu, `AILE_GENERATION_DIR` değeri, Sheet kimliği, Apps Script adresi ve dağıtım kimliği, e-posta, nesil kimliği yolu, nesil manifesti, kayıt parçaları ve partition zarfı, source map içeriği ve emeklilik profilidir. Bulgu değeri yazdırılmaz.
- Gizlilik kapısı `dist` yoksa "taranacak çıktı yok, kapı atlandı" der ve 0 ile çıkar. Bu geçme kanıtı değildir; kapı her zaman 4. adımdan sonra koşar.
- Gizlilik kapısı emeklilik profilini de arar: değeriyle birlikte geçen profil alanı (`dogumTarihi`, `ilkSigortaGirisi`, `sgkReferansAylik.tl`, `kayitliGun.gun`, `kazanc.sonPekTl`) `retirement-profile`, `AILE_EMEKLILIK_PROFILE` değeri (yol) `retirement-profile-path` bulgusudur. Yalnız `fixtures/emeklilik/profil-sentetik.json` (`sentetik: true`) değerleri muaftır. Kapı koşarken `AILE_EMEKLILIK_PROFILE` tanımlıysa o dosyadaki doğum tarihi dist'in her yerinde aranır; değer ve yol hiçbir zaman yazdırılmaz.
- Teslim kapısı çıkış kodları: 0 PASS, 1 FAIL, 2 girdi hatası (build yok, eski grafik, hatalı argüman). Tek mod `--strict`'tir: tek ihlal FAIL'dir ve `scripts/delivery-baseline.json` boş kalır. Ratchet modu (`--strict`'siz) yalnız geçiş dönemi içindi; baseline'a kimlik eklemek kuralı gevşetir ve yalnız entegrasyon sahibinin açık kararıdır. İhlal `<sınıf> <- <içe aktaran>` ve `yol: admin.html > <sayfa> > …` satırıyla yazılır; düzelten görev yolun artık kendi bileşeninden geçmediğini raporla gösterir. Kapı yasak sınıfları (antd, pro, icons, echarts, wide) yakalar; yasak olmayan ama gereksiz modül (ör. ui barrel'ı üzerinden Chart) ağ isteği testiyle aranır.
- Bütçe kapısı son entegrasyon ölçümünde ratchet ve `--strict` modunda PASS'tir (phone-js 114.662 B / 120.000 B; ratchet tavanı yok). Tavan eklemek ya da bütçe yükseltmek kilidi değiştirir ve entegrasyon sahibinin açık kararıdır. İlk rota kapanışını `src/admin/phoneEntry.test.ts` kural testleri de korur (`docs/ADMIN-BUDGETS.md`).
- Üretim ağ yalıtımı (9. kapı) taze bir sentetik `dist` ister: önce 4. adım, sonra `AILE_PORT=<P> pnpm exec playwright test --config playwright.admin-production.config.ts --project chromium --project webkit e2e/admin-production.spec.ts`. Spec `playwright.admin.config.ts` altında kendini atlar; orada geçmiş görünmesi kanıt değildir. Her senaryo aktarılan ve çözülmüş baytları ayrı yazan `ag-*.json` eki bırakır.
- Entegrasyonda E2E sırası: önce telefon projeleri (`--project chromium --project webkit`), sonra `@matrix` projeleri (`--project chromium-360 --project chromium-375 --project chromium-short --project chromium-landscape --project webkit-tablet --project webkit-desktop`), sonra geniş proje (`--project chromium-desktop`). Tam liste tek seferde `pnpm e2e:admin` ile de koşar.
- Port: `AILE_PORT` çift sayıdır; dev kapısı P, üretim kapısı P+1 kullanır. Verilmezse 5174 ve 5178. Çıktılar `test-results/admin-<P>`, `playwright-report/admin-<P>` ve `test-results/admin-production-<P+1>` klasörlerine yazılır.
- Koşu bitince `lsof -nP -iTCP:<P> -sTCP:LISTEN` ve P+1 için aynı komut boş dönmelidir; açık sunucu bırakılmaz.
- Firefox hiçbir kapıda çalıştırılmaz. CI ve Pages iş akışları (`.github/workflows/ci.yml`, `.github/workflows/deploy.yml`) yönetim kapılarını koşmaz; bu kapılar yereldir. CI'ya ekleme önerisi `docs/ADMIN-DEPLOY-PROPOSAL.md` §4.5–4.6 içindedir; workflow değişikliği Codex'e, CI'nin teknik kurulumu Hüseyin Cengiz'e aittir. Eklenirse bu bölüm, 7.2 ve `AGENTS.md` kapı satırı güncellenir.

## 6. Kanıt biçimi

Her kapı ve kontrol tek satırda dört durumdan biriyle yazılır: pass, fail, not_run, not_applicable. Çalışmayan kontrol geçmiş sayılmaz; neden yazılır.

```text
Kapı: <ad> | Durum: pass | Komut: <tam komut> | Ortam: <OS>, Node <sürüm>, <tarayıcı motoru ve sürümü>, <viewport>, <giriş: dokunma/fare/klavye> | Taban: <commit> | Kanıt: <dosya ya da satır>
```

- RED ve GREEN: önce başarısız testin adı ve başarısızlık nedeni (hata satırı alıntısıyla), sonra aynı testin geçtiği koşu. Snapshot körlemesine yenilenmez, eşik gevşetilmez, test atlanmaz.
- Teslim kanıtı `dist/delivery-report.json` alanlarından gelir: `mode`, `status`, `violations[].id`, `phone.static.gzip` ve `phone.static.raw` (bayt), `baseline.added` ve `baseline.resolved`. Ölçüm ham bayt + zlib gzip seviye 9'dur; KiB = 1024 B. Vite'nin build sırasında yazdığı "kB" değeri farklı birim ve sıkıştırıcıdır, karşılaştırılmaz.
- Ekran görüntüsü, trace ve video `test-results/admin-<P>` altındadır. Ekran görüntüsü test çıktısıdır, kendiliğinden onaylanmış piksel referansı değildir.
- Emülasyon gerçek cihaz değildir. Gerçek iPhone Safari, Android Chrome ve macOS Safari kontrolleri ayrı satırlardır; insan yapmadıysa `not_run`. Otomatik axe taraması tüm WCAG 2.2 AA uygunluğunu kanıtlamaz; ekran okuyucu denemesi yapılmadıysa `not_run`.
- Koşu kanıtları Git dışında, koşu klasörünün `evidence/` alt klasöründe tutulur. Gerçek veri içeren hiçbir çıktı kanıta girmez.
- Paralel görev raporu şu alanları taşır: `status` (ok, partial, blocked), `commits`, `files`, `red`, `green`, `commands` (komut → sonuç), `not_run`, `expected_red` (test, sahip, neden), `requests` (dosya, sahip, değişiklik, gerekçe), `notes`. "ok" yalnız kabul ölçütlerinin hepsi kanıtla sağlandığında yazılır.

## 7. Codex devri

Ön koşullar: entegrasyon dalının (`claude/admin-integration`) aday commit'i; 5. bölümdeki kapıların hepsi pass (teslim kapısı `--strict`); bağımsız inceleme bulguları kapalı; kullanıcının yayın onayı. Adımlar bu sırayla yapılır; bir adım geçmezse sonrakine geçilmez.

### 7.1 Apps Script APP_KEY doğrulaması (önce)

Apps Script `checkKey` işlevi Script Properties'te `APP_KEY` yoksa her isteği kabul eder (`gas/src/main.ts`); bu durumda adresi bilen herkes kayıtları okuyup yazabilir. Yönetim paneli Pages'te herkese açık olacağı için birleştirmeden önce anahtarın uçta zorunlu olduğu kanıtlanır.

1. Apps Script düzenleyicisinde Proje Ayarları → Komut dosyası özellikleri altında `APP_KEY` adının bulunduğunu görün. Değer okunmaz, kopyalanmaz, hiçbir yere yazılmaz.
2. Anahtarsız okuma ve anahtarsız toplu yazma isteğinin reddedildiğini doğrulayın. Komut yanıt gövdesini yazdırmaz, yalnız hüküm verir (anahtar zorunlu değilse okuma yanıtı gerçek kayıtları taşır). Boş `ops` listesi anahtar zorunlu olmasa bile hiçbir satır yazmaz.

   ```bash
   API_URL="$(gh variable get VITE_API_URL)"
   for body in '{"action":"read"}' '{"action":"batch","ops":[]}'; do
     curl -sL -X POST -H 'Content-Type: text/plain;charset=utf-8' --data "$body" "$API_URL" \
       | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let r=null;try{r=JSON.parse(s)}catch{}console.log(r&&r.ok===false&&r.error==="unauthorized"?"GEÇTİ: anahtarsız istek reddedildi":"DUR: anahtarsız istek reddedilmedi")})'
   done
   ```

   İki satır da "GEÇTİ" olmalıdır. Uygulamada Ayarlar'dan farklı bir Apps Script adresi kullanılıyorsa o adres de aynı biçimde denetlenir.
3. "DUR" çıkarsa devir durur. `APP_KEY` kullanıcının onayıyla Script Properties'e eklenir (değer Git'e, belgeye veya sohbete yazılmaz), sonra 2. adım yeniden koşar.

### 7.2 Adayı temiz kopyada yeniden doğrulama

Doğrulama, kullanıcının çalışma kopyasını ve açık sunucularını bozmamak için ayrı, geçici bir worktree'de yapılır. Geçici worktree'de `.env.local` yoktur; kapılar böylece yalnız sentetik veriyle koşar.

```bash
git fetch origin
git rev-parse claude/admin-integration   # çıktı <aday commit> ile aynı olmalı
git worktree add --detach <geçici klasör> <aday commit>
cd <geçici klasör>
pnpm install --frozen-lockfile
```

Ardından 5. bölümdeki kapıların hepsi koşar (teslim kapısı `--strict`). CI ve Pages iş akışı yönetim kapılarını koşmadığı için bu adım atlanmaz. Bitince geçici worktree `git worktree remove <geçici klasör>` ile kaldırılır. Bu teslim `gas/`, `apps-script/` ve `apps-script-finance/` kodunu değiştirmemelidir: `git diff --stat origin/main...<aday commit> -- gas apps-script apps-script-finance` boş dönmelidir. Boş değilse Apps Script dağıtımı ayrı karar ve ayrı onaydır.

### 7.3 Birleştirme

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff <aday commit>
```

Birleştirilen commit, 7.2'de doğrulanan aday commit'tir; dalın sonradan ilerlemiş ucu doğrulanmadan birleştirilmez. Geçmiş yeniden yazılmaz: rebase, squash veya yazar değiştirme yok; başka kişinin commit'i yeniden etiketlenmez. Git hook'ları atlanmaz (`--no-verify` yok); yazar ve committer kişisel author guard kuralına uyar.

### 7.4 Push ve Pages

```bash
git push origin main
```

Push `.github/workflows/deploy.yml` iş akışını başlatır: tür denetimi, birim testleri, finans testleri, pano ve önceki uygulama E2E kapıları, repo değişkenleriyle build ve Pages yayını. Force push yoktur. İş akışı `gh run watch` ile izlenir; düşerse yayın olmaz ve neden raporlanır.

Pages build'i repo değişkenleriyle (`VITE_BUDGET_SHEET_ID`, `VITE_API_URL`) derlenir; gizlilik kapısının girdisi sentetik aday build'idir, bu iki çıktı aynı değildir.

### 7.5 Yayın sonrası doğrulama

- `https://karacaismail.github.io/aile/admin.html#/genel` Chromium ve WebKit'te 320 ve 1440 genişlikte açılır; h1 görünür, yatay sayfa kayması yoktur.
- Yayında gerçek nesil yoktur ve `/__aile/generation/*` yalnız dev sunucusunda vardır. Beklenen: panel hiçbir gerçek kayıt göstermez, kaynak yok ya da içe aktarma durumunu adıyla söyler.
- Ana uygulama (`https://karacaismail.github.io/aile/`) eskisi gibi açılır; service worker ön belleği yönetim parçalarını içermez (yerelde 9. kapı bunu sınar).
- Gerçek cihaz kontrolleri (iPhone Safari, Android Chrome, macOS Safari) ayrı raporlanır; yapılmadıysa `not_run`.

### 7.6 Geri alma

Kullanıcı onayıyla `git revert -m 1 <birleştirme commit'i>` ve `git push origin main`; Pages önceki içeriği yeniden yayınlar. Force push ve geçmiş silme yoktur.

## 8. Kullanıcı inceleme rehberi

Önizlemeyi ajan açar ve adresi verir; kullanıcı komut çalıştırmaz. Varsayılan önizleme sentetiktir; gerçek veriyle önizleme yalnız kullanıcı isterse 4. bölümdeki gibi yapılır. Tasarım kaynağı depo dışındaki tasarım teslimidir (`../aile-tasarim/ekran-tasarimi/index.html`); oradaki "yatay telefon tablet kurallarını alır" ifadesi bu projede geçersizdir.

İnceleme sırası telefondan başlar: 320×568 ve 320×480 → 360, 375, 390 → yatay telefon 568×320 (telefon düzeninde kalmalı) → tablet 820×1180 → masaüstü 1440×900.

Her sayfada bakılacaklar:

- Başlık: h1 menüdeki sayfa adıyla aynıdır; altında amaç cümlesi ve tazelik satırı ("Son okuma …", "Yenile") vardır. Breadcrumb ve emoji yoktur.
- Telefonda tablo akordeondur ve ilk satır açıktır; seçim listeleri, menüler ve diyaloglar alttan açılır. Sayfa yatay kaymaz; geniş içerik yalnız kendi alanında kayar.
- Plan ve gerçekleşen hiçbir yerde tek sayıda birleşmez. Gelecek ay "Henüz yok", ödeme kanıtı olmayan kayıt "Kaynakta yazılı" yazar ve yüzde göstermez. Eksik bilgi adıyla yazılır: "Fiyat yok", "Bilinmiyor", "Fotoğraf yok"; eksik fiyat sıfır gibi görünmez.
- Tutarlar `₺8.500,00` biçimindedir ve sütunda hizalıdır.
- Klavye: Tab ile gezinince odaklanan öğenin altında tek mavi çizgi görünür; çevreleyen halka yoktur. Fare veya dokunmayla tıklanınca çizgi kaybolur. Escape açık paneli kapatır ve odak açan düğmeye döner.
- Hareket: açılış ve kapanış aynı hızda ve aynı eğridedir; işletim sisteminde "hareketi azalt" açıkken animasyon olmaz ama içerik anında değişir.
- Metin hiçbir yerde 14 px'ten küçük değildir; dokunma hedefleri parmakla rahat basılır.
- Yükleniyor, boş, hata ve eski veri durumları kendi metniyle görünür; hata durumunda eski tutar gösterilmez.

Geri bildirim şu bilgilerle verilir: sayfa adresi (`#/alimlar` gibi), genişlik × yükseklik, tarayıcı, giriş biçimi (dokunma, fare, klavye), ne görüldü, ne bekleniyordu ve ekran görüntüsü. Ekran görüntüsü gerçek veri içeriyorsa paylaşılmadan önce sorun sentetik önizlemede yeniden gösterilir.

Görsel referans değişiklikleri sessizce veya toplu onaylanmaz: her değişiklik önce/sonra/fark görüntüsü ve gerekçesiyle kullanıcıya sunulur; değişikliği yapan kendi değişikliğinin tek onaylayıcısı olmaz. Yayın, gerçek e-tabloya yazma ve lisans gibi kararlar kullanıcıya aittir.

## 9. Yerel veri ve gizlilik

Panel tarayıcıda yalnız aşağıdakileri saklar. Hepsi yalnız o tarayıcıdadır; e-tabloya ve nesil klasörüne yazılmaz.

| Veri | Yer | Ne zaman |
|---|---|---|
| Nesil parça önbelleği | IndexedDB `aile-admin` / `partitions`, anahtar `<generation_id>/<yol>` | Kalıcı saklama açıksa (aşağıda). Yeni nesil yayınlanınca diğer nesillerin parçaları budanır. |
| Canlı bütçenin son iyi okuması | idb-keyval varsayılan deposu, `aile:admin:live-budget:v1` | Kalıcı saklama açıksa; kapalıysa yalnız sekme belleğinde. |
| Yerel değişiklik kümesi (durum ve not değişiklikleri) | idb-keyval varsayılan deposu, `aile:admin:changeset:v1` | Her derlemede; kullanıcının henüz e-tabloya gönderilmemiş girdisidir. |
| Apps Script adresi ve uygulama anahtarı | localStorage `aile:apiUrl`, `aile:appKey` | Kullanıcı Ayarlar'dan kaydedince. Ana uygulamayla ortaktır: panelde değiştirmek ana uygulamanın kayıt yazdığı adresi ve anahtarı da değiştirir. |

Kalıcı saklama `VITE_AILE_PARTITION_CACHE` ile seçilir (`src/admin/data/store.ts` `persistentCacheAllowed`). Boş değer geliştirmede açık, üretim derlemesinde kapalıdır (fail-closed). Üretimde yalnız `idb` ya da `on` açar; `off`, `memory` ve tanınmayan değerler kapalıdır. Pages kökeni başka projelerle paylaşıldığı için yayında kalıcı önbellek ancak kullanıcının açık kararıyla açılır (`docs/ADMIN-DEPLOY-PROPOSAL.md` Ö6).

Ortak cihaz: Ayarlar › "Cihazdaki panel verisi" › "Bu cihazdaki tüm panel verisini sil" onay ister ve bekleyen değişiklik sayısını gösterir. Onaylanınca nesil önbelleğini, `aile:admin:` önekli bütün anahtarları (değişiklik kümesi, canlı bütçe son okuması) ve sekme belleğindeki canlı bütçe kopyasını siler. Ardından sayfa yeniden yüklenir; böylece bellekteki kopyalar ve seçilen klasör de gider. Adres ve anahtar ayrı bir seçenektir ve varsayılan olarak korunur. Ana uygulamanın aynı depodaki verisine (`aile:data:v1`, `aile:outbox:v1`) dokunulmaz. Başka sekmede açık bir panel varsa önce o kapatılır. Açık kalırsa o sekmede yapılan yeni bir değişiklik, bellekteki değişiklik kümesini yeniden yazar. "Önbelleği temizle" yalnız parça önbelleğini siler.

Canlı bütçe okuması (`src/admin/data/live.ts`) yalnız okur. Deneme başına zaman aşımı 10 sn'dir. Yalnız ağ hatası, zaman aşımı ve HTTP 408/425/429/5xx yeniden denenir: toplam en çok 3 deneme, üstel ve eşit jitter'lı bekleme (400 ms, sonra 800 ms; bekleme en çok 3 sn). Hata sınıfları karışmaz: ağ "Sheets'e ulaşılamadı", boş kaynak "Veri yok", bütünlük "Biçim değişti", ayrıca yapılandırma ve iptal. Eşzamanlı çağrılar tek okumayı paylaşır. Hata sonucu son iyi okumayı okuma zamanıyla "eski" olarak taşır, taze göstermez.

Emeklilik profili bu tabloda yoktur, çünkü hiçbir yerde saklanmaz: yalnız sekmenin belleğinde durur (`src/admin/emeklilik/data` profil deposu). Geliştirmede ara katmandan okunur. Üretimde (GitHub Pages) varsayılan kaynak yoktur ve hiçbir ağ isteği yapılmaz; kullanıcı profil dosyasını Emeklilik planı sayfasından içe aktarır. Dosya en çok 256 KB olabilir, JSON olarak ayrıştırılır ve sözleşme şemasıyla (Zod, `surum: 1`) doğrulanır; bilinmeyen alanlar yok sayılır, geçersiz dosya alan yoluyla ve değer yazılmadan reddedilir. Sekme kapanınca ya da profil temizlenince profil gider; tarayıcı depolaması ya da önbellek kullanılmaz (kaynak kapısı `src/admin/emeklilik/data/profilKaynagi.test.ts`).

Geliştirme ara katmanı (`/__aile/generation/*`) yalnız `manifest.json`, `data/<koleksiyon>/…/<parça>.json` ve `_meta` yollarını servis eder; `raw/`, `schemas/` ve `contracts/` servis edilmez. Emeklilik yolu (`/__aile/emeklilik/*`) yalnız `profil.json`'u ve yalnız `AILE_EMEKLILIK_PROFILE` değişkeninin gösterdiği tek `.json` dosyasından verir; dosya yoksa ya da `.json` değilse 404, JSON değilse içerik yazılmadan 422 döner. İki yol da yalnız aynı kökene yanıt verir. `Origin` başlığı sunucunun kendi kökeni değilse ya da `Sec-Fetch-Site` değeri `same-origin` veya `none` değilse 403 döner. Vite'nin varsayılan CORS ayarı başka localhost portlarına izin verse de nesil o kökenlere okunmaz. `curl` gibi başlıksız istekler okunur.

Nesil bütünlüğü (`src/admin/data/store.ts`, `data-platform/validate.mjs` ile aynı kurallar):

- Her parça manifestteki sha256 ile doğrulanır. Önbellekten okunan parça da yeniden doğrulanır.
- Parçadaki kayıt sayısı manifestteki `count` ile eşleşmelidir.
- Parçası olan her koleksiyonun `counts` değeri, parçalarındaki kayıt sayılarının toplamına eşit olmalıdır. Uyuşmazlık `ContractError` verir ve nesil yayınlanmaz.
- Parçası olmayan koleksiyonun sayımı serbesttir (panelin okumadığı kayıtlar ya da boş koleksiyon).
- `generation_id` yalnız biçimiyle (64 hex) denetlenir; tarayıcıda içerik özeti olarak yeniden hesaplanmaz. Bu kimlik imzasız bir öz-özettir: manifesti değiştiren biri onu da yeniden hesaplar, yani kurcalamaya karşı ek koruma vermez. Yarım ya da elle bozulmuş bir neslin yaratacağı tutarsızlıkları parça hash'leri ve kayıt sayıları zaten yakalar. Kimliğin içerikle eşleştiği üretici tarafında `data-platform/cli.mjs validate` ile doğrulanır. Ayrıca `generation_id` panelde yalnız önbellek anahtarı ve nesil sabitleme kimliğidir; önbellekten okunan her parça yine sha256 ile doğrulandığından aynı kimliği taşıyan farklı bir manifest yanlış veri yayınlatamaz.
