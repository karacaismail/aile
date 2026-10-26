# aile

Taşınma planlayıcısı: satınalma listesi, aydınlatma planı, badana/boya/tadilat planı ve oda bazlı eşya yerleşimi.
Statik uygulama (GitHub Pages); veri Google Sheets'te, Apps Script web uygulaması üzerinden çift yönlü senkron.

## Çalıştırma

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5174/aile/
pnpm test       # Vitest
pnpm e2e        # Playwright (320×480, 320×568, iPhone 12 WebKit)
pnpm build
```

## Kurulum (Google Sheets bağlantısı)

Bkz. `apps-script/README.md`.
