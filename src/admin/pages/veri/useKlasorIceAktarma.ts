// Klasörden içe aktarma akışı (React durumu). Yöntem açılışta özellik algılamayla bir kez seçilir (klasor.ts):
//   secici → kullanıcı hareketi içinde showDirectoryPicker({ id, mode: 'read' }) → adaylar
//   girdi  → gizli <input type="file" webkitdirectory> tıklanır → change → dosya ağacı → adaylar
//   yok    → düğme devre dışı (neden sayfada yazılı)
// Aday yoksa "Hata: …" (neden + çözüm), tek aday doğrudan içe aktarılır, birden çoksa "Nesil seçin" açılır.
// İptal ya da hata mevcut nesli değiştirmez; kaynak yalnız seçilen nesil kesinleşince değişir.
import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { dizinden, dosyalardanDizin, klasorYontemi, nesilAdaylari, nesliKaynakYap, type DizinTutamagi, type KlasorYontemi, type NesilAdayi } from './klasor';

/** bos: bekliyor · okunuyor: klasördeki manifestler okunuyor · secim: "Nesil seçin" açık. */
export type IceAktarmaAsamasi = 'bos' | 'okunuyor' | 'secim';

export const IPTAL_ILETISI = 'Hata: Klasör seçimi iptal edildi. Nesli içe aktarmak için yeniden deneyin ve nesil klasörünü seçin.';
export const SECILEMEDI_ILETISI = 'Hata: Klasör seçilemedi; tarayıcı klasörü okumaya izin vermedi. Yeniden deneyin.';
export const NESIL_YOK_ILETISI = 'Hata: Seçilen klasörde nesil yok (manifest.json bulunamadı). Nesil klasörünü ya da onu içeren klasörü seçin.';
export const OKUNAMADI_ILETISI = 'Hata: Seçilen klasör okunamadı. Klasöre erişimi denetleyip yeniden deneyin.';

export interface KlasorIceAktarma {
  yontem: KlasorYontemi;
  asama: IceAktarmaAsamasi;
  /** Son taramanın adayları (seçim kapanırken de korunur). */
  adaylar: readonly NesilAdayi[];
  /** Son taramada okunamayan manifestler. */
  atlanan: readonly string[];
  /** "Hata: …" ya da null. */
  hata: string | null;
  /** Birincil eylem: seçiciyi ya da gizli girdiyi açar. Kullanıcı hareketi içinde çağrılmalı. */
  baslat(): void;
  /** Gizli girdinin ref'i (webkitdirectory özniteliğini yazar). */
  girdiRef(node: HTMLInputElement | null): void;
  dosyalarSecildi(event: ChangeEvent<HTMLInputElement>): void;
  sec(aday: NesilAdayi): void;
  vazgec(): void;
}

const hataMetni = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return text.startsWith('Hata: ') ? text : `Hata: ${text}`;
};

export function useKlasorIceAktarma(pickDirectory: () => Promise<boolean>): KlasorIceAktarma {
  const [yontem] = useState<KlasorYontemi>(() => klasorYontemi());
  const [asama, setAsama] = useState<IceAktarmaAsamasi>('bos');
  const [tarama, setTarama] = useState<{ adaylar: readonly NesilAdayi[]; atlanan: readonly string[] }>({ adaylar: [], atlanan: [] });
  const [hata, setHata] = useState<string | null>(null);
  const girdi = useRef<HTMLInputElement | null>(null);

  const girdiRef = useCallback((node: HTMLInputElement | null) => {
    girdi.current = node;
    // React bu standart dışı özniteliği tanımaz; tarayıcı yansıtması için DOM'a doğrudan yazılır.
    node?.setAttribute('webkitdirectory', '');
  }, []);

  const uygula = useCallback(async (aday: NesilAdayi) => {
    setAsama('bos');
    try {
      await nesliKaynakYap(pickDirectory, aday.dizin);
    } catch (error) {
      setHata(hataMetni(error));
    }
  }, [pickDirectory]);

  const incele = useCallback(async (kok: DizinTutamagi | null) => {
    if (!kok) {
      setHata(NESIL_YOK_ILETISI);
      return;
    }
    setAsama('okunuyor');
    try {
      const { adaylar, atlanan } = await nesilAdaylari(kok);
      setTarama({ adaylar, atlanan });
      if (adaylar.length === 0) {
        setAsama('bos');
        setHata(atlanan.length > 0 ? `Hata: Seçilen klasördeki nesil okunamadı (${atlanan.join('; ')}). Doğrulanmış bir nesil klasörü seçin.` : NESIL_YOK_ILETISI);
        return;
      }
      if (adaylar.length === 1) {
        await uygula(adaylar[0]!);
        return;
      }
      setAsama('secim');
    } catch {
      setAsama('bos');
      setHata(OKUNAMADI_ILETISI);
    }
  }, [uygula]);

  const baslat = useCallback(() => {
    setHata(null);
    if (yontem === 'girdi') {
      girdi.current?.click();
      return;
    }
    if (yontem !== 'secici') return;
    const picker = (window as unknown as { showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<unknown> }).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setHata(SECILEMEDI_ILETISI);
      return;
    }
    const reddedildi = (error: unknown) => setHata(error instanceof DOMException && error.name === 'AbortError' ? IPTAL_ILETISI : SECILEMEDI_ILETISI);
    // Seçici kullanıcı hareketi içinde, eşzamanlı çağrılır (geçici etkinleştirme kuralı).
    let secim: Promise<unknown>;
    try {
      secim = Promise.resolve(picker.call(window, { id: 'aile-generation', mode: 'read' }));
    } catch (error) {
      reddedildi(error);
      return;
    }
    void secim.then(
      handle => {
        let kok: DizinTutamagi;
        try {
          kok = dizinden(handle);
        } catch {
          setHata(SECILEMEDI_ILETISI);
          return;
        }
        void incele(kok);
      },
      reddedildi,
    );
  }, [yontem, incele]);

  const dosyalarSecildi = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files ? Array.from(input.files) : [];
    // Aynı klasör yeniden seçilebilsin (değer aynı kalırsa change gelmez).
    input.value = '';
    if (files.length === 0) return;
    setHata(null);
    void incele(dosyalardanDizin(files));
  }, [incele]);

  const sec = useCallback((aday: NesilAdayi) => {
    void uygula(aday);
  }, [uygula]);
  const vazgec = useCallback(() => setAsama('bos'), []);

  return { yontem, asama, adaylar: tarama.adaylar, atlanan: tarama.atlanan, hata, baslat, girdiRef, dosyalarSecildi, sec, vazgec };
}
