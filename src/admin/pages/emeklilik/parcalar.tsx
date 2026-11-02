import { useId, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type {
  AlanGorunumu, BilesimSatiri, EmeklilikEkranDeposu, EmeklilikEkrani, EmeklilikPlaniKomutlari, FormGorunumu, IhyaGorunumu, Olcu,
  OneriGorunumu, PayGorunumu, SonucGorunumu, SoruGorunumu,
} from '../../emeklilik/viewmodel';
import type { ResponsiveTableColumn } from '../../ui/ResponsiveTable';
import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/Disclosure';
import { ResponsiveTable } from '../../ui/ResponsiveTable';
import { StatusText } from '../../ui/StatusText';
import { TextField } from '../../ui/TextField';

// Emeklilik planı görünüm parçaları (MVVM'de View). Telefon temel sunumu ve geniş sunum (EmeklilikGenis.wide) aynı
// parçaları dizer. Yalnız ekran anlık görüntüsünü çizer ve ViewModel komutlarını çağırır; hesap, biçim ve doğrulama
// ViewModel'dedir. Yerel HTML + ARIA APG kalıpları (radyo grubu: fieldset + legend, oklarla gezinme tarayıcının);
// ui/ bileşenleri tek tek içe aktarılır (barrel değil). Odak çizgisini admin.css çizer ([data-focus-line]); halka yok.
// Görsel kurallar EmeklilikPage.css (yalnız --aile-* tokenları).

export interface EmeklilikSunumProps {
  ekran: EmeklilikEkrani;
  komutlar: EmeklilikPlaniKomutlari;
}

/** ViewModel deposunu React'e bağlar; aynı durumda aynı anlık görüntü (yeniden çizim yok). */
export function useEmeklilikEkrani(depo: EmeklilikEkranDeposu): EmeklilikEkrani {
  return useSyncExternalStore(depo.subscribe, depo.getSnapshot, depo.getSnapshot);
}

function Bolum({ baslik, children, className, bolum }: { baslik: string; children: ReactNode; className?: string; bolum?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={['aile-em-bolum', className].filter(Boolean).join(' ')} data-bolum={bolum}>
      <h2 id={id} className="aile-em-bolum__baslik">{baslik}</h2>
      {children}
    </section>
  );
}

/** Ölçü değeri: tutar tabular ve bölünmez (aile-tutar), sözcüklü değer doğal sarılır; ton yalnız destekler. */
function OlcuDegeri({ olcu }: { olcu: Olcu }) {
  return (
    <span className={olcu.bicim === 'tutar' ? 'aile-tutar aile-em-deger' : 'aile-em-deger aile-em-deger--metin'} data-tone={olcu.ton === 'notr' ? undefined : olcu.ton}>
      {olcu.deger}
    </span>
  );
}

function Olculer({ olculer }: { olculer: readonly Olcu[] }) {
  return (
    <dl className="aile-em-olculer">
      {olculer.map(olcu => (
        <div key={olcu.etiket} className="aile-em-olcu">
          <dt className="aile-kucuk aile-ikincil">{olcu.etiket}</dt>
          <dd>
            <OlcuDegeri olcu={olcu} />
            {olcu.not ? <span className="aile-em-olcu__not aile-kucuk aile-ikincil">{olcu.not}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * APG radyo grubu ok tuşları (yerel <input type="radio"> üzerinde): Sağ/Aşağı sonraki, Sol/Yukarı önceki seçenek, uçta
 * başa döner; odak taşınır ve seçim komutu çağrılır. Tarayıcının kendi ok davranışı yerine bu kullanılır: WebKit, okla
 * taşınan radyo odağında :focus-visible eşlemiyor ve tek alt çizgi göstergesi kayboluyordu (önizleme ölçümü). Programla
 * taşınan odak klavye etkileşiminden geldiği için her motorda :focus-visible kalır. Space/Tab tarayıcınındır.
 */
function radyoOklari(sec: (girdi: HTMLInputElement) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const yon = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!yon || event.altKey || event.ctrlKey || event.metaKey) return;
    const girdiler = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const simdiki = girdiler.indexOf(event.target as HTMLInputElement);
    if (simdiki < 0) return;
    event.preventDefault();
    const hedef = girdiler[(simdiki + yon + girdiler.length) % girdiler.length]!;
    hedef.focus();
    sec(hedef);
  };
}

// --- Öneri ------------------------------------------------------------------------------------------------------------
export function OneriBolumu({ oneri, komutlar }: { oneri: OneriGorunumu; komutlar: EmeklilikPlaniKomutlari }) {
  return (
    <Bolum baslik="Öneri" className="aile-em-oneri">
      <p className="aile-em-oneri__ad">
        <span className="aile-ikincil">{oneri.etiket}: </span>
        <strong>{oneri.secimAdi}</strong>
      </p>
      <p className="aile-em-oneri__gerekce aile-kucuk aile-ikincil">{oneri.gerekce} {oneri.saglamlik}</p>
      <div className="aile-em-oneri__eylem">
        <Button
          variant="primary"
          disabled={oneri.devreDisiNedeni !== null}
          disabledReason={oneri.devreDisiNedeni ?? undefined}
          onClick={() => komutlar.oneriyiSec()}
        >
          {oneri.eylem}
        </Button>
      </div>
    </Bolum>
  );
}

// --- Seçimler: üç bağımsız Evet/Hayır radyo grubu ----------------------------------------------------------------------
function SecimSorusu({ soru, komutlar }: { soru: SoruGorunumu; komutlar: EmeklilikPlaniKomutlari }) {
  const id = useId();
  const baslikId = `${id}-soru`;
  const aciklamaId = `${id}-aciklama`;
  return (
    <fieldset role="radiogroup" aria-labelledby={baslikId} aria-describedby={aciklamaId} className="aile-em-soru">
      <legend id={baslikId} className="aile-em-soru__baslik">{soru.soru}</legend>
      <p id={aciklamaId} className="aile-em-soru__aciklama aile-kucuk aile-ikincil">{soru.aciklama}</p>
      <div className="aile-em-segment" onKeyDown={radyoOklari(girdi => komutlar.secimDegistir(soru.anahtar, girdi.value === 'evet'))}>
        {[true, false].map(deger => (
          <label key={String(deger)} className="aile-em-segment__secenek" data-focus-line="" data-secili={soru.evet === deger || undefined}>
            <input
              type="radio"
              name={`${id}-secim`}
              value={deger ? 'evet' : 'hayir'}
              className="aile-em-segment__girdi"
              checked={soru.evet === deger}
              aria-describedby={aciklamaId}
              onChange={() => komutlar.secimDegistir(soru.anahtar, deger)}
            />
            <span>{deger ? 'Evet' : 'Hayır'}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SecimlerBolumu({ ekran, komutlar }: EmeklilikSunumProps) {
  return (
    <Bolum baslik="Seçimler" bolum="secimler" className="aile-em-secimler">
      {ekran.sorular.map(soru => <SecimSorusu key={soru.anahtar} soru={soru} komutlar={komutlar} />)}
      <p role="status" aria-label="Anlık sonuç" className="aile-em-duyuru">
        {ekran.sonuc ? ekran.sonuc.duyuru : null}
      </p>
    </Bolum>
  );
}

// --- Sonuç özeti ---------------------------------------------------------------------------------------------------------
export function SonucBolumu({ sonuc, hataOzeti }: { sonuc: SonucGorunumu; hataOzeti: string | null }) {
  return (
    <Bolum baslik="Sonuç" className="aile-em-sonuc">
      <p className="aile-kucuk aile-ikincil">Planlama ayı · {sonuc.secimAdi}</p>
      <p className="aile-em-sonuc__ay" data-testid="planlama-ayi">{sonuc.planlamaAyi}</p>
      <p className="aile-em-sonuc__alt">{[sonuc.yas, sonuc.sinirlayan].filter(Boolean).join(' · ')}</p>
      <p className="aile-em-sonuc__alt">{sonuc.erken}</p>
      {hataOzeti ? <p className="aile-em-sonuc__uyari"><StatusText label={hataOzeti} tone="uyari" /></p> : null}
      <Olculer olculer={[sonuc.odeme, sonuc.aylik, sonuc.kesinti, sonuc.donemSonunda, sonuc.gecYolEmekliOlunca, sonuc.geriKazanma]} />
      {sonuc.odemeKalemleri.length > 0 ? (
        <ul className="aile-em-kalemler" aria-label="Ödeme kalemleri">
          {sonuc.odemeKalemleri.map(kalem => (
            <li key={kalem.ad} className="aile-em-kalem">
              <span>{kalem.ad}</span>
              <span className="aile-em-deger aile-em-deger--sag">{kalem.tutar}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="aile-kucuk aile-ikincil">{sonuc.calisarak}</p>
      {sonuc.hesaplanamayanNeden ? <p className="aile-kucuk aile-ikincil">Fark hesaplanamadı: {sonuc.hesaplanamayanNeden}</p> : null}
    </Bolum>
  );
}

// --- Her seçimin payı ----------------------------------------------------------------------------------------------------
export function PaylarBolumu({ paylar }: { paylar: readonly PayGorunumu[] }) {
  return (
    <Bolum baslik="Her seçimin payı" className="aile-em-paylar">
      <p className="aile-kucuk aile-ikincil">Diğer iki seçim şimdiki hâliyle sabitken bu seçimi açmanın etkisi.</p>
      <ul className="aile-em-pay-listesi">
        {paylar.map(pay => (
          <li key={pay.anahtar} className="aile-em-pay">
            <p className="aile-em-pay__baslik">
              <span>{pay.ad}</span>
              <StatusText label={pay.durum} tone={pay.durum === 'Seçili' ? 'bilgi' : 'notr'} />
            </p>
            <p className="aile-kucuk">{pay.erken} · Ek ödeme <span className="aile-em-deger">{pay.ekOdeme}</span></p>
            <p className="aile-kucuk">
              Ortak dönem sonunda <span className="aile-em-deger" data-tone={pay.ton === 'notr' ? undefined : pay.ton}>{pay.donemSonunda}</span>
            </p>
          </li>
        ))}
      </ul>
    </Bolum>
  );
}

// --- Sekiz bileşim (telefonda akordeon, genişte tablo) ---------------------------------------------------------------------
type BilesimTabloSatiri = BilesimSatiri & { key: string };

/** Kısa değer hücresi: bölünmez (tablo dar alanda sıkışmaz, kendi kabında yatay kayar); ton yalnız destekler. */
const hucre = (deger: string, ton?: string) => (
  <span className="aile-em-deger aile-em-bolunmez" data-tone={ton && ton !== 'notr' ? ton : undefined}>{deger}</span>
);

/** Değer + (bilinmiyorsa) nedeni: hücrede değer kısa kalır, neden altında küçük ve sarılır. */
const nedenli = (deger: string, neden: string | null, ton?: string) => (
  <>
    {hucre(deger, ton)}
    {neden ? <span className="aile-em-hucre-not aile-kucuk aile-ikincil">{neden}</span> : null}
  </>
);

const BILESIM_SUTUNLARI: readonly ResponsiveTableColumn<BilesimTabloSatiri>[] = [
  { key: 'secimAdi', title: 'Seçim', minWidth: 176, m: 'title' },
  { key: 'emeklilik', title: 'Emeklilik', minWidth: 120, m: 'meta', render: satir => hucre(satir.emeklilik) },
  { key: 'yas', title: 'Yaş', minWidth: 48, align: 'right', render: satir => hucre(satir.yas) },
  { key: 'erken', title: 'Erken', minWidth: 104, render: satir => hucre(satir.erken) },
  { key: 'odeme', title: 'Ödeme', minWidth: 152, align: 'right', render: satir => nedenli(satir.odeme, satir.odemeNedeni) },
  { key: 'aylik', title: 'Aylık', minWidth: 120, align: 'right', render: satir => nedenli(satir.aylik, satir.aylikNedeni) },
  { key: 'donemSonunda', title: 'Ortak dönem farkı', minWidth: 152, align: 'right', render: satir => nedenli(satir.donemSonunda, satir.donemNedeni, satir.donemTon) },
  { key: 'geriKazanma', title: 'Geri kazanma', minWidth: 136, render: satir => hucre(satir.geriKazanma) },
];

export function BilesimlerBolumu({ ekran, komutlar }: EmeklilikSunumProps) {
  const satirlar: BilesimTabloSatiri[] = ekran.bilesimler.map(satir => ({ ...satir, key: satir.anahtar }));
  const secili = ekran.bilesimler.find(satir => satir.secili)?.anahtar;
  return (
    <Bolum baslik="Sekiz bileşim" className="aile-em-bilesimler">
      <p className="aile-kucuk aile-ikincil">{ekran.bilesimNotu}</p>
      <ResponsiveTable<BilesimTabloSatiri>
        columns={BILESIM_SUTUNLARI}
        rows={satirlar}
        caption="Sekiz bileşim"
        mobileCaption={`${satirlar.length} bileşim`}
        selectedKey={secili}
        onRowClick={satir => komutlar.bilesimSec(satir.anahtar)}
        openLabel="Bu bileşimi seç"
        headingLevel={3}
        mobileMode="accordion"
      />
    </Bolum>
  );
}

// --- Varsayımlar: gün ve tutarlar, maaş ve aylık -----------------------------------------------------------------------------
function Alan({ alan, onChange }: { alan: AlanGorunumu; onChange(metin: string): void }) {
  return (
    <TextField
      label={alan.etiket}
      value={alan.metin}
      onChange={onChange}
      help={alan.yardim}
      error={alan.hata ?? undefined}
      inputMode={alan.girisModu}
      format={alan.bicim === 'para' ? 'money' : undefined}
      suffix={alan.sonek ?? undefined}
    />
  );
}

function Onay({ etiket, aciklama, deger, onChange }: { etiket: string; aciklama: string; deger: boolean; onChange(deger: boolean): void }) {
  const id = useId();
  return (
    <div className="aile-em-onay">
      <label className="aile-em-onay__satir" data-focus-line="">
        <input type="checkbox" className="aile-em-onay__girdi" checked={deger} aria-describedby={`${id}-aciklama`} onChange={event => onChange(event.target.checked)} />
        <span>{etiket}</span>
      </label>
      <p id={`${id}-aciklama`} className="aile-kucuk aile-ikincil">{aciklama}</p>
    </div>
  );
}

function AylikModeliSecimi({ form, komutlar }: { form: FormGorunumu; komutlar: EmeklilikPlaniKomutlari }) {
  const id = useId();
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={`${id}-baslik`}
      className="aile-em-model"
      onKeyDown={radyoOklari(girdi => {
        const secenek = form.aylikModeli.secenekler.find(s => s.deger === girdi.value);
        if (secenek) komutlar.aylikModeliSec(secenek.deger);
      })}
    >
      <legend id={`${id}-baslik`} className="aile-em-soru__baslik">Aylık modeli</legend>
      {form.aylikModeli.secenekler.map(secenek => (
        <label key={secenek.deger} className="aile-em-model__secenek" data-focus-line="" data-secili={form.aylikModeli.secili === secenek.deger || undefined}>
          <input
            type="radio"
            name={`${id}-model`}
            value={secenek.deger}
            className="aile-em-model__girdi"
            checked={form.aylikModeli.secili === secenek.deger}
            aria-labelledby={`${id}-${secenek.deger}`}
            aria-describedby={`${id}-${secenek.deger}-aciklama`}
            onChange={() => komutlar.aylikModeliSec(secenek.deger)}
          />
          <span className="aile-em-model__metin">
            <span id={`${id}-${secenek.deger}`} className="aile-em-model__ad">{secenek.etiket}</span>
            <span id={`${id}-${secenek.deger}-aciklama`} className="aile-kucuk aile-ikincil">{secenek.aciklama}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function VarsayimlarBolumu({ form, komutlar }: { form: FormGorunumu; komutlar: EmeklilikPlaniKomutlari }) {
  return (
    <Bolum baslik="Varsayımlar" className="aile-em-varsayimlar">
      <p className="aile-kucuk aile-ikincil">Başlamak için bu sayıları bilmeniz gerekmez; profil ve mevzuattaki değerler hazırdır.</p>
      {form.gruplar.map(grup => (
        <Disclosure key={grup.anahtar} title={grup.baslik} className="aile-em-disclosure">
          <div className="aile-em-form">
            {grup.anahtar === 'maasVeAylik' ? <AylikModeliSecimi form={form} komutlar={komutlar} /> : null}
            {grup.alanlar.map(alan => (
              <Alan key={alan.anahtar} alan={alan} onChange={metin => komutlar.alanGuncelle(alan.anahtar, metin)} />
            ))}
            {grup.bayraklar.map(bayrak => (
              <Onay key={bayrak.anahtar} etiket={bayrak.etiket} aciklama={bayrak.aciklama} deger={bayrak.deger} onChange={deger => komutlar.bayrakDegistir(bayrak.anahtar, deger)} />
            ))}
          </div>
        </Disclosure>
      ))}
      <div className="aile-em-sifirla">
        <Button variant="quiet" onClick={() => komutlar.varsayimlariSifirla()}>Varsayımları sıfırla</Button>
      </div>
    </Bolum>
  );
}

// --- İhya karşılaştırması ------------------------------------------------------------------------------------------------------
export function IhyaBolumu({ ihya, komutlar }: { ihya: IhyaGorunumu; komutlar: EmeklilikPlaniKomutlari }) {
  return (
    <Bolum baslik="İhya karşılaştırması" className="aile-em-ihya">
      <p className="aile-kucuk aile-ikincil">
        Diğer iki seçim şimdiki hâliyle; ihya eklenen erken yol ile ihyasız bekleyen yol elle girilen net aylıklarla karşılaştırılır.
      </p>
      <dl className="aile-em-yollar">
        <div className="aile-em-yol">
          <dt className="aile-kucuk aile-ikincil">İhya eklenen yol</dt>
          <dd><strong>{ihya.ihyali.secimAdi}</strong> · {ihya.ihyali.emeklilik}<br /><span className="aile-kucuk">{ihya.ihyali.aylik}</span></dd>
        </div>
        <div className="aile-em-yol">
          <dt className="aile-kucuk aile-ikincil">İhyasız yol</dt>
          <dd><strong>{ihya.ihyasiz.secimAdi}</strong> · {ihya.ihyasiz.emeklilik}<br /><span className="aile-kucuk">{ihya.ihyasiz.aylik}</span></dd>
        </div>
      </dl>
      <p className="aile-em-ihya__erken">{ihya.erken}</p>
      <div className="aile-em-form">
        <Alan alan={ihya.aylikIhyali} onChange={metin => komutlar.ihyaAylikGuncelle('ihyali', metin)} />
        <Alan alan={ihya.aylikIhyasiz} onChange={metin => komutlar.ihyaAylikGuncelle('ihyasiz', metin)} />
        <Alan alan={ihya.sure} onChange={metin => komutlar.ihyaSuresiGuncelle(metin)} />
      </div>
      <Olculer olculer={[ihya.ekOdeme, ihya.gecYolEmekliOlunca, ihya.donemSonunda, ihya.geriKazanma]} />
      {ihya.neden ? <p className="aile-kucuk aile-ikincil">Fark hesaplanamadı: {ihya.neden}</p> : null}
      <p className="aile-kucuk aile-ikincil">Faiz, enflasyon ve sonraki zamlar modellenmez; tutarlar bugünkü parayla sabit TL'dir.</p>
    </Bolum>
  );
}
