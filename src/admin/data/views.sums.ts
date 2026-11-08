// Toplama sahipliği metinleri (saf TS; yalnız sabitler). views.ts katalogundan ayrı tutulur: telefon ilk rotası (Genel)
// yalnız toplamın neden yazılmadığını söyler ve katalog kodunu indirmez.
//
// Sözlükteki aggregation.sum_measures tek başına toplama izni vermez. Nesildeki pivot tanımının ownership_rule'u:
// "Only an explicit leaf-row ownership mapping may enable summation; source subtotals … cannot be combined". Sahiplik
// tür düzeyinde değil satır düzeyindedir: budget_observation, Plan ve Gerçekleşen sekmelerinde ay başlığından sonra gelen
// ve sayı taşıyan HER satırdır (data-platform/normalize.mjs). Yaprak gider kalemleri, gelir satırları, ara toplamlar
// ("Faturalar toplamı"), genel toplamlar ("Toplam gelir", "Toplam ödemeler", "Net birikim") ve adet/miktar satırları
// (birimi olmayan hücre; actuals.observationMoney TRY sayar) aynı türdedir; tür düzeyinde bir toplam bunların hepsini tek
// Planlanan/Gerçekleşen sayısında birleştirir. Nesilde satır düzeyinde yaprak sahipliği haritası yok: bu yüzden HİÇBİR tür
// için toplam ölçüsü üretilmez (views.pivotMeasures yalnız sayım verir); sayfalar toplam yerine TOTAL_UNAVAILABLE_TEXT ve
// gerekçeyi (views.sumUnavailableReason; bütçe gözlemleri için BUDGET_SUM_UNAVAILABLE_REASON) yazar. Açık bir yaprak-satır haritası nesle girdiğinde toplam ölçüsü views.ts'te, yalnız
// o haritanın yaprak gider satırlarını kapsayacak biçimde tanımlanır.

/** Toplam yerine yazılan ad (sayfalarda hücre, özet ve CSV değeri). */
export const TOTAL_UNAVAILABLE_TEXT = 'Toplam kullanılamaz';

/** Bütçe gözlemlerinin toplamı neden yazılmaz (views.sumUnavailableReason('budget_observation') ile aynı metin). */
export const BUDGET_SUM_UNAVAILABLE_REASON = `${TOTAL_UNAVAILABLE_TEXT}: bütçe gözlemlerinin satır düzeyinde yaprak sahipliği haritası yok; gelir, ara toplam ("… toplamı"), genel toplam ("Toplam …") ve adet satırları gider kalemlerinden ayrılamıyor.`;
