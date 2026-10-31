# aile

[Canlı bütçe](https://karacaismail.github.io/aile/#/pano) · [Timeline](https://karacaismail.github.io/aile/#/timeline) · [Araç ve finansman simülasyonu](https://karacaismail.github.io/aile/#/arac)

Timeline, e-tablodan gelen kronolojik adımların her birinden sonra kalan nakdi ve kart borcunu gösterir. [Veri ve doğrulama sözleşmesi](docs/TIMELINE.md).

Google Sheets’ten okunan bütçe, ECharts grafikleri, tablolar ve iki kredinin toplam yükünü hesaplayan araç simülasyonu. Yeni ekranlar için [veri, finansman ve doğrulama sözleşmesi](docs/BUDGET-VEHICLE.md). Eski taşınma planlayıcısı mevcut rotalarında korunur.

Taşınma planlayıcısı: satınalma listesi, aydınlatma planı, badana/boya/tadilat planı ve oda bazlı eşya yerleşimi.
Statik uygulama (GitHub Pages); veri Google Sheets'te, Apps Script web uygulaması üzerinden çift yönlü senkron.

## Çalıştırma

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5174/aile/
pnpm test       # Vitest
pnpm e2e        # Playwright (320×480, 320×568, iPhone 12 WebKit)
pnpm e2e:dashboard # Chromium ve WebKit; yeni bütçe/araç ekranları (Firefox yalnız açık talimatla)
pnpm build
```

## Yeni bütçe bağlantısı

`.env.local` içinde `VITE_BUDGET_SHEET_ID` tanımlayın. Yayın için aynı isimli GitHub repository variable kullanılır. Gerçek gelirler, kişisel senaryolar ve dosya yedekleri repoya eklenmez.

## Eski planlayıcı kurulumu (Apps Script)

Tek elle adım: Google hesabınızla `pnpm exec clasp login` (bir kez). Sonrası komutla: `scripts/gas-setup.sh create` → editörde `setup`'a bir kez izin → `scripts/gas-setup.sh deploy` → adresi `VITE_API_URL` olarak ekleyin → `node scripts/seed.ts --csv "<CSV>" --url "<exec>"`.
Ayrıntı: `apps-script/README.md`. Geliştirme kuralları: `docs/GELISTIRME.md`.

## Yapı

- `shared/` şema, dönüştürme, CSV normalizasyonu (uygulama + Apps Script + tohumlama ortak)
- `gas/src/` Apps Script kaynağı → `pnpm gas:build` → `apps-script/Code.js`
- `src/modules/` purchase (Satınalma), lighting (Aydınlatma), renovation (Tadilat), layout (Yerleşim), settings
- `src/sync/` önbellek, çevrimdışı kuyruk, çakışma, Apps Script istemcisi
- `seed/private/` aile verisi (gitignore); `seed/templates/` jenerik şablonlar
