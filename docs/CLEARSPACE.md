# Clearspace

Boşluk ölçeği 4 px tabanlıdır: 4, 8, 12, 16, 24, 32, 40, 48. Ham değerler yalnız `src/dashboard/tokens.ts` içinde durur.

| Rol tokenı | Değer | Nerede | Tür |
|---|---|---|---|
| `clearText` | 4 | Etiket ile değer, başlık ile alt satır | gap |
| `clearControl` | 8 | Yan yana kontroller, başlık ile gövde | gap |
| `clearField` | 12 | Form alanları arası, iç içe yüzeyin iç boşluğu | gap, padding |
| `clearInset` | 16 | Dolu her yüzeyin iç boşluğu (kart, panel, şerit) | padding |
| `clearCards` | 16 | Kardeş yüzeyler arası | gap, margin |
| `clearSection` | 24 | Sayfa bölümleri arası, başlık ile içerik | margin |
| `clearPage`, `clearPageWide` | 16, 32 | Sayfa kenarı (dar, geniş) | padding |
| `clearPageEnd` | 32 | Sayfa sonu | padding |

## Kurallar

- Roller içeriden dışarıya büyür. Bir yüzeyin iç boşluğu, onu kardeşinden ayıran boşluktan büyük olamaz.
- Dolu yüzeyde içerik kenara 8 px'ten fazla yaklaşmaz.
- Dolgusuz grup padding almaz, yalnız gap kullanır.
- Margin yalnız bölüm düzeyinde kullanılır.
- Köşe en çok 5 px olur: `radius` 5 px, `radiusSmall` 3 px. Mantine `xs`, `sm`, `md`, `lg`, `xl` ve tam yuvarlak bileşenleri de bu tokenlara bağlıdır. Seçim dairesi (radio) şekliyle onay kutusundan ayrıldığı için dışarıda kalır.
- Gövde yazısı 16 px'tir. `fontCaption` 14 px yalnız yardımcı metin, durum satırı ve üst bilgi içindir.

## Kapılar

- `src/clearspace.test.ts`: tokenları, ham değerleri, köşe ve yazı sınırını, kısa ekran metnini denetler.
- `e2e/clearspace-dashboard.spec.ts`: 14 rotada gerçek yerleşimde köşe, yazı ve iç boşluğu denetler.
