# Geliştirme rehberi (önceki taşınma modülleri)

Yeni bütçe ve araç ekranları için kökteki `AGENTS.md` ve `docs/BUDGET-VEHICLE.md` geçerlidir. Kullanıcının açık talebiyle ECharts 6 eklendi; yeni uygulama kabuğu ve önceki kabuğa geçiş ayrıldı. Aşağıdaki kısıtlar önceki modüllerin geliştiricilerine yöneliktir.

Bu depo bir aile taşınma planlayıcısıdır: Vite 8 + React 19 + TypeScript + **Mantine 9.7** + Phosphor ikonları.
Veri Google Sheets'te, Apps Script üzerinden; uygulama statik (GitHub Pages). Kod ve testlerde **aileye özgü hiçbir bilgi**
(isim, doğum günü, gebelik, gerçek fiyat, adres) bulunmaz; bunlar yalnız `seed/private/` (gitignore) ve Sheets'te yaşar.

## Komutlar
- `pnpm typecheck` · `pnpm vitest run <klasör>` · `pnpm e2e` (Playwright; aynı anda tek örnek — başkası koşuyorsa bekleyin)
- Bağımlılık eklemeyin (`pnpm add` yok). Her şey mevcut paketlerle yapılır.

## Mimari (eski modül geliştiricileri için dokunulmayacak dosyalar; aile kabuğu/UX turları bu listeye bağlı değildir)
`shared/schema.ts` (sütunlar/enumlar/etiketler, tek kaynak), `src/sync/*` (senkron), `src/theme.ts`, `src/routes.tsx`, `src/app/shell/*` (yalnız `Fab` ve `SyncStatus`; eski üst çubuk/alt sekme/yan menü kabuğu kaldırıldı, tek gezinme `src/app/family`),
`src/modules/purchase/*`. Şema değişikliği gerekiyorsa kod yazmayın, raporlayın.

## Veri modeli
Her kayıt `Item` (`@shared/schema`): `tip` alanı modülü belirler: `satinalma | aydinlatma | tadilat | yerlesim | usta | kontrol | sahne | kilometre`.
Alanlar ve enumlar `ITEM_COLUMNS` içinde; etiket için `label('durum', 'karar')` → "Karar". `Setting` (`tip: oda|tarih|liste|ayar|kolon`, `anahtar`, `deger`).
- Oda ayarı: `tip='oda', anahtar='salon', deger=JSON.stringify({ en_cm, boy_cm, yuk_cm, kopek_erisim })` (deger boş olabilir).
- Tarihler: `tip='tarih', anahtar='tasinma'|'anahtar'|'ev_secim_son'|…, deger='YYYY-MM-DD'`. **Kodda tarih sabitlemeyin**; yoksa "ayarlanmadı" gösterin.
  Kamusal takvim sabitleri `@/lib/dates`: `RAMAZAN_2027`, `BAYRAM_2027`, `KADIR_GECESI_2027`.
- Ayarlar: `tip='ayar', anahtar='senaryo' (A|B|C) | 'omurga' | 'duvar_rengi'`.

