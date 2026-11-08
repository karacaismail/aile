// Tek girişli önbellek: bağımlılıklar (başvuru eşitliğiyle) değişmedikçe son başarılı sonucu verir. Durum değişmez
// nesnelerle tutulduğundan (her komut yeni Secim/Varsayimlar üretir) başvuru eşitliği yeterlidir. Hata atan hesap
// önbelleğe alınmaz: planlayıcı düzelince sonraki komut yeniden dener.
export class Hatirlayici<T> {
  private bagimliliklar: readonly unknown[] | null = null;
  private deger: T | undefined;

  getir(bagimliliklar: readonly unknown[], hesapla: () => T): T {
    const onceki = this.bagimliliklar;
    if (onceki && onceki.length === bagimliliklar.length && onceki.every((d, i) => Object.is(d, bagimliliklar[i]))) return this.deger as T;
    const deger = hesapla();
    this.bagimliliklar = [...bagimliliklar];
    this.deger = deger;
    return deger;
  }

  temizle(): void {
    this.bagimliliklar = null;
    this.deger = undefined;
  }
}
