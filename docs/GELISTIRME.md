# Geliştirme rehberi (modül yazarları için)

Bu depo bir aile taşınma planlayıcısıdır: Vite 8 + React 19 + TypeScript + **Mantine 9.7** + Phosphor ikonları.
Veri Google Sheets'te, Apps Script üzerinden; uygulama statik (GitHub Pages). Kod ve testlerde **aileye özgü hiçbir bilgi**
(isim, doğum günü, gebelik, gerçek fiyat, adres) bulunmaz; bunlar yalnız `seed/private/` (gitignore) ve Sheets'te yaşar.

## Komutlar
- `pnpm typecheck` · `pnpm vitest run <klasör>` · `pnpm e2e` (Playwright; aynı anda tek örnek — başkası koşuyorsa bekleyin)
- Bağımlılık eklemeyin (`pnpm add` yok). Her şey mevcut paketlerle yapılır.

## Mimari (dokunulmayacak dosyalar)
`shared/schema.ts` (sütunlar/enumlar/etiketler, tek kaynak), `src/sync/*` (senkron), `src/theme.ts`, `src/routes.tsx`, `src/app/shell/*`,
`src/modules/purchase/*`. Şema değişikliği gerekiyorsa kod yazmayın, raporlayın.

## Veri modeli
Her kayıt `Item` (`@shared/schema`): `tip` alanı modülü belirler: `satinalma | aydinlatma | tadilat | yerlesim | usta | kontrol | sahne | kilometre`.
Alanlar ve enumlar `ITEM_COLUMNS` içinde; etiket için `label('durum', 'karar')` → "Karar". `Setting` (`tip: oda|tarih|liste|ayar|kolon`, `anahtar`, `deger`).
- Oda ayarı: `tip='oda', anahtar='salon', deger=JSON.stringify({ en_cm, boy_cm, yuk_cm, kopek_erisim })` (deger boş olabilir).
- Tarihler: `tip='tarih', anahtar='tasinma'|'anahtar'|'ev_secim_son'|…, deger='YYYY-MM-DD'`. **Kodda tarih sabitlemeyin**; yoksa "ayarlanmadı" gösterin.
  Kamusal takvim sabitleri `@/lib/dates`: `RAMAZAN_2027`, `BAYRAM_2027`, `KADIR_GECESI_2027`.
- Ayarlar: `tip='ayar', anahtar='senaryo' (A|B|C) | 'omurga' | 'duvar_rengi'`.

## Durum ve yazma (src/sync)
```ts
import { useAppStore, selectByTip, selectSetting } from '@/sync/store';
import { upsert, remove, restore } from '@/sync/controller';
const layers = useAppStore(selectByTip('aydinlatma'));            // silinmişler hariç
const moveDate = useAppStore(selectSetting('tarih', 'tasinma'));   // Setting | undefined
const id = upsert('kalemler', existingId /* veya undefined */, { tip: 'aydinlatma', ad: 'x', oda: 'salon' }); // optimistic + kuyruk
upsert('ayarlar', settingId, { tip: 'ayar', anahtar: 'senaryo', deger: 'B' });
remove('kalemler', id);
```
- `upsert` patch'inde boş/`null` değer alanı temizler. `tip` ve `ad` (ayarlar için `tip`+`anahtar`) yeni kayıtta zorunlu.
- Seçici yeni nesne döndürebilir (sığ eşitlik önbelleği var); pahalı hesapları `useMemo` ile yapın.
- Testte: `vi.mock('@/sync/controller', () => ({ upsert: vi.fn(), remove: vi.fn(), restore: vi.fn() }))` ve `applyRead/setState/resetStore` (`@/sync/store`).

## Yönlendirme (wouter, hash)
Modül `<Route path="/aydinlatma" nest>` içinde render edilir. İç rotalar göreli: `<Route path="/:oda">`. Mutlak gezinme için `~/` öneki:
`navigate('~/aydinlatma/salon')`, `<Link href="~/ayarlar">`. Detaylar `Modal fullScreen={isMobile}` (`useMediaQuery('(max-width: 48em)', true)`), `closeButtonProps={{ size: 'xl', 'aria-label': 'Kapat' }}`, formu `<form data-testid="...">` ile sarın (testid'yi Modal'a değil içeriğe verin). Detay bileşenini `key={id}` ile kurun; form `useForm({ mode: 'controlled', validate: schemaResolver(zodSchema, { sync: true }) })`.

## Hazır bileşenler
- `@/components/badges`: `DurumBadge`, `FazBadge`, `OdaBadge`, `KategoriBadge`, `WarnBadge tone="info|warn|danger|ok"` — **renkli metinli `variant="light"` rozet KULLANMAYIN** (kontrast); nötr `variant="default"` ya da bu bileşenler.
- `@/components/PriceInput` (TL, `value: number|null`), `@/components/EnumSelect` (`field`, `options`, `value`, `onChange`), `@/components/LinksField`, `@/app/shell/Fab` (`onClick`, `label`).
- `@/lib/price`: `formatTl`, `formatTlRange`; `@/lib/dates`: `daysUntil`, `formatTr`, `inRange`, `addDays`, `todayIso`; `@/lib/cct`: `cctGradient(min,max)`, `cctToCss`, `cctLabel`.
- Mantine 9: `EmptyState` (+ `EmptyState.Actions`), `Timeline`, `Stepper`, `RingProgress`, `Progress`, `RangeSlider`, `SegmentedControl`, `Chip.Group`, `Drawer position="bottom"`, `CopyButton`, `Accordion`, `Checkbox.Card`, `NativeSelect` (mobilde tercih), `DatePickerInput` (`@mantine/dates`, değer `'YYYY-MM-DD'` string, `dropdownType="modal"`), `NumberInput` → her zaman `hideControls` + `inputMode`.
- İkonlar: `@phosphor-icons/react`, adlar `*Icon` sonekli (`SunIcon`, `MoonIcon`, `LampIcon`, `HammerIcon`, `CalendarBlankIcon`, `ClipboardTextIcon`, `WhatsappLogoIcon`, `PhoneIcon`, `WallIcon`, `RulerIcon`, `PlugIcon`). Emoji **yasak**.

## 320×480 kuralları (ölçülür)
Yatay taşma yok; her etkileşimli öğe ≥44×44 (ActionIcon varsayılanı xl, Button/Input minHeight 44; tıklanabilir kart alanlarına `min-height: 44px`);
`Tooltip` yok (hover yok); uzun metin `lineClamp` + `data-allow-clamp`; satır içi metin bağlantısına `data-inline-link`; liste altına `pb={96}` (FAB);
iç içe dolgu birikmez (sayfa `p="sm"`, kart `p="sm"`); yapışkan başlık şeridi için `Paper` + `position: sticky; top: 0`.

## Testler
- Birim: `@/test-utils/render` (`render`, `screen`, `userEvent`, `within`); wouter için
  `import { memoryLocation } from 'wouter/memory-location'; const { hook } = memoryLocation({ path: '/aydinlatma', static: false }); render(<Router hook={hook}>…</Router>)`.
  Saf kurallar ayrı dosyada (`rules.ts`) ve ayrı test edilir. Sentetik veri: uydurma adlar, fiyatlar, tarihler (2099 gibi).
- e2e: `e2e/<modul>.spec.ts`; `mockApi(page, fixture)` (`e2e/helpers.ts`; `fixture` = `e2e/fixtures/synthetic.json` biçiminde kendi `e2e/fixtures/<modul>.json`), `horizontalOverflow(page)` ve `smallTargets(page)` ikisi de `[]` olmalı. `page.getByLabel(...).check()` switch için.