## Bütçe (harcama günlüğü)
- Üçüncü uygulama sekmesi `app_nakit` (`CASH_COLUMNS`): bir satır = bir ödeme (`tarih`, `tutar`, `kalem`, `not`). `kalem` bütçe sekmesindeki satır adıdır.
- Plan salt okunur: Apps Script okuma yanıtına `plan` ekler (`Giderler Planlanan` grupları + 12 aylık tutar, `parsePlan`). Kalem adları koda yazılmaz, tablodan gelir.
- Yazma: `upsert('nakit', id, { tarih, tutar, kalem, not })`; okuma `useAppStore((s) => s.cash)`, `s.plan`, `s.cashSupported` (sunucuda sekme yoksa `false`).
- Hızlı form her ekrandan: `openExpense({ kalem?, id? })` (`@/modules/budget`); üst çubukta "Harcama ekle", PWA kısayolu `#/butce/yeni`.
- `doGet?action=wire` `Giderler Gerçekleşen` C:N hücrelerini günlüğe bağlar (`actualFormula`: kayıt yoksa plan; kayıt varsa kapanan ayda gerçek, açık ayda max(gerçek, plan)); `action=unwire` eski plan kopyasına döndürür.

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
- Mantine 9: `EmptyState` (+ `EmptyState.Actions`), `Timeline`, `Stepper`, `RingProgress`, `Progress`, `RangeSlider`, `SegmentedControl`, `Chip.Group`, `Drawer position="bottom"`, `CopyButton`, `Accordion`, `Checkbox.Card`, `Select` (custom açılır menü; native kullanılmaz), `DatePickerInput` (`@mantine/dates`, değer `'YYYY-MM-DD'` string, `dropdownType="modal"`), `NumberInput` → her zaman `hideControls` + `inputMode`.
- İkonlar: `@phosphor-icons/react`, adlar `*Icon` sonekli (`SunIcon`, `MoonIcon`, `LampIcon`, `HammerIcon`, `CalendarBlankIcon`, `ClipboardTextIcon`, `WhatsappLogoIcon`, `PhoneIcon`, `WallIcon`, `RulerIcon`, `PlugIcon`). Emoji **yasak**.

## Filtre dili (tek ilke: her yerde aynı çip)
`@/components/filter`: `FilterChip` (etiket + sayım, seçili = dolu birincil + onay ikonu, `icon="x"` = kaldırılabilir aktif filtre, `dot` = durum noktası),
`FacetChips` (`optionCounts` haritasından çipler; sıfır sayımlılar gizli, seçili ama sayımsız değer "0" ile kalır; `''` = "Belirsiz"),
`FilterRail` (320'de yatay kayan tek satır, ≥48em sarar), `FilterSheet` (320'de alttan tam yükseklik, ≥48em sağdan panel; gövde kayar, alt çubuk
"Temizle (n)" / "N kalemi göster" sabittir; filtreler anında uygulanır, "Uygula" yoktur), `FilterSection`, `SortControl` (sıralama filtre değildir:
320'de alttan radyo kartları, ≥48em etiketli düğme + açılır kutu). Sayımlar her zaman "bu seçenek açılırsa kaç kalem" anlamındadır
(`countWith`, `optionCounts`, `quickCounts` — `@/data/selectors`). Çip görünümü `src/styles.css` genel kurallarından gelir (açık/koyu AA);
`variant="light"` çip KULLANMAYIN. Satınalma örneği: `src/modules/purchase/PurchaseFilterSections.tsx` + `PurchaseList.tsx`.
Görünmez native input'lu çipler Playwright'ta sarmalayıcıya tıklanır: `page.getByTestId('quick-chip-fiyatsiz').click()`.

## 320×480 kuralları (ölçülür)
Yatay taşma yok; her etkileşimli öğe ≥44×44 (ActionIcon varsayılanı xl, Button/Input minHeight 44; tıklanabilir kart alanlarına `min-height: 44px`);
`Tooltip` yok (hover yok); uzun metin `lineClamp` + `data-allow-clamp`; satır içi metin bağlantısına `data-inline-link`; liste altına `pb={96}` (FAB);
iç içe dolgu birikmez (sayfa `p="sm"`, kart `p="sm"`); yapışkan başlık şeridi için `Paper` + `position: sticky; top: 0`.

## Testler
- Birim: `@/test-utils/render` (`render`, `screen`, `userEvent`, `within`); wouter için
  `import { memoryLocation } from 'wouter/memory-location'; const { hook } = memoryLocation({ path: '/aydinlatma', static: false }); render(<Router hook={hook}>…</Router>)`.
  Saf kurallar ayrı dosyada (`rules.ts`) ve ayrı test edilir. Sentetik veri: uydurma adlar, fiyatlar, tarihler (2099 gibi).
- e2e: `e2e/<modul>.spec.ts`; `mockApi(page, fixture)` (`e2e/helpers.ts`; `fixture` = `e2e/fixtures/synthetic.json` biçiminde kendi `e2e/fixtures/<modul>.json`), `horizontalOverflow(page)` ve `smallTargets(page)` ikisi de `[]` olmalı. `page.getByLabel(...).check()` switch için.
