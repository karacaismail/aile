# Aile pre-MVP: veri modeli ve yönetim paneli geliştirme planı

Tarih: 1 Kasım 2026. Durum: mevcut JSON veri temelinin üzerine kurulacak yönetim paneli planı. Veri exporter kodu ayrı bir teslimdir; bu dosya altı görünümün uygulandığı, canlı UI değiştiği veya PostgreSQL kurulduğu anlamına gelmez.

## 1. Ürün kararı ve bu aşamanın sınırı

Ürün, hanenin bütçesini, ödemelerini, borçlarını, alımlarını, ev projelerini ve sorumluluklarını ortak kayıtlar üzerinden yöneten bir aile yönetim panelidir. İlk hane mevcut aile; ilk hedef, aynı kaydın farklı ekranlarda farklı anlama gelmesini önlemektir. Mağaza/katalog estetiği yerine yönetim çalışma alanı kurulur.

Mevcut React, Mantine, TypeScript ve Vite korunur. Kullanıcının talebi doğrultusunda GitHub Pages iş akışları ve dağıtım davranışı bu aşamada değiştirilmez. Veri sözleşmesi Mantine, Ant Design, shadcn veya Bootstrap bilgisi içermez. Üç hafta sonra arayüz kütüphanesi değiştiğinde yeniden yazılması gereken yer görünüm adaptörüdür; hane, ödeme, oda, kategori, geçiş ve ilişki kimlikleri değişmez.

JSON bir çalışma/veri taşıma biçimidir; tek başına sunucu, yetkilendirme, eşzamanlı yazma veya güvenilir muhasebe sistemi sağlamaz. GitHub Pages statik sunumdur. Bu aşamada gerçek aile JSON dosyaları public repoya veya Pages çıktısına konmaz; özel yerel dışa aktarım olarak tutulur. Gelecek panel aynı sözleşmeyi yetkili veri uç noktasından okuyabilir. Bu ayrım public kaynak kod politikasını korur. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Kaynak verinin sahibi geçiş boyunca Google Sheets'tir. JSON, doğrulanmış ve yeniden üretilebilir bir nesildir. Kullanıcı girdisi, kaynak formülü ve türetilmiş sonuç ayrı korunur. JSON'dan Sheets'e ikinci bir serbest yazma yolu veya iki yönlü otomatik eşitleme bu planın doğal sonucu olarak kurulmaz.

## 2. Mevcut koddan doğrulanan başlangıç ve boşluklar

İncelenen kaynaklar: [`shared/schema.ts`](../shared/schema.ts), [`package.json`](../package.json), [`AGENTS.md`](../AGENTS.md), [`data-platform/README.md`](../data-platform/README.md), [`normalize.mjs`](../data-platform/normalize.mjs), [`core.mjs`](../data-platform/core.mjs), [`finance.mjs`](../data-platform/finance.mjs), [`views.json`](../data-platform/dictionaries/views.json).

- `app_kalemler` satın alma, aydınlatma, tadilat, yerleşim, usta, kontrol, sahne ve kilometre taşını ortak geniş bir satırda tutuyor. Bu yapı kayıpsız ham kaynak olarak korunabilir; yeni domain modeli bu tek satır biçimine bağımlı olmamalı.
- `app_nakit` bir satırı bir ödeme olarak tanımlıyor; `kalem_id` satın almaya bağlanabiliyor. Kaynakta olmayan banka/ödeme aracı/taksit bilgisi içe aktarımda uydurulamaz.
- Mevcut `faz` 1/2/3; `durum` fikir/araştırma/karar/sipariş/teslim/kuruldu/iptal. Bunlar yeni sistemde birbiriyle aynı eksen değildir. Özellikle faz 3'ün “Bebek” anlamı kronolojik “Sonra” ile eşdeğer kabul edilmez.
- Finansman ve Timeline aynı doğrulanmış defteri kullanıyor; yeni tasarım da tek hesap sonucunun farklı sunumlarını üretmeli. Hazırlık listesindeki fiyat aralıklarından ikinci bir gerçekleşen harcama toplamı üretilmez.
- Araç kataloğu ve bazı simülasyonlar mevcut kodda yerel kaynaklara dayanıyor. “Tüm veriler Sheets kaynaklı” kabulü için bu kaynaklar da envantere alınmalı; Sheets'e taşınmadan sanki Sheets'ten geliyormuş gibi etiketlenmemeli.
- Mevcut satırların `id`, `version`, son işlem ve değişiklik alanları var. Bu kimlikler korunmalı; ad, sıra veya satır numarasından her ithalde yeni kimlik üretmek hatalıdır.

Bu inceleme tüm canlı hücrelerin semantik denetimi değildir. Tamlık, ana uygulama işinin ürettiği kaynak envanteri ve ithal raporuyla ayrıca kanıtlanmalıdır. Manifestteki sürümler: React 19.3.1, Mantine 9.7.4, Vite 8.3.5, ECharts 6.0.0, JSON doğrulama için mevcut Zod 4.6.7. PostgreSQL hedef sürümü henüz seçilmedi; aşağıdaki SQL araştırması sürüm 18 belgeleridir, kurulum iddiası değildir.

## 3. Karışan kavramların ayrılması

| Kullanıcının örneği | Doğru model | Neden |
|---|---|---|
| Muhasebe, finans | Modül / yetenek alanı | Tek bir kayıt türü değildir; farklı kayıtları ve raporları kapsar. |
| Harcama, ödeme | Gider yükümlülüğü ve ödeme ayrı kayıtlar | Bir alım peşin, kısmi, taksitli, iade veya birden çok araçla ödenebilir. |
| Satın alınacak, sipariş verildi, teslim edildi | Tedarik iş akışı durumları | Ödeme ve kurulum tamamlandı anlamına gelmez. |
| Karar verildi | Karar kaydı + karar iş akışı durumu | Ürün seçimi, bütçe onayı ve usta seçimi aynı karar değildir. |
| Kontrol edildi | Türü, sonucu ve kanıtı olan kontrol kaydı | “Kontrol edildi” başarılı olduğu anlamına gelmez; geçer/kalır/eksik ayrılır. |
| Ödeme yapıldı | Ödeme olayı; ilişkili yükümlülükte türetilen ödeme durumu | Bir işaret kutusu gerçek para hareketi yerine geçmez. |
| Kredi çekildi, KMH kullanıldı | Finansman kullanımı olayı | Borç artışı ve hesaba yansıma ayrı kayıtlara bağlanır. |
| Kredi kartı kullanıldı | Ödeme aracı + kart yükleme olayı | Banka hesabından nakit çıkışıyla aynı zaman ve aynı şey değildir. |
| Usta aranıyor/bulundu | Hizmet sağlayıcı seçimi iş akışı | İşin yapıldığı veya ücretinin ödendiği anlamına gelmez. |
| Önce/Yerleşme/Sonra | Proje zamanlaması | Somut taşınma projesine/milestone'a göre atanır. |
| Bebek | Yaşam bağlamı | Tarih veya satın alma aşaması değildir; oda ve kategoriyle kesişebilir. |
| Hepsi | Görünüm/filtre komutu | Veritabanına bir durum veya faz olarak yazılmaz. |
| Mutfak, banyo, köpek | Ayrı oda/kategori/yaşam bağlamı olabilen terimler | “Banyo” oda olabilir; banyo bakım ürünü kategori olabilir. Aynı etiket farklı vocabulary kimliği taşır. |

