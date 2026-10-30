# Bütçe ve finansman tüketici sözleşmesi

Pano, Plan ve Gerçekleşen tutarlarını native aylık hesapla birlikte doğrular. Güncel dal Plan'ın kopyası değildir; kaynak koşumları ayrı tutulur. Web faiz veya banka ödeme motorunu tekrar çalıştırmaz.

## Kaynak güncelliği

`_Finans aylık!A1:A7`, `headers=0` ile yedi string olarak okunur:

1. `finance-bridge-v1`
2. Plan kaynak kontrolü: `TRUE` / `FALSE`
3. Güncel kaynak kontrolü: `TRUE` / `FALSE`
4. İki dalı ve kaynak sözleşmesini kapsayan 64 haneli küçük harfli SHA-256 üretim parmak izi
5. Kullanıcıya gösterilen hesap durumu
6. Kullanıcıya gösterilen kapsam ve koşullar
7. Aylık yardımcı tablonun satır sayısı; 1–26 arası sayı stringi

Bu metadata bütçe okumalarından önce ve sonra okunur. İki kontrol de `TRUE` olmalı; yedi alanın tamamı değişmeden kalmalıdır. İlk kontrol tamamlandıktan sonra Plan, Pano, Gerçekleşen, Kasa, Arızi Giderler ve finansman girişleri tek paralel fazda okunur; ardından son kontrol yapılır. İlk metadata ile tutarlar birlikte istenmez: ilk kontrol yeni üretimi, ondan önce gelen tutar eski üretimi temsil edebilir. Üç ağ fazı bu yarışmayı kapatır. Toplam sekiz istek `cache: no-store`, `credentials: omit` kullanır; finansman günlük dökümü bu rota için indirilmez. Eski bütçe şemasına geri uyumda Pano tekrar istenmez; üç farklı eski aralık ayrıca okunur. Bu dalda en fazla üç modern aralık isteği kullanılmadan kalır (toplam 11 istek).

Geçersiz kontrol, değişen sürüm/koşul, eksik sayı veya tutarsız kaynak `BudgetIntegrityError` üretir. `useBudget` eski veriyi ve son başarılı okuma zamanını kaldırır. Pano, alım planı ve araç etkisi eski bütçe rakamlarını kullanamaz. Geçici bağlantı hatasında son başarılı veri, hata ve eski okuma zamanı açıkça gösterilerek korunabilir. Yanlış kaynak ile bağlantı kesintisi aynı durum değildir.

## Aylık anlamlar

Pano B50:M63: ay, kaynak, plan/güncel gelir, brüt ödeme, birikim alımı, aylık net nakit hareketi ve ay sonu harcanabilir nakit çiftleridir. Kasa C:P satır çiftleri 9/25, 15/31, 16/32, 18/34, 19/35 ile karşılaştırılır. Plan/Gerçekleşen gelir, brüt nakit çıkışı, aylık net hareket ve ay sonu nakit satırları etiketle bulunur; satır kayması tolere edilir. Parasal eşitlik toleransı `0.000001` TL'dir; bir kuruş fark kabul edilmez. Sunum en fazla iki ondalık basamak kullanır.

`balance` harcanabilir ay sonu nakittir; borç düşülmüş varlık değildir. `free` aylık nakit hareketidir; rezerv ve finansman girişlerini de içerir. Kart/KMH borcu ile fon eksiği ayrı Finansman alanlarıdır. Birikim grafiği birikim alımlarına ayrılan kümülatif TL'yi gösterir; kalan rezerv, piyasa değeri veya toplam varlık değildir.

## Araç ödeme kapasitesi

`_Finans aylık!A10:C36`, `headers=1`: `Ay`, `Plan finansman ve iç aktarım`, `Güncel finansman ve iç aktarım`. Aylar `YYYY-MM`, tutarlar sonlu ve negatif olmayan sayıdır. Metadata satır sayısı, sıralama, tekillik ve bütçedeki her ayın varlığı doğrulanır.

Native finansman/iç aktarım toplamı dış kredi + KMH kullanımı + rezerv aktarımı + kullanıcı birikim çekişidir. Bunlar gelir sayılmaz. Web yalnız `selfFundedCashFlow = free − finansman/iç aktarım` farkını alır. KMH anapara kapaması ve ödenen maliyetler giderde kalır. Araç taksiti, işletme gideri ve ilgili peşin tutar bu akıştan düşülür. Ayrım bulunmuyorsa kapasite bilinmiyor olarak kalır; eski `free` değerine veya sıfıra dönülmez. Pozitif aylık fark kredi onayı veya vade boyunca sürdürülebilirlik garantisi değildir.

## Doğrulama

Sentetik kaynaklar: `src/dashboard/bridgeFixtures.ts`; kişisel rakam veya kaynak kimliği içermez. `src/dashboard/fetchBudget.test.ts` iki kontrolü, okuma sırasında değişen üretimi, eksik/bozuk aktarım verisini ve kapasite ayrımını doğrular. `useBudget.test.tsx` geçersiz kaynağın eski rakamları kaldırmasını ve ağ hatasının ayrı davranışını kapsar. `VehiclePage.test.tsx` borçla oluşan pozitif nakdin ödeme kapasitesi sayılmadığını denetler. Bütçe ve araç tarayıcı testleri aynı davranışı kullanıcı ekranında sınar.