Drupaldaki vocabulary/term yaklaşımı sınıflandırma için uygundur: vocabulary terim kümesidir; hiyerarşik veya düz olabilir; kayıtlar terimlere referans verir. Bu, bütün kayıtları etikete dönüştürmek anlamına gelmez. Oda bir varlıktır; “oda türü” vocabulary'dir. Banka/hesap varlıktır; “finansman türü” vocabulary'dir. [Drupal taxonomy](https://www.drupal.org/docs/user_guide/en/structure-taxonomy.html)

## 4. Veri alanları ve dosya sınırları

Dosyalar ekran başına kopyalanmaz. Her kaynak gerçekliği tek kayıt olarak saklanır; görünümler kimlik referanslarıyla bunu kullanır. Çok küçük alanlar aynı koleksiyonda tutulabilir; her kayıt için ayrı ağ dosyası yaratılmaz.

| Alan / önerilen koleksiyon | İçerik | Temel ilişkiler |
|---|---|---|
| `households`, `memberships`, `parties` | Hane, yetkili kişi, satıcı/usta/banka gibi taraflar | Hane → üyelik; taraf → teklif/sözleşme/hesap |
| `properties`, `spaces`, `space_assignments` | Ev, kat/oda/bölüm, zaman aralıklı yerleşim | Oda → ev; ürün/varlık → oda, miktar, kullanım amacı |
| `projects`, `milestones`, `tasks`, `task_dependencies` | Taşınma, tadilat, işler ve kabul koşulları | Görev → proje/oda/kişi/ürün; bağımlılık yönü |
| `products`, `purchase_needs`, `offers`, `orders`, `order_lines` | Ürün tanımı, ihtiyaç, fiyat teklifi ve sipariş | İhtiyaç → ürün/oda; sipariş → satıcı; satır → teklif |
| `assets`, `receipts`, `warranties` | Halen eldeki eşya, teslimat ve garanti | Varlık → sipariş satırı veya kaynak kaydı; teslimat miktarı |
| `budget_periods`, `budget_lines`, `scenarios` | Dönem, plan, varsayım ve senaryo | Bütçe satırı → kategori/proje; senaryo → ayrı varsayım kümesi |
| `obligations`, `recurrences`, `payments`, `payment_allocations` | Ödenecek borç/gider, tekrar kuralı, gerçek ödeme ve dağıtımı | Ödeme ↔ bir veya daha çok yükümlülük; kısmi ödeme |
| `accounts`, `payment_instruments`, `financing_agreements`, `financing_events` | Kasa/banka, kart, kredi/KMH/kişisel borç sözleşmesi ve kullanım/geri ödeme | Kart → hesap/kurum; olay → sözleşme ve para hareketi |
| `account_movements`, `transfers`, `balance_snapshots` | Gerçek hareket, hesaplar arası aktarım ve kaynak bakiye | Aktarımın iki bacağı; bakiye → tarih/kaynak/ölçüm anlamı |
| `forecasts`, `forecast_events` | Sheets finans motorunun senaryo çıktıları | Nesil → kaynak snapshot; olay → alım/ödeme planı |
| `decisions`, `inspections`, `documents`, `media` | Karar, kontrol, fatura/doküman, fotoğraf | Hedef kayda referans; lisans/kaynak/kanıt |
| `vocabularies`, `terms`, `term_assignments` | Kategori, etiket ve kontrollü sözlükler | Terim → vocabulary/ebeveyn; kayıt → terim |
| `workflow_definitions`, `workflow_instances`, `workflow_events` | Geçiş tanımları ve durum geçmişi | Kayıt → sürümlü workflow; olay → önce/sonra/aktör |
| `saved_views`, `view_definitions` | Sorgu, sıralama, sütun, gruplama tercihi | Tür/alan kimlikleri; component isimleri yok |
| `import_runs`, `source_records`, `issues`, `audit_events` | Kaynak, kalite sorunu, import/audit izi | Dönüştürülen her kaydın ham kaynağı |

Bu liste hedef sözleşmedir. Kaynakta olmayan sipariş, taksit, banka eşlemesi veya muhasebe fişi boş/eksik kalır. Hesap planı, `journal_entries` ve `journal_lines` çift taraflı muhasebe kapsamı ileride seçilirse eklenir; bugünkü finans projeksiyonlarına “kesin muhasebe defteri” adı verilmez.

## 5. Çok dosyalı JSON sözleşmesi

```text
<private-output>/generations/<generation-id>/
  manifest.json
  schemas/manifest.schema.json
  schemas/partition.schema.json
  schemas/source-manifest.schema.json
  data/<collection>/<source-or-domain-partition>/<chunk>.json
  raw/<source-key>/metadata-<hash>.json
  raw/<source-key>/chunk-<hash>.json
  raw/supplements/<hash>.json
```

Bu ağaç uygulanan exporter düzenidir. İş koleksiyonu parçaları en fazla 512, ham hücre parçaları en fazla 2.048 kayıt taşır. Manifest `schemaVersion`, `tenant_id`, `generation_id`, `files`, `sources`, `counts`, `consistency`, `currency_policy`, `storage_policy` içerir. Dosya girdileri hash, byte ve varsa kayıt sayısını taşır. Tek nesil staging'de yazılır, doğrulanır ve atomik rename ile yerleşir; mevcut nesil doğrulanıp yeniden kullanılır. Mutable `latest` pointer, cron veya otomatik deployment eklenmez.

Uygulanan partition zarfı `{schemaVersion: 1, collection, records: [...]}` biçimindedir. Kayıtların ortak çekirdeği `id` ve `tenant_id`; türlenen iş kayıtlarında `kind`, `source_id`, `source_record_id`, `source_attributes`, `attributes`, `provenance`, `deleted_at` bulunur. Oluşturma/güncelleme/sürüm gibi kaynak alanları mevcutsa `attributes` içinde korunur; olmayan zaman uydurulmaz.

- Kimlikler: sabit namespace ve kalıcı mantıksal bileşenlerden UUIDv5. App kayıtlarında kaynak anahtarı + sekme kimliği + özgün kayıt kimliği; özgün değer ayrıca `source_record_id`. App satırını taşımak ID değiştirmez. Ham hücre/satır ve gözlemlerin koordinat kimliği taşımada değişebilir. Kimliksiz dolu app satırı issue olur.
- Para: `{ "amount": "1234.50", "currency": "TRY" }`; ana para biriminde ondalık dizge. Kuruş değildir. PostgreSQL'e `numeric` olarak alınır. Minor-unit değişimi açık adaptör gerektirir. Boş, sıfır ve hücre hatası farklıdır. Kaynak number hassasiyetinden fazlası varsayılmaz.
- Tarih: ISO gün ve UTC timestamp ayrı. Kaynakta olmayan gün oluşturulmaz. Aylık gözlem `period: YYYY-MM`; provenance kaynak hücreyi tutar. Timezone ve locale kaynak metadata'da korunur.
- Kaynak: effective scalars `source_attributes`, türlenmiş alanlar `attributes`, native formül/hata/not/format/validation `source_cells` ve byte-for-byte raw arşivde kalır. Henüz modellenmemiş sekmeler kaybolmaz; kaynak-only olarak işaretlenir.
- UI bağımsızlığı: JSON'da Mantine component adı, JSX, CSS sınıfı, piksel yerleşimi veya çalıştırılabilir fonksiyon yok. Alan kimlikleri, tür, ilişki, ölçü anlamı ve görünüm yeteneği vardır.
- Supplement sınıflandırması: kaynak manifestte belirtilen `classification` aynen korunur; eksik olduğunda exporter `external_catalog_or_configuration` varsayılanını kullanır. Sheet yorumları, geçmiş engine yapılandırması ve katalog ekleri aynı varsayılan sınıfa zorlanmaz. Etiket tek başına finansal gerçeklik kanıtı değildir.
- Kapsam: yalnız uygulanan dönüştürücülerin bildiği kayıtlar domain koleksiyonlarına geçer. Kaynak arşivinin tam olması her hücrenin iş modeli çözüldü anlamına gelmez.

JSON Schema 2020-12 dosyalar arasında `$ref` ile paylaşılabilir sözleşme sağlar. Validator'ın `format` denetimini gerçekten uyguladığı negatif testle doğrulanmalı; referans/finans bütünlüğü ek runtime kapıları gerektirir. [JSON Schema core](https://json-schema.org/draft/2020-12/json-schema-core) · [2020-12](https://json-schema.org/draft/2020-12)

## 6. Vocabulary ve state machine tasarımı

Önerilen vocabulary'ler: `product_category`, `expense_category`, `room_type`, `project_phase`, `life_context`, `procurement_status`, `payment_status`, `task_status`, `provider_selection_status`, `inspection_result`, `financing_type`, `payment_method`, `priority`, `unit`, `confidence`, `relationship_type`.

Her terimde ID, vocabulary ID, makine kodu, yerelleştirilmiş ad, açıklama, sıra, etkinlik, parent ID ve gerekirse eski kod alias'ları bulunur. Yeniden adlandırma referansları bozmaz. Kullanımdaki terim silinmez; pasifleştirilir veya denetimli birleştirilir. Kategori ağacı için döngü yasaktır; çok ebeveynli yapı ancak gerçek kullanım ispatlanırsa açılır. Önce tek ebeveynli kategori ağacı + ayrı çoklu bağlam etiketleri yeterlidir.

Önerilen kategori omurgası: Elektrik → Aydınlatma / Kablolama / Kontrol ve otomasyon / Güç ve koruma; Mutfak → Küçük elektrikli aletler → Kahve / Hazırlık / Pişirme; Sofra ve servis; Pişirme gereçleri; Düzenleme ve depolama → Çekmece / Dolap / Balkon; Mobilya; Tekstil; Banyo ve bakım; Temizlik; Güvenlik; Çalışma ve elektronik. Dock/bağlantı istasyonu öncelikle çalışma elektroniğidir; kablo düzenleme ihtiyacı ayrıca kullanım etiketi olabilir. Tencere/tava ve bardak aynı mutfak ana kümesinde, farklı alt kümelerde yer alır. Köpek bir yaşam bağlamı; köpeğe özgü ürün kategorileri ayrıca tanımlanabilir. Banyo fırçasını köpek bağlamına yalnız eski yanlış etiket nedeniyle atamak yoktur.

State machine yalnız vocabulary listesinden oluşmaz. Tanımda `workflow_id`, sürüm, hedef record type, başlangıç durumu, durum terimleri ve `transition {from, event, to, guard_ids, required_fields}` bulunur. Guard'lar uygulamada izinli ve testli kuralların kimlikleridir; JSON'a keyfi JavaScript/SQL yerleştirilmez. Mevcut normalized kayıtlar durum kodlarına ek `state_term_ids` UUID referanslarını taşır; ikisinin aynı vocabulary terimini göstermesi doğrulanır. Bunlar geçmiş olay yaratmaz. Durum geçişlerinin olay ve koşullarla tanımlanması SCXML yaklaşımıyla uyumludur; SCXML runtime kurulması zorunlu değildir. [W3C SCXML](https://www.w3.org/TR/scxml/)

Örnek paralel iş akışları:

- Tedarik: fikir → araştırılıyor → seçildi → sipariş verildi → kısmen teslim → teslim edildi; iptal/iade dalları ayrı. “Kuruldu” gerekiyorsa kurulum işinin durumudur.
- Ödeme: ödenmedi → kısmen ödendi → ödendi; iade/alacak/itiraz ayrı olaylarla izlenir. `paid` elle işaretlenmez; teyitli ödeme dağıtımlarından türetilir.
- Görev: taslak → hazır → sürüyor → kontrol bekliyor → tamamlandı; bloke/iptal gerekçelidir. Bağımlı görev bitmeden başlama guard'ı göreve göre uygulanır.
- Usta seçimi: aranıyor → adaylar var → teklif bekleniyor → seçildi → sözleşildi. Ustanın bulunması tadilatın tamamlanması değildir.
- Kontrol: bekliyor → yapıldı; sonuç bağımsız geçer/kalır/eksik/uygulanamaz. Kontrol tarihi, kişi ve kanıt gereksinimi kontrol türüne aittir.

Yanlışlıkla geçişte Undo önceki sürümü kontrol eden telafi olayıdır. Başka bir kullanıcı daha sonra değiştirmişse sessiz geri sarma yoktur. Ödeme kaydını geri almak, siparişi teslim edilmedi yapmakla eşdeğer değildir.

## 7. İlişkiler ve finansın değişmez kuralları

Örnekler: aydınlatma cihazı → oda ataması → kullanım amacı; alım ihtiyacı → seçilen teklif → sipariş satırı → teslimat → varlık; ödeme → ödeme dağıtımı → yükümlülük; ödeme → finansman dağıtımı → hesap/kart; araç varlığı → finansman sözleşmesi → banka → taksit planı → gerçek ödeme.

Bir ödeme birden fazla kaynaktan karşılanabilir. Bu nedenle finans kaynağı tek metin alanı değildir. Birikim hesabından transfer, kredi kullanımı, KMH kullanımı, kart yüklemesi, kişisel borç ve avansın her biri uygun hesap/sözleşme ve tutarla bağlantılıdır. Kullanılabilir limit, toplam limit ve kullanılan borç ayrı alanlardır. Maaş avansı ile kredi kartı nakit avansı ayrı terimlerdir; kullanıcıdaki “avans” kaynağı belirsizse çözülmeden birini seçmek yoktur.

Kontroller:

1. Alımın tamamı + taksit ödemeleri birlikte gider toplamına iki kez eklenmez. Harcama tanıma ve nakit çıkışı ölçüleri ayrılır.
2. Kredi kullanımı ve hesaplar arası transfer gelir sayılmaz. Kart borcu ödemesi yeni ürün alımı değildir.
3. Aynı para birimindeki ödeme dağıtımları ödeme toplamıyla uzlaşır; farklı para biriminde oran/kaynak/tarih olmadan toplam yapılmaz.
4. Bakiye pivotta toplanmaz; tanımlanan dönem sonundaki son doğrulanmış bakiye alınır. Nakit hareketi ve gider akışı doğru filtrelerle toplanır.
5. Plan, gerçekleşen ve senaryo ayrı `record_basis` (aylık gözlemlerde mevcut alan `basis`) taşır. Gelecek Timeline olayı gerçek banka hareketine dönüştürülmez.
6. Faiz, vergi, ücret, anapara ve kur farkı ayrı ölçüdür. Eksik kaynak veri “0” diye kapatılmaz.
7. Tüm temel ilişkiler aynı hanede olmalıdır. İlişki geçerli kimliğe işaret eder; yetim kayıt raporlanır.

## 8. Yeni yönetim paneli ve kullanıcı yolculuğu

Ana gezinme: Genel durum; Bütçe ve nakit; Ödemeler; Hesaplar ve borçlar; Alımlar ve eşyalar; Ev ve odalar; Projeler ve görevler; Taraflar ve teklifler; Raporlar; Sözlükler ve iş akışları; Veri kalitesi ve içe aktarma. Bu bilgi mimarisi hedef tasarımdır; mevcut route'lar geçişte korunur, tek seferde kaldırılmaz.

Ortak sayfa iskeleti:

1. Hane/proje bağlamı, sayfa başlığı, kaynak tazeliği ve temel eylem.
2. Anlamlı özet: bu sayfadaki kayıt sayısı, kapsamı açık tutar veya iş durumu. Her yere toplam para kutusu koyulmaz.
3. Sorgu çubuğu: arama, kayıtlı görünüm, görünüm modu, sıralama, dışa aktarma.
4. Masaüstünde açık sol filtre; içerikte sonuçlar. Mobilde aynı filtre durumu sol panelde; seçili filtreler içerikte görünür.
5. Kayıt seçilince ortak ayrıntı yüzeyi: kimlik/fotoğraf → plan/gerçek bilgiler → durum ve eylem → bağlı kayıtlar → kaynak/audit. Genişte yan panel, dar alanda tam genişlik; aynı form ve iş kuralları.

Kritik yolculuklar:

| Soru / iş | Akış | Kabul |
|---|---|---|
| Koltuk ne kadar, ne zaman, hangi araçla? | Alım → sipariş/teklif → ödeme dağıtımı | Planlanan fiyat, sipariş bedeli ve gerçekleşen ödeme ayrı; bilinmeyen açık. |
| Bu hafta hangi nakit gerekli? | Ödemeler → dönem + nakit yöntemi → ödeme ayrıntısı | Nakit ve kart yüklemesi karışmaz; rezerv/limit gerçek kaynakla ilişkilidir. |
| Taşınma sonrası mutfakta ne eksik? | Proje aşaması Sonra + oda Mutfak + tedarik durumu | Bebek bağlamı bağımsız filtredir; tüm görünümler aynı kayıt kimliklerini verir. |
| Yanlışlıkla aldım işaretledim | Kayıt → geçiş → Undo veya durum düzeltme | Sonraki değişiklik ezilmez; gerçek ödeme/teslimat kaydı sessiz silinmez. |
| Ürün fotoğrafını görmek | Kayıt adı/thumbnail → ayrıntı → galeri | Doğru ürün ve varyant; eksik fotoğraf açık; tüm resimler peşinen indirilmez. |
| Usta bul, işin sırasını planla | Proje → görev → aday/teklif → atama → kontrol | Seçim, sözleşme, işin yapılması ve ödeme ayrı aşamalar. |

Tasarım yönü: nötr çalışma zemini, beyaz veri yüzeyleri, lacivert hane navigasyonu; durum rengi sınırlı ve metinle destekli; tutarlar hizalı; kaynak açıklaması alanına yakın. Mağaza tarzı büyük kart gridleri varsayılan değildir. Görsel ayrım boşluk, hizalama, yüzey ve bölüm başlığıyla kurulur; her mikro alan kutu içine alınmaz. Görünüm değişimi seçimi, filtreyi, sıralamayı ve odak dönüşünü korur.

## 9. Altı görünüm modu tek sorgu modeliyle

| Mod | Amaç | Geçerli veri / zorunlu semantik |
|---|---|---|
| `listing` | Hızlı tarama, mobil iş listesi | Başlık, kimlik, temel durum, birincil bilgi; tabloyla aynı kayıt kümesi |
| `table` | Karşılaştırma, sütun ve toplu işlemler | Türlenmiş sütunlar, doğal sıralama, okunabilir genişlik; tablonun kendi kaydırması |
| `timeline` | Tarihli olay sırası | Tarih + olay türü; plan/gerçek ayrımı; tarihsizler ayrı grupta |
| `kanban` | İş durumuna göre akış | Seçilmiş tek workflow; sürükleme şart değil, klavyeli “Durumu değiştir” yolu |
| `gantt_chart` | Süre ve bağımlılık planlaması | Görev/proje başlangıç-bitiş, milestone, bağımlılık; tarih yoksa tahmin edilmez |
| `pivot` | Gruplanmış analiz | Boyutlar + ölçü sözleşmesi + aggregation; gerçek/plan ve para birimi ayrımı |

Altı mod sistemin yetenek kataloğunda vardır; her kayıt türüne anlamsız bir Gantt veya Kanban zorlanmaz. Örneğin banka hesabı listesinin Gantt'ı yoktur; hesapla ilişkili taksit/görev çizelgesi vardır. Uygulanamayan mod açık gerekçeyle gösterilir. Pivot hücresi kaynak kayıtları açar; toplamdaki ilişkisel çoğalma hatası test edilir.

`view_definitions`: veri kümesi kimliği, mode, alan kimlikleri, izinli filtre operatörleri, sort, group, measure/aggregation, date field, workflow ID. `saved_views`: kullanıcı/hane ve query AST. Component props içermez. Aynı query sonucu için tüm modlar aynı ID kümesini ve aynı iş anlamını üretir.

Tabloyu sırf görünümü için ARIA grid yapmak yoktur. Etkileşimli hücre düzenleme gerçekten gerekiyorsa grid klavye sözleşmesi uygulanır; salt okunur tabloda semantik table daha uygundur. [W3C grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

## 10. Gelişmiş ilişkisel filtre

Ayrı boyutlar: kategori ağacı, ev/oda, proje, proje aşaması, yaşam bağlamı, tedarik durumu, ödeme durumu, finansman türü, hesap/kart, sorumlu, tarih türü ve aralığı, tutar aralığı/para birimi, veri güveni, fiyat/fotoğraf eksikliği.

Aynı boyutta çoklu seçim OR; farklı boyutlar AND. İleri sorguda açık AND/OR grupları; başlangıçta basit arayüz. Kategori ebeveyni alt terimleri kapsar; “yalnız bu alt kategori” işlemi başka filtreleri silmez. Parent'ın kısmi seçimi ve odak/seçim ayrılığı korunur. Tree rolü kullanılacaksa gerçek tree klavye davranışı da sağlanır; basit açılır checkbox grubu da geçerli tasarım olabilir. [W3C tree view](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

Facet sayıları diğer boyutların etkin filtrelerine göre hesaplanır; seçili değeri sıfır sonuç diye yok etmez. “Bilinmiyor” ayrı değerdir. Sonuçsuz görünüm hangi filtrelerin etkili olduğunu söyler. “İlişkili ödeme → finansman türü = KMH” bir join sorgusudur; ürünün eski serbest notunda KMH sözcüğü aramak değildir. Tarih filtresi “sipariş / son ödeme / gerçekleşen / teslimat” seçimini açık gösterir.

## 11. Sheets → JSON pipeline ve performans

1. Kaynak sicili: bütün ilgili workbook, sekme, named range, uygulama API kaynağı ve kod içi dataset listelenir; kişisel erişim kimlikleri özel yapılandırmada kalır.
2. Toplu okuma: sınırlandırılmış aralıklar ve alanlar; locale/timezone ve şema başlıklarıyla birlikte alınır. Ham değer/formül gereken yerde ayrı yakalanır. Sheets `batchGet` birden çok aralığı okuyabilir; kota ve hata geri denemesi sınırlandırılır. Google yaklaşık 2 MB isteği performans önerisi olarak belirtir; bunu katı servis boyut limiti diye sunmayız. [batchGet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet) · [Kotalar](https://developers.google.com/workspace/sheets/api/limits)
3. Ham snapshot: her sekmenin saklanan hücrelerini ve metadata'sını kapsar; dönüştürülemeyen veri kaybolmaz.
4. Saf normalizasyon: kimlik, değer, tarih, vocabulary, ilişki; yeni iş olayı icat etmez.
5. Doğrulama: JSON şeması + referanslar + finansal uzlaşım + kaynak kapsamı. Başarısız nesil karantinada kalır.
6. Bölümlenmiş çıktı: deterministik sıralama, hash ve record count. Aynı kaynak aynı domain çıktısını verir; import zamanı içerik hash'ini gereksiz değiştirmez.
7. Atomik nesil üretimi: bütün dosyalar doğrulanınca staging klasörü immutable generation konumuna taşınır. Mevcut exporter mutable current/latest pointer kurmaz. UI nesil seçme adaptörü ayrı uygulanacaktır.
8. UI okuması: önce manifest ve aktif çalışma alanının küçük veri parçaları; ağır görünümler ve fotoğraflar ihtiyaçta. Eşzamanlı aynı istekler birleştirilir. Veri tazeliği ve son başarılı güncelleme görünür.

Tam snapshot tutarlı transaction snapshot diye varsayılmaz: Sheets'te okuma sürerken değişiklik olabilir. Başlangıç/son kaynak sürümü veya digest kontrolü, mevcut finans nesil göstergeleri ve uzlaşım kullanılır; yarış tespitinde sınırlı yeniden okuma/karantina. Birden çok workbook atomik değildir.

Performans kabulü önce mevcut production build üzerinde ölçülür. Projenin mevcut bütçeleri korunur; yeni bütçe gerekirse ölçüm koşulları ve KiB/sıkıştırma birlikte kaydedilir. Sıcak önbellek hızını soğuk açılış hızı diye sunmak yoktur. Gantt/pivot/grafik kodu listing ilk açılışında indirilmemeli; React lazy bunu mümkün kılar ama gerçek ağ isteği ve service worker davranışıyla doğrulanmalıdır. [React lazy](https://react.dev/reference/react/lazy)

Query index: kategori/oda/durum ID kümeleri bir nesil için bir kez hazırlanır; tekrarlı component taraması yapılmaz. Büyük listede önce sayfalama; ölçülen ihtiyaçta erişilebilir sanallaştırma. Ağ/veri boyutu, parse-normalize süresi, ilk yararlı kayıt, filtre gecikmesi ve hafıza ayrı ölçülür. 10 bin kayıt yalnız sentetik yük testi olabilir; gerçek mevcut kapasite diye sunulmaz. Core Web Vitals hedefleri LCP 2,5 sn, INP 200 ms, CLS 0,1 ve alan verisinde yüzde 75 ölçümüdür; laboratuvar sonucu bunların saha başarısı değildir. [Web Vitals](https://web.dev/articles/vitals)

## 12. PostgreSQL'e taşınabilirlik

Önce private JSON staging, sonra açık kolonlu ilişkisel tablolar. Her koleksiyon tabloya; çoklu ilişki join tablosuna; term ve vocabulary ayrı tablolara; workflow geçişi/event ayrı tablolara eşlenir. İlk göç haritası immutable snapshotları kaybetmemek için `(tenant_id, generation_id, id)` anahtarını kullanır. Tenant ve generation kimliği manifestten gelir; kayıttaki UUIDv5 yeniden üretilmez. Gelecek canlı CRUD tablolarının `(tenant_id, id)` modeli, snapshot içe aktarımından ayrı bir geçiştir. Parasal `amount` alanı `numeric`, günler `date`, olay zamanı `timestamptz` olur. JSONB ham kaynak ve kontrollü esnek özelliklerde kullanılır; bütün sistemi tek `data jsonb` tablosuna koymak hedef değildir.

PostgreSQL JSONB sorgu ve indeks imkânı sağlar; foreign key ve unique/check kısıtlarının yerine geçmez. JSON nesne anahtar sırasına bağımlı davranış kullanılmaz. `jsonb_to_recordset` gibi fonksiyonlar staging dönüşümünde yararlı olabilir. [JSON türleri](https://www.postgresql.org/docs/18/datatype-json.html) · [Kısıtlar](https://www.postgresql.org/docs/18/ddl-constraints.html) · [JSON fonksiyonları](https://www.postgresql.org/docs/18/functions-json.html)

Göç kapıları: kopya DB'de dry-run → şema/referans kontrolü → adet/hash/tutar uzlaşımı → idempotent tekrar → kesilme/rollback → restore provası. Sadece SQL dosyası yazmak “PostgreSQL'e taşındı” değildir. Gerçek hedef sürüm ve operasyon sahibi uygulama öncesi netleşir.

Multi-tenant aşamada erişim uygulama sunucusunda doğrulanır; RLS savunma katmanı olabilir. RLS etkin ama policy yoksa varsayılan ret davranışı; tablo sahibi ve BYPASSRLS rolleri istisnası bilinerek test edilir. JSON'daki `tenant_id` tek başına güvenlik sağlamaz. [Row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)

## 13. Gap ve bilinmeyenleri keşfetme kaydı

Aşağıdakiler bulunmuş gerçek veri diye değil, test edilmesi gereken ürün soruları ve failure mode'lar olarak kaydedilir.

| Öncelik | Açık risk / bilinmeyen | Keşif / kabul kapısı |
|---|---|---|
| P0 | Aynı alım iki sekmede farklı tutar veya adla var | Kaynak sahipliği matrisi; ID/semantik eşleme; çelişki kuyruğu; sessiz birleşim yok |
| P0 | Formül sonucu eski veya hatalı; tüm sekmeler alınmamış | Kaynak nesli, hücre hata kodu, kapsam sayımı; eksikte tamamlandı yok |
| P0 | Gerçek aile verisi public JSON olarak yayımlanır | Export hedefi Git dışı; build/commit sızıntı kontrolü; hassas alan sınıfları |
| P0 | Plan ve ödeme aynı toplama girer | Kaynak-temelli measure sözleşmesi; pivot/Timeline/özet parity testi |
| P0 | Satın alındı işareti ödeme/teslim varsayar | Ayrı workflow ve ilişkiler; kayıtsız “ödendi” geçişi reddedilir |
| P0 | Eşzamanlı Sheet ve panel düzenlemesi | Sürüm koşulu, conflict UI, idempotency; son yazan kazanır yok |
| P0 | Çok haneli üründe çapraz erişim | Owner/editor/viewer rol matrisi; server/RLS tenant negatif testleri; çocuk/mahrem veri kapsamı |
| P1 | Kısmi ödeme/teslim/iade/chargeback/cancel | Allocation miktar ve tutar uzlaşımı; telafi olayları; negatif tutar kuralı açık |
| P1 | Ekstre, taksit, faiz ve harcama iki kez sayılır | Anapara/faiz/vergi/ücret ayrımı; kaynak kart olayları ve nakit ödeme testi |
| P1 | Tekrar eden ödeme farklı gün/ay tatiliyle değişir | Takvim istisnası, timezone, due date + occurrence ID; otomatik tahminleri etiketle |
| P1 | Depozito, kapora, avans, geri alınacak para gider sayılır | Alacak/yükümlülük/transfer ayrımı; kanıt ve amaç alanı |
| P1 | Bir ürün iki oda, bir görev iki usta, bir ödeme iki kaynak | Nicelikli ilişki tabloları; join çoğalmasından çift toplam testi |
| P1 | Kategori taşınınca kaydedilmiş görünüm değişir | Terim kimliği korunur; taxonomy sürümü ve eski filtre göçü |
| P1 | Tarihsiz/aylık kayda gün uydurulur | Date precision; Gantt tarihsiz kuyruğu; Timeline bilinmeyen grubu |
| P1 | Fotoğraf yanlış ürün/varyant, lisans belirsiz | Media source/license/variant/verified status; eksik görsel; kullanıcı yüklemede EXIF mahremiyeti |
| P1 | Offline cihaz eski kaydı yeniden diriltir | Tombstone, operation ID, version, conflict; hesap çıkışında yerel veri politikası |
| P1 | Yedek var ama geri yüklenemiyor | Salt okunur export restore provası ve SQL restore testi; saklama süresi kararı |
| P1 | Kur farkı veya küsurat ödeme eşleşmesini bozar | Currency/scale/rate source/date; decimal yuvarlama politikası; mixed-currency toplam yasağı |
| P2 | Araç/ev satıldı veya oda değişti | Tarihli sahiplik/yerleşim; eski işlemler yeni oda adına geriye dönük taşınmaz |
| P2 | Gantt tatil, ekip kapasitesi ve bağımlılık türlerini varsayar | İlk aşama yalnız açık tarih ve finish-to-start; gelişmiş planlama ayrı özellik |
| P2 | SaaS aboneliği/rol paylaşımı ürün gereksinimi sanılır | İlk aile pilotunda gerçek kullanım; ücretlendirme/abonelik/self-service daha sonra |

Bilinmeyenleri keşfetmek için örnekleme: en yüksek tutarlı kayıtlar; boş/negatif tutarlar; yinelenen isimler; eski silinmiş kayıtlar; aynı ürüne çok ödeme; aynı ödemeye çok ürün; kategori ebeveyn değişimi; taşınma tarihi değişince fazı değişen işler; kaynaktaki çok uzun not/boş ID/formül hatası; yeni tarayıcı/çevrimdışı/iki editör. Sonuçlar `issues` koleksiyonunda kaynak, etki, çözüm ve durumla tutulur. “Unknown unknown analizi tamam, başka risk yok” denmez.

Yedek stratejisinde SQL dump, dosya düzeyi ve PITR farklı yaklaşımlardır; pre-MVP'de tercih edilen yaklaşım restore provasıyla doğrulanır. Zamanlanmış iş bu belgeyle otomatik kurulmaz. [PostgreSQL backup](https://www.postgresql.org/docs/18/backup.html)

## 14. Önerilen görev şablonları

Bu görevler kullanıcıya önerilen şablonlardır; gerçek atanmış/yapılmış iş gibi import edilmez. Kullanıcı/proje ihtiyacından örnek oluşturulduğunda sahibi ve tarihi ayrıca belirlenir.

| Şablon | Bağımlılık | Tamamlanma koşulu |
|---|---|---|
| Ev ihtiyaçlarını ve oda listesini netleştir | Proje açılmış | Oda kimlikleri, ölçülerin kaynağı ve eksikler kayıtlı |
| Kiralık ev seçimini kararlaştır | Adaylar ve toplam maliyet | Karar + teklif/sözleşme bağlantısı; ödeme ayrıca |
| Taşınma tarihini ve teslim sırasını belirle | Ev erişim tarihi | Milestone, belirsizlik, bağımlılık çakışmaları görünür |
| Oda ölçülerini ve elektrik noktalarını doğrula | Erişim izni | Ölçüm ve fotoğraf/kanıt; geçer/eksik sonucu |
| Koltuk teklifini seç ve siparişi kaydet | Ölçü + bütçe kararı | Ürün/varyant, satıcı, sipariş bedeli, teslim aralığı kayıtlı |
| Usta adaylarını ve teklifleri karşılaştır | İş kapsamı | Kapsam, fiyat, süre, sorumlu; seçilmemiş teklifler korunur |
| Malzeme miktarını çıkar ve alımı planla | Ölçü/şartname | Birim, miktar, oda, eksik bilgi; ödeme varsayımı yok |
| İşi kendin yapma uygunluğunu değerlendir | İşin risk/kabiliyet gereksinimi | Kendi yap/uzmana ver kararı ve gerekçe; elektrik/güvenlik işi otomatik önerilmez |
| Malzemeyi teslim al ve kontrol et | Sipariş | Teslim miktarı, hasar/eksik, kontrol sonucu |
| Kurulumu ve kabul kontrolünü tamamla | Teslimat + iş sırası | Kontrol listesi/kanıt; eksik işler ayrı görev |
| Fatura ve ödeme eşleşmesini doğrula | Belge/ödeme | Tutar/para birimi/tarih/satıcı; unmatched kayıtlar açık |
| Garanti ve bakım takvimini kaydet | Varlık teslimi | Belge, başlangıç/süre, bakım gereksinimi; bilinmeyen açık |

## 15. TDD ile yürütme sırası ve çıkış ölçütü

| Aşama | Önce başarısız test / kanıt | Uygulama | Çıkış ölçütü |
|---|---|---|---|
| 0. Kaynak envanteri | Atlanan sekme/alan veya yerel dataset raporlanmıyor | Sicil, kayıpsız raw snapshot, kaynak sahipliği | Her bilinen kaynak alınmış veya açık eksik; Pages workflow hash'leri değişmemiş |
| 1. JSON sözleşmesi | Boş tutar sıfıra dönüyor, ID yineleniyor, invalid date/relation kabul ediliyor | Modüler şema, deterministik normalize/validate/export | Aynı kaynağın tekrarı aynı ID/hash; tüm alanlar normalized veya raw olarak korunmuş |
| 2. Domain ve taxonomy | Bebek kronolojik faza karışıyor; yanlış kategori join sonucu | Ayrı vocabulary, typed relations, migration mapping | Parent-child ve başka facet kesişimleri doğru; çelişkiler görünür |
| 3. Workflow | Teslim işareti ödeme üretir; stale Undo yeni değişikliği ezer | Geçiş guard'ı, sürüm, event/audit | İzinli/yasak geçişler ve conflict kabulü; finansal durum kanıtsız ilerlemez |
| 4. Yönetim kabuğu | 320'de ana eylem/filtre/odak kaybolur | Ortak kabuk, query state, listing/table, ayrıntı | Kritik üç kullanıcı yolculuğu 320'de çalışır; eski route/deploy korunur |
| 5. Görünüm adaptörleri | Mode değişince kayıt veya tutar değişir | Timeline/kanban/gantt/pivot ayrı lazy modüller | Aynı query/ID/measure; date/workflow gerekleri; klavye alternatifi |
| 6. Fotoğraf | Yanlış varyant veya tüm galeri istenir | Media ilişkisi, ayrıntı galerisi | Yalnız seçili gereken görsel; eksik/resim hatası/dönüş odağı |
| 7. Performans ve erişim | Soğuk açılışta ilgisiz dataset/chunk gelir | Manifest/chunk/index/sayfalama optimizasyonu | Önce/sonra ağ ve süre; mevcut bütçe gerilemez |
| 8. PostgreSQL prova | Yetim/duplicate/cross-tenant kayda izin, restore farkı | Staging→typed tables, constraints, dry-run | Adet/tutar/ilişki eşitliği, idempotency, rollback ve restore kanıtı |

Her aşama küçük incelenebilir parçadır. İlk teslimin kapsamı veri temeli ve uygulanabilir panel planıdır; altı modun tamamı henüz uygulanmadan “yeni UI bitti” denmez. Aşama 4–6 tasarım ve işlev teslimi bağımsız UI QA'dan geçer. Telefon 320 → 360 → 375 → 390 → yatay → tablet → masaüstü kabul sırası korunur. İzole Chromium/WebKit, gerçek Chrome/Safari ve fiziksel cihaz farklı sonuçlar olarak raporlanır; Firefox çalıştırılmaz. 320'de iki yönlü kaydırma yalnız gerçekten iki boyutlu tablo/grafik kapsayıcısında olur. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)


## Uygulanan veri temeli ile hedef panel arasındaki sınır

Mevcut koleksiyonlar [`validate.mjs`](../data-platform/validate.mjs) içindeki allowlist ile sınırlıdır: kaynaklar/arşiv, settings/rooms, sekiz türlenmiş ev kaydı ve unclassified items, payments, relations, media references, budget observations, forecasts/events/months, vocabularies/terms/workflows/view definitions, task templates, issues ve supplements. Hedef modeldeki siparişler, sözleşmeler, gerçek hesap/borç/ödeme dağıtımları ve audit eventler henüz tam domain koleksiyonu değildir. Bunlara kaynakta kanıt olmadan kayıt üretilmez.

[`task-templates.json`](../data-platform/dictionaries/task-templates.json) önerilen 15 görev tarifidir. Exporter bunları `task_templates` koleksiyonuna deterministik UUIDv5, korunmuş `key`, `workflow_id` ve `dependency_template_ids` referanslarıyla alır. Bunlar gerçek görev instance'ı veya bugün atanmış takvim değildir. Bağımlılık referansları ve döngü kontrolü ayrı doğrulanır. [`postgres-mapping.json`](../data-platform/postgres-mapping.json) 29 mevcut koleksiyonun planlanan SQL eşlemesidir; doğrulanmış nesilde hash'li sözleşme artefaktı olarak saklanması veri göçünü yürütmez. SQL veritabanında çalıştırılmadı.

## Route, eylem ve görünüm uygulama matrisi

Mevcut route'lar aşağıdaki şekilde korunur. Mod anahtarları [`views.json`](../data-platform/dictionaries/views.json) ile aynıdır: `listing`, `gantt_chart`, `table`, `pivot`, `kanban`, `timeline`. Tanım dosyaları UI renderer kurmaz. Gantt'ın mevcut sözleşmesi yalnız `dates.planned_on` ve `dates.end_on` alanları açık olan `work_order`/`milestone` kayıtlarına uygundur; kaynak bitiş tarihi `completed_on` diye yeniden adlandırılmaz, fiili tamamlanma kanıtı sayılmaz. Eksik tarih doldurulmaz. Forecast eventler `listing`/`table`/`timeline`, forecast month kayıtları yalnız `table` destekler; aylık başlık `period` alanıdır. Forecast bakiye/projeksiyonları pivot toplamına alınmaz.

| Mevcut route | Kullanıcı eylemi | JSON koleksiyonları | İlk/sonraki görünüm hedefi | Eksik veri veya sözleşme |
|---|---|---|---|---|
| `#/pano` | Dönemi ve plan/gerçek farkını incele | `budget_observations`, `forecast_months` | `table`; sahiplik eşlemesinden sonra `pivot` | Kaynak subtotal ve leaf sahipliği olmadan toplam yok |
| `#/timeline` | Belirli tarihteki para/borç etkisini takip et | `forecast_events`, `payments` | `timeline`, `table` | Forecast tarih temeli açık; gerçek ödeme ile birleşik toplam yok |
| `#/finansman` | Nakit, kart ve KMH projeksiyonunu incele | `forecasts`, `forecast_months`, `forecast_events` | `forecast_month` için `table`; event için `listing`, `table`, `timeline` adaptörü planlandı | Bunlar forecast; gerçek banka hesabı/borç sözleşmesi koleksiyonu değil |
| `#/butce` | Gerçek kaydedilen ödemeyi bul/düzelt | `payments`, `relations` | `listing`, `table`, `timeline`; kontrollü `pivot` | Kaynakta yöntem/hesap/kanıt eksik; bilinen ödeme diye doldurulmaz |
| `#/ev` | Alım planını bütçeyle ilişkilendir | `purchase_needs`, `budget_observations`, `relations` | `listing`, `table` | Alım planı ve ihtiyaç eşleme anahtarı çözümlenmeden para çift sayılmaz |
| `#/satinalma` | İhtiyacı filtrele, fotoğrafı aç, alım durumunu yönet | `purchase_needs`, `media_references`, `rooms`, `terms`, `relations` | `listing`, `table`, `kanban`, `timeline` | Görsel adayları doğrulanmış fotoğraf değil; güvenli geçiş engine'i henüz UI'ya bağlanmadı |
| `#/aydinlatma` | Oda, ışık katmanı ve cihazı karşılaştır | `lighting_specs`, `rooms`, `relations` | `table`, `listing` | Uygulama işi ayrı work order ilişkisiyle Gantt'a bağlanır |
| `#/yerlesim` | Eşyayı ve oda yerleşimini doğrula | `layout_items`, `rooms`, `relations` | `table`, `listing` | Mevcut özel yerleşim görünümü korunur; bu altı moddan biriymiş gibi yeniden adlandırılmaz |
| `#/tadilat` ve `#/tadilat/isler` | İş sırası, durum ve bağımlılıkları yönet | `work_orders`, `milestones`, `relations` | `listing`, `table`, `kanban`, `timeline`, uygun tarihlerde `gantt_chart` | Önerilen task template gerçek görev veya son tarih değildir |
| `#/tadilat/ustalar` | Aday ve teklif karşılaştır | `providers` | `listing`, `table`, `kanban` | Kaynak provider state yoksa bilinmeyen kolon; bulundu/kontrat varsayılmaz |
| `#/tadilat/kontrol` | Kontrolü ve kanıtı incele | `inspections`, `relations` | `listing`, `table`, `kanban` | “Tamamlandı” geçer sonucu veya ödeme değildir |
| `#/arac` | Araç ve kredi senaryosunu karşılaştır | `supplements` ve ileride Sheets kaynaklı araç domaini | Mevcut araç görünümü korunur | Araç supplement'inin kaynak sınıflandırması korunur; supplement ayrıca Sheet yorumları veya geçmiş yapılandırma da içerebilir; hiçbirinden gerçek kredi/alım olayı uydurulmaz |
| `#/ayarlar` | Kaynak, sözlük, şema ve sorunları yönet | `settings`, `vocabularies`, `terms`, `workflows`, `issues`, `sources` | İlgili yönetim tabloları ayrıca tasarlanır | Mevcut views supported kinds'a kayıtlı değiller; planlanan genişletme |

Uygulama sırası: önce `#/satinalma` listing/table + ortak detay ve fotoğraf; ardından `#/butce` payment parity; sonra iş/kanban/Gantt; ardından finans forecast adaptörü ve pivot sahiplik haritası. Her adımda eski route ve aynı kaynak anlamı korunur; yeni mod görünümü açılmadan veri uygunluğu kontrol edilir.

## 16. Bu belgeye ait doğrulama durumu

- Araştırma: resmi kaynaklar açıldı; ilgili resmi bağlantılar bu belgede yer alır.
- Repo incelemesi: mevcut şema, manifest ve proje sözleşmesi okundu.
- Bu belge bir UI uygulaması değildir. JSON exporter mevcut kaynakta ayrı geliştirilmiştir; canlı UI, Sheets ve Pages workflowlarını değiştirmez. Test sonuçları bu planın varlığından çıkarılmaz.
- Tüm canlı kaynakların tamlığı, gerçek bütçe uzlaşımı, yeni UI, PostgreSQL ve fiziksel cihaz testleri: bu belge kapsamında `not_run`.
- Kaynak kararından türetilen ürün önerileri yukarıda “önerilen/hedef/plan” diye ayrıldı; doğrulanmamış veri ve görevler actual olarak sunulmadı.
