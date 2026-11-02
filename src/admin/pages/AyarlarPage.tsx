import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { sheetId as envBudgetSheetId } from '../../dashboard/data';
import { getApiUrl, getAppKey, setApiUrl, setAppKey } from '../../sync/config';
import { BUDGET_TIME_ZONE, lastGoodBudget, persistentCacheAllowed, useChangeSet, useCollection, useGeneration, type BatchConversion, type GenerationState, type OverlayRecord, type SettingRecord } from '../data';
import { reloadPage as tarayiciyiYenile } from '../adaptive/reload';
import { useDevice } from '../device';
import type { DataStatusProps, DataStatusState, PageHeaderSummary, Tone } from '../shell/contracts';
import { settingsLink } from '../shell/navigation';
import { PageHeader } from '../shell/PageHeader';
import { Button } from '../ui/Button';
import { DataStatus } from '../ui/DataStatus';
import { Dialog } from '../ui/Dialog';
import { Disclosure } from '../ui/Disclosure';
import { ErrorState } from '../ui/ErrorState';
import { FormFooter } from '../ui/FormFooter';
import { LoadingShell } from '../ui/LoadingShell';
import { StatusText } from '../ui/StatusText';
import { TextField } from '../ui/TextField';
import { changeSetExportText, exportFileName, saveJsonFile } from './ayarlar/disaAktar';
import { createPartitionCacheControl, type PartitionCacheControl } from './ayarlar/onbellek';
import { createDeviceDataControl, type DeviceDataControl, type DeviceWipeResult } from './ayarlar/cihazVerisi';
import './AyarlarPage.css';

// Tasarım: bundle.js › Pages.Ayarlar (Row: başlık + yardım solda, alanlar sağda; dar ekranda alt alta; altta FormFooter),
// README.md "Sayfa iskeleti" 1–2 (başlık + özet ≤3), ekranlar.md SayfaAyarlar / SayfaAyarlarDar. Yerleşim AyarlarPage.css.
// Veri: nesil (useGeneration), ayar koleksiyonu (useCollection('settings'), salt okunur: panel Sheets'e yazmaz, bu yüzden
// tasarımdaki Aile/Biçimler giriş alanları burada okunan değer + "Henüz yok" olarak yazılır), canlı Apps Script adresi ve
// anahtarı (src/sync/config.ts → localStorage; kayıtlı anahtar hiçbir zaman DOM'a yazılmaz: alan boş başlar, durum
// "Anahtar kayıtlı"), bütçe Sheet kimliği durumu (env, kimlik yazılmaz), yerel değişiklik kümesi (bekleyen op + toBatch
// JSON önizlemesi + JSON indirme; gizli değer yok; gönderme yok), nesil parça önbelleği (sayım + onaylı temizleme;
// bekleyen değişiklik, adres ve anahtar korunur). Üye koleksiyonu nesilde yok → "Kaynakta üye kaydı yok". Eksik bilgi
// adıyla; hata "Hata: …"; eski veri "Eski veri"; işlevsiz düğme yok; native select yok. Onay telefonda alt sayfa (Dialog).
// Hazır sinyali (e2e openAdmin ve f05 veri durumları ile aynı): meşgul olan yalnız yüklenen bölümdür — ayar iskeleti
// (LoadingShell aria-busy) ve nesil okunurken (idle/checking) "Nesil kaynağı" satırı; sayfa kökü hiçbir zaman meşgul
// değildir. Ayar koleksiyonu yalnız nesil manifesti varken istenir: manifest okunamazsa tek ErrorState nesil nedenini
// yazar ve "Yeniden dene" manifest gelince koleksiyonu ilk kez ister (önceden istenip hata alan koleksiyon yenilemede
// toparlanmıyordu).
// Canlı Sheets durumu: kimlik tanımlı mı + son başarılı canlı okuma zamanı (yerel son iyi okuma; Ayarlar ağa çıkmaz).
// Gizlilik: Apps Script adresi/anahtarı ana uygulamayla ortaktır (yardım metni bunu söyler). "Cihazdaki panel verisi"
// ortak cihaz için onaylı tam silme sunar (nesil önbelleği, canlı bütçe son okuması, değişiklik kümesi; adres/anahtar
// ayrı seçenek); silme bellekteki kopyalar da gitsin diye sayfayı yeniden yükler, sonucu sekme oturumunda bir kez
// duyurur. Kalıcı önbellek üretimde varsayılan kapalıdır (store.ts persistentCacheAllowed); Önbellek satırı bunu söyler.
// Geniş-özel modül yok: masaüstü yalnız satır düzenini (başlık solda, alanlar sağda) CSS ile alır.

export interface AyarlarPageProps {
  /** Bütçe e-tablosu kimliği (varsayılan VITE_BUDGET_SHEET_ID). Sayfa kimliği yazmaz, yalnız tanımlı olup olmadığını söyler. */
  budgetSheetId?: string;
  /** Nesil parça önbelleği denetimi (varsayılan: deponun IndexedDB önbelleği). */
  cacheControl?: PartitionCacheControl;
  /** Dışa aktarma dosyasını kaydeder (varsayılan: tarayıcı indirmesi). */
  saveFile?: (name: string, text: string) => void;
  /** Saat: dosya adı ve exported_at (varsayılan: şimdi). */
  now?: () => Date;
  /** Son başarılı canlı bütçe okumasının zamanı (ISO) ya da null; ağa çıkmaz (varsayılan: yerel son iyi okuma). */
  liveLastRead?: () => Promise<string | null>;
  /** Bu cihazdaki tüm panel verisini silme (varsayılan: tarayıcı depoları; ayarlar/cihazVerisi.ts). */
  deviceData?: DeviceDataControl;
  /** Silmeden sonra sayfayı yeniden yükler: bellekteki kopyalar da gider (varsayılan: window.location.reload). */
  reloadPage?: () => void;
  /** Nesil parçaları bu derlemede bu tarayıcıda kalıcı saklanıyor mu (varsayılan: persistentCacheAllowed()). */
  persistentCache?: boolean;
}

const HENUZ_YOK = 'Henüz yok';
const BILINMIYOR = 'Bilinmiyor';
const OKUNUYOR = 'Okunuyor…';
const NESIL_OKUNAMADI = 'Hata: nesil manifesti okunamadı.';
const AYAR_KAYDI_YOK = 'Kaynakta ayar kaydı yok.';
const UYE_KAYDI_YOK = 'Kaynakta üye kaydı yok.';
const TARIH_BICIMI = 'gg.aa.yyyy (28.10.2026)';
const SAKLAMA_NOTU = 'Yalnız bu tarayıcıda saklanır; e-tabloya ve nesle yazılmaz.';
const APPS_SCRIPT_ORNEK = 'https://script.google.com/macros/s/…/exec';
/** src/sync/config.ts isApiConfigured ile aynı biçim; taslak değer kaydedilmeden önce burada denetlenir. */
const APPS_SCRIPT_BICIMI = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/;
const PARA_BIRIMI_ADI: Record<string, string> = { TRY: 'Türk lirası (₺)' };
const ANAHTAR_NOTU = 'Kayıtlı anahtar gösterilmez; değiştirmek için yenisini yazın. Boş bırakılırsa kayıtlı anahtar korunur.';
const ESKI_VERI = 'Eski veri: son başarılı nesil gösteriliyor; kaynak yenilenemedi';
const ONBELLEK_YOK = 'Bu tarayıcıda önbellek yok; temizlenecek bir şey yok.';
const ONAY_BASLIGI = 'Önbellek temizlensin mi?';
const CANLI_OKUMA_NOTU = 'Bu tarayıcıda; Bütçe sayfası açılınca okunur. Ayarlar e-tabloya istek göndermez.';
const CANLI_BAGLANTI_YARDIMI = 'Uygulama kayıtları bu Apps Script adresinden canlı okunur. Adres ve anahtar ana uygulamayla ortaktır: burada değiştirilirse ana uygulamanın kayıt yazdığı adres ve anahtar da değişir. Yalnız bu tarayıcıda saklanır.';
const ONBELLEK_YARDIMI = 'Nesil parçaları daha hızlı açılış için bu tarayıcıda (IndexedDB) saklanır. Temizlemek bekleyen değişiklikleri, adresi ve anahtarı silmez.';
const ONBELLEK_KAPALI_YARDIMI = 'Bu derlemede nesil parçaları bu tarayıcıda kalıcı saklanmaz; burada yalnız önceki sürümlerden kalan parçalar sayılır. Temizlemek bekleyen değişiklikleri, adresi ve anahtarı silmez.';
const CIHAZ_YARDIMI = 'Ortak bir cihazda paneli bırakmadan önce bu tarayıcıdaki panel verisini silin: nesil önbelleği, son canlı bütçe okuması ve bekleyen değişiklikler. E-tabloya ve nesil klasörüne dokunulmaz.';
const CIHAZ_DUGMESI = 'Bu cihazdaki tüm panel verisini sil';
const CIHAZ_ONAY_BASLIGI = 'Bu cihazdaki tüm panel verisi silinsin mi?';
const BAGLANTI_SECENEGI = 'Apps Script adresini ve uygulama anahtarını da sil';
/** Silme sonucu yeniden yüklenen sayfada bir kez duyurulur (sekme oturumu; sayı ve metin, aile verisi yok). */
const SILME_SONUCU_ANAHTARI = 'aile:admin:cihaz-silindi';
const sayi = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const simdi = () => new Date();
/** Yerel son iyi canlı okuma (IndexedDB); Google'a istek yok. */
const yerelSonCanliOkuma = async () => (await lastGoodBudget())?.readAt ?? null;
const ZAMAN = new Intl.DateTimeFormat('tr-TR', {
  timeZone: BUDGET_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** "28.10.2026 14:32" (İstanbul); geçersiz ISO null. */
function zaman(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : ZAMAN.format(at).replace(',', '');
}

let varsayilanOnbellek: PartitionCacheControl | undefined;
/** Tek denetim nesnesi (IndexedDB bağlantısı tembel açılır). */
const varsayilanOnbellekDenetimi = () => (varsayilanOnbellek ??= createPartitionCacheControl());
let varsayilanCihaz: DeviceDataControl | undefined;
const varsayilanCihazDenetimi = () => (varsayilanCihaz ??= createDeviceDataControl());

/** sessionStorage erişimi hata atabilir (Safari gizli kip, engellenmiş site verisi); o zaman sonuç yalnız bu sekmede. */
function oturumDeposu(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function hataAyrintisi(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

const DURUM: Record<GenerationState, DataStatusState> = { idle: 'checking', checking: 'checking', ready: 'fresh', stale: 'stale', error: 'error' };

export const isValidApiUrl = (url: string) => APPS_SCRIPT_BICIMI.test(url.trim());

/** Nesil kaynağı insan diliyle: geliştirme sunucusu / seçilen klasör / sentetik fixture. */
export function kaynakEtiketi(source: { kind: string; label: string }): string {
  switch (source.kind) {
    case 'http': return `Geliştirme sunucusu (${source.label})`;
    case 'directory': return `Klasör: ${source.label}`;
    default: return `Sentetik nesil (${source.label})`;
  }
}

function ayarDegeri(rows: readonly SettingRecord[], anahtar: string): string | null {
  const record = rows.find((row) => row.kind === 'setting' && row.attributes?.anahtar === anahtar);
  const deger = record?.attributes?.deger;
  return typeof deger === 'string' && deger.trim() ? deger.trim() : typeof deger === 'number' ? String(deger) : null;
}

// --- Satır düzeni -----------------------------------------------------------------------------------------
interface RowProps { title: string; help?: string; /** Satırın verisi okunurken aria-busy. */ busy?: boolean; children: ReactNode }

/** Tasarım Row: h2 + yardım solda, alanlar sağda; data-narrow'da alt alta. Kenar yalnız alt cizgi ayırıcı. */
function Row({ title, help, busy = false, children }: RowProps) {
  const id = useId();
  return (
    <section className="aile-ayarlar__satir" aria-labelledby={id} aria-busy={busy ? true : undefined}>
      <div className="aile-ayarlar__baslik">
        <h2 id={id} className="aile-ayarlar__h2">{title}</h2>
        {help ? <p className="aile-ayarlar__yardim aile-kucuk aile-ikincil">{help}</p> : null}
      </div>
      <div className="aile-ayarlar__alanlar">{children}</div>
    </section>
  );
}

/** Salt okunur ayar değeri: etiket üstte, değer altta (dt/dd). Eksik değer adıyla yazılır. */
function Deger({ label, value, missing }: { label: string; value: string | null; missing?: string }) {
  return (
    <div className="aile-ayarlar__deger">
      <dt className="aile-ayarlar__etiket aile-kucuk aile-ikincil">{label}</dt>
      <dd className={value === null ? 'aile-ayarlar__dd aile-ikincil' : 'aile-ayarlar__dd'}>{value ?? missing ?? HENUZ_YOK}</dd>
    </div>
  );
}

// --- Aile ve Biçimler (ayar koleksiyonu, salt okunur) ----------------------------------------------------------
type AyarDurumu =
  | { durum: 'okunuyor' }
  | { durum: 'hata'; title: string; message: string }
  | { durum: 'tamam'; rows: readonly SettingRecord[] };

interface AyarSatirlariProps { durum: AyarDurumu; phone: boolean; onRetry(): void }

/** İki satır tek durumdan çizilir: okunuyor → iskelet; hata → tek ErrorState (Aile), Biçimler'de "Bilinmiyor". */
function AyarSatirlari({ durum, phone, onRetry }: AyarSatirlariProps) {
  const rows = durum.durum === 'tamam' ? durum.rows : [];
  const bos = durum.durum === 'tamam' && !rows.some((row) => row.kind === 'setting');
  const paraKodu = ayarDegeri(rows, 'para_birimi');
  const iskelet = <LoadingShell rows={2} narrow={phone} label="Ayarlar okunuyor" />;
  const bosMetin = <p className="aile-ikincil">{AYAR_KAYDI_YOK}</p>;
  return (
    <>
      <Row title="Aile" help="Üst barda ve raporlarda görünür. E-tablodan (app_ayarlar) okunur; panel bu alanları yazmaz.">
        {durum.durum === 'okunuyor' ? iskelet
          : durum.durum === 'hata' ? <ErrorState title={durum.title} message={durum.message} onRetry={onRetry} />
            : bos ? bosMetin : (
              <dl className="aile-ayarlar__liste">
                <Deger label="Aile adı" value={ayarDegeri(rows, 'aile_adi')} />
                <Deger label="Ay başlangıç günü" value={ayarDegeri(rows, 'ay_baslangic_gunu')} />
              </dl>
            )}
      </Row>

      <Row title="Biçimler" help="Tüm tutar ve tarihler bu biçimle yazılır.">
        {durum.durum === 'okunuyor' ? iskelet : bos ? bosMetin : (
          <dl className="aile-ayarlar__liste">
            <Deger
              label="Para birimi"
              value={paraKodu ? PARA_BIRIMI_ADI[paraKodu] ?? paraKodu : null}
              missing={durum.durum === 'hata' ? BILINMIYOR : HENUZ_YOK}
            />
            <Deger label="Tarih biçimi" value={TARIH_BICIMI} />
          </dl>
        )}
      </Row>
    </>
  );
}

/** Ayar koleksiyonunu ister; yalnız nesil manifesti varken bağlanır. */
function AyarKoleksiyonu({ phone, onRetry }: Omit<AyarSatirlariProps, 'durum'>) {
  const settings = useCollection('settings');
  const durum: AyarDurumu = settings.loading
    ? { durum: 'okunuyor' }
    : settings.error !== null
      ? { durum: 'hata', title: 'Ayarlar okunamadı', message: settings.error }
      : { durum: 'tamam', rows: settings.rows };
  return <AyarSatirlari durum={durum} phone={phone} onRetry={onRetry} />;
}

// --- Dışa aktarma önizlemesi + indirme (yalnız açıkken bağlanır; yedi kalem koleksiyonu o zaman okunur) ---------
interface OnizlemeProps {
  toBatch(records: readonly OverlayRecord[]): BatchConversion | null;
  generationId: string | null;
  pending: number;
  saveFile(name: string, text: string): void;
  now(): Date;
}

function DisaAktarmaOnizlemesi({ toBatch, generationId, pending, saveFile, now }: OnizlemeProps) {
  const needs = useCollection('purchase_needs');
  const lighting = useCollection('lighting_specs');
  const work = useCollection('work_orders');
  const layout = useCollection('layout_items');
  const inspections = useCollection('inspections');
  const scenes = useCollection('automation_scenes');
  const milestones = useCollection('milestones');
  const parts = [needs, lighting, work, layout, inspections, scenes, milestones];
  const loading = parts.some((part) => part.loading);
  const error = parts.find((part) => part.error !== null)?.error ?? null;
  const records = useMemo<readonly OverlayRecord[]>(
    () => [...needs.rows, ...lighting.rows, ...work.rows, ...layout.rows, ...inspections.rows, ...scenes.rows, ...milestones.rows],
    [needs.rows, lighting.rows, work.rows, layout.rows, inspections.rows, scenes.rows, milestones.rows],
  );
  const batch = useMemo(() => (loading ? null : toBatch(records)), [loading, toBatch, records]);
  const onizleme = useMemo(() => (batch ? changeSetExportText({ generationId, pending, batch }) : null), [batch, generationId, pending]);
  const [indirilen, setIndirilen] = useState<string | null>(null);

  if (error) return <p className="aile-ayarlar__hata">{error}</p>;
  if (loading || !batch || onizleme === null) return <LoadingShell rows={2} label="Kayıtlar okunuyor" />;
  const indir = () => {
    const at = now();
    const name = exportFileName(generationId, at);
    // Dosya önizlemeyle aynı alanları taşır (+ exported_at); adres/anahtar hiçbir yoldan girmez.
    saveFile(name, changeSetExportText({ generationId, pending, batch, exportedAt: at }));
    setIndirilen(name);
  };
  return (
    <div className="aile-ayarlar__onizleme">
      <p className="aile-kucuk aile-ikincil">{`${batch.ops.length} işlem gönderilebilir · ${batch.skipped.length} atlandı · gönderme yok`}</p>
      <pre className="aile-ayarlar__json" aria-label="Dışa aktarma JSON" tabIndex={0} data-focus-line="">{onizleme}</pre>
      <div className="aile-ayarlar__eylem">
        <Button variant="secondary" icon="download" onClick={indir}>Değişiklik kümesini indir</Button>
      </div>
      <p className="aile-ayarlar__dosya aile-kucuk aile-ikincil" role="status">{indirilen ? `İndirme başlatıldı: ${indirilen}` : ''}</p>
    </div>
  );
}

// --- Son canlı okuma (yerel; ağ yok) -----------------------------------------------------------------------------
type CanliOkuma = { durum: 'okunuyor' } | { durum: 'tamam'; at: string | null } | { durum: 'bilinmiyor' };

function SonCanliOkuma({ read }: { read(): Promise<string | null> }) {
  const [okuma, setOkuma] = useState<CanliOkuma>({ durum: 'okunuyor' });
  useEffect(() => {
    let active = true;
    read().then(
      (at) => {
        if (active) setOkuma({ durum: 'tamam', at });
      },
      () => {
        if (active) setOkuma({ durum: 'bilinmiyor' });
      },
    );
    return () => {
      active = false;
    };
  }, [read]);
  const deger = okuma.durum === 'tamam' && okuma.at ? zaman(okuma.at) : null;
  const eksik = okuma.durum === 'okunuyor' ? OKUNUYOR : okuma.durum === 'bilinmiyor' || okuma.at ? BILINMIYOR : HENUZ_YOK;
  return (
    <dl className="aile-ayarlar__liste">
      <Deger label="Son canlı okuma" value={deger} missing={eksik} />
    </dl>
  );
}

// --- Önbellek (sayım + onaylı temizleme) --------------------------------------------------------------------------
type Sayim = { durum: 'okunuyor' } | { durum: 'tamam'; n: number } | { durum: 'bilinmiyor' };
interface Sonuc { tone: 'olumlu' | 'hata'; text: string }

function korunurMetni(pending: number | null): string {
  if (pending === null) return 'Korunur: bekleyen değişiklikler, Apps Script adresi ve uygulama anahtarı.';
  if (pending === 0) return 'Korunur: Apps Script adresi ve uygulama anahtarı. Bekleyen değişiklik yok.';
  return `Korunur: ${sayi(pending)} bekleyen değişiklik, Apps Script adresi ve uygulama anahtarı.`;
}

function korunduMetni(pending: number | null): string {
  if (pending === null) return 'Bekleyen değişikliklere dokunulmadı.';
  if (pending === 0) return 'Bekleyen değişiklik yoktu.';
  return `Bekleyen ${sayi(pending)} değişiklik korundu.`;
}

interface OnbellekProps {
  cache: PartitionCacheControl;
  /** Bekleyen değişiklik sayısı; küme hazır değilse null. */
  pending: number | null;
  phone: boolean;
  /** Değişince yeniden sayılır (yeni okuma önbelleğe parça yazmış olabilir). */
  recountKey: string;
}

function Onbellek({ cache, pending, phone, recountKey }: OnbellekProps) {
  const [sayim, setSayim] = useState<Sayim>({ durum: 'okunuyor' });
  const [onay, setOnay] = useState(false);
  const [calisiyor, setCalisiyor] = useState(false);
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const bagli = useRef(true);
  useEffect(() => {
    bagli.current = true;
    return () => {
      bagli.current = false;
    };
  }, []);

  const say = useCallback(async () => {
    if (!cache.available) return;
    try {
      const n = await cache.count();
      if (bagli.current) setSayim({ durum: 'tamam', n });
    } catch {
      if (bagli.current) setSayim({ durum: 'bilinmiyor' });
    }
  }, [cache]);
  useEffect(() => {
    void say();
  }, [say, recountKey]);

  const ac = () => {
    setOnay(true);
    void say();
  };
  const kapat = () => {
    if (!calisiyor) setOnay(false);
  };
  const onayla = async () => {
    if (calisiyor) return;
    setCalisiyor(true);
    try {
      const n = await cache.clear();
      if (bagli.current) setSonuc({ tone: 'olumlu', text: `Önbellek temizlendi: ${sayi(n)} parça silindi. ${korunduMetni(pending)} Nesil sonraki okumada kaynaktan gelir.` });
    } catch (error) {
      if (bagli.current) setSonuc({ tone: 'hata', text: `Hata: önbellek temizlenemedi (${hataAyrintisi(error)}). Sayfayı yenileyip yeniden deneyin.` });
    } finally {
      if (bagli.current) {
        setCalisiyor(false);
        setOnay(false);
      }
      await say();
    }
  };

  if (!cache.available) return <p className="aile-ikincil">{ONBELLEK_YOK}</p>;
  const deger = sayim.durum === 'tamam' ? `${sayi(sayim.n)} parça` : null;
  const parcalar = sayim.durum === 'tamam' ? `${sayi(sayim.n)} parça` : 'tüm parçalar';
  return (
    <>
      <dl className="aile-ayarlar__liste">
        <Deger label="Önbellekteki nesil parçası" value={deger} missing={sayim.durum === 'okunuyor' ? 'Sayılıyor…' : BILINMIYOR} />
      </dl>
      <div className="aile-ayarlar__eylem">
        <Button variant="secondary" onClick={ac}>Önbelleği temizle</Button>
      </div>
      <p className={sonuc?.tone === 'hata' ? 'aile-ayarlar__sonuc aile-ayarlar__hata' : 'aile-ayarlar__sonuc'} role="status">{sonuc?.text ?? ''}</p>
      <Dialog
        open={onay}
        alert
        title={ONAY_BASLIGI}
        onClose={kapat}
        footer={(
          <FormFooter
            narrow={phone}
            sticky={false}
            status={calisiyor ? 'Temizleniyor…' : 'Geri alınamaz; nesil sonraki okumada kaynaktan yeniden indirilir.'}
            primaryLabel="Önbelleği temizle"
            primaryDisabled={calisiyor}
            onPrimary={() => void onayla()}
            secondaryLabel="Vazgeç"
            onSecondary={kapat}
          />
        )}
      >
        <div className="aile-ayarlar__onay">
          <p>{`Bu tarayıcıdaki nesil önbelleğinden ${parcalar} silinir.`}</p>
          <p>{korunurMetni(pending)}</p>
        </div>
      </Dialog>
    </>
  );
}

// --- Cihazdaki panel verisi (onaylı tam silme) --------------------------------------------------------------------
function silmeSonucuMetni(result: DeviceWipeResult): string {
  const baglanti = result.connection ? 'Apps Script adresi ve uygulama anahtarı da silindi.' : 'Apps Script adresi ve uygulama anahtarı korundu.';
  return `Bu cihazdaki panel verisi silindi: ${sayi(result.partitions)} nesil parçası, son canlı bütçe okuması ve değişiklik kümesi. ${baglanti}`;
}

function bekleyenMetni(pending: number | null): string {
  if (pending === null) return `Bekleyen değişiklikler: ${BILINMIYOR}`;
  if (pending === 0) return 'Bekleyen değişiklikler: yok';
  return `Bekleyen değişiklikler: ${sayi(pending)} (e-tabloya gönderilmedi; silinince geri gelmez)`;
}

interface CihazVerisiProps {
  control: DeviceDataControl;
  cache: PartitionCacheControl;
  /** Bekleyen değişiklik sayısı; küme hazır değilse null. */
  pending: number | null;
  phone: boolean;
  reload(): void;
}

function CihazVerisi({ control, cache, pending, phone, reload }: CihazVerisiProps) {
  // Önceki sayfanın silme sonucu: yalnız okunur; anahtar efektte kaldırılır (StrictMode'da iki kez okunsa da kaybolmaz).
  const [sonuc, setSonuc] = useState<Sonuc | null>(() => {
    try {
      const text = oturumDeposu()?.getItem(SILME_SONUCU_ANAHTARI);
      return text ? { tone: 'olumlu', text } : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      oturumDeposu()?.removeItem(SILME_SONUCU_ANAHTARI);
    } catch {
      /* depolama yok; duyurulacak bir şey de yok */
    }
  }, []);
  const [onay, setOnay] = useState(false);
  const [baglantiDa, setBaglantiDa] = useState(false);
  const [calisiyor, setCalisiyor] = useState(false);
  const [parca, setParca] = useState<Sayim>({ durum: 'okunuyor' });
  const secenekYardimi = useId();
  const bagli = useRef(true);
  useEffect(() => {
    bagli.current = true;
    return () => {
      bagli.current = false;
    };
  }, []);

  const ac = () => {
    setBaglantiDa(false);
    setOnay(true);
    if (!cache.available) {
      setParca({ durum: 'tamam', n: 0 });
      return;
    }
    setParca({ durum: 'okunuyor' });
    cache.count().then(
      (n) => {
        if (bagli.current) setParca({ durum: 'tamam', n });
      },
      () => {
        if (bagli.current) setParca({ durum: 'bilinmiyor' });
      },
    );
  };
  const kapat = () => {
    if (!calisiyor) setOnay(false);
  };
  const onayla = async () => {
    if (calisiyor) return;
    setCalisiyor(true);
    try {
      const result = await control.wipe({ connection: baglantiDa });
      const text = silmeSonucuMetni(result);
      try {
        oturumDeposu()?.setItem(SILME_SONUCU_ANAHTARI, text);
      } catch {
        /* sonuç yalnız bu sekmede duyurulur */
      }
      if (bagli.current) setSonuc({ tone: 'olumlu', text });
      // Bellekteki kopyalar (değişiklik kümesi, okunan nesil, seçilen klasör) da gitsin: sayfa yeniden yüklenir.
      reload();
    } catch (error) {
      if (bagli.current) setSonuc({ tone: 'hata', text: `Hata: panel verisi silinemedi (${hataAyrintisi(error)}). Sayfayı yenileyip yeniden deneyin.` });
    } finally {
      if (bagli.current) {
        setCalisiyor(false);
        setOnay(false);
      }
    }
  };

  const parcaMetni = parca.durum === 'tamam' ? `${sayi(parca.n)} parça` : parca.durum === 'okunuyor' ? 'Sayılıyor…' : BILINMIYOR;
  return (
    <>
      <div className="aile-ayarlar__eylem">
        <Button variant="danger" onClick={ac}>{CIHAZ_DUGMESI}</Button>
      </div>
      <p className={sonuc?.tone === 'hata' ? 'aile-ayarlar__sonuc aile-ayarlar__hata' : 'aile-ayarlar__sonuc'} role="status">{sonuc?.text ?? ''}</p>
      <Dialog
        open={onay}
        alert
        title={CIHAZ_ONAY_BASLIGI}
        onClose={kapat}
        footer={(
          <FormFooter
            narrow={phone}
            sticky={false}
            status={calisiyor ? 'Siliniyor…' : 'Geri alınamaz; silme bitince sayfa yeniden yüklenir.'}
            primaryLabel="Tümünü sil"
            primaryDisabled={calisiyor}
            onPrimary={() => void onayla()}
            secondaryLabel="Vazgeç"
            onSecondary={kapat}
          />
        )}
      >
        <div className="aile-ayarlar__onay">
          <p>Bu tarayıcıdan silinir:</p>
          <ul className="aile-ayarlar__silinecek">
            <li>{`Nesil önbelleği: ${parcaMetni}`}</li>
            <li>Son canlı bütçe okuması</li>
            <li>{bekleyenMetni(pending)}</li>
          </ul>
          <label className="aile-ayarlar__secenek" data-focus-line="">
            <input
              type="checkbox"
              className="aile-ayarlar__kutu"
              checked={baglantiDa}
              disabled={calisiyor}
              aria-describedby={secenekYardimi}
              onChange={(event) => setBaglantiDa(event.currentTarget.checked)}
            />
            <span>{BAGLANTI_SECENEGI}</span>
          </label>
          <p id={secenekYardimi} className="aile-kucuk aile-ikincil">
            Bu ayar ana uygulamayla ortaktır: işaretlenirse ana uygulama da bu cihazda adresi ve anahtarı yeniden ister.
          </p>
          <p>E-tabloya, nesil klasörüne ve ana uygulamanın kendi verisine dokunulmaz.</p>
        </div>
      </Dialog>
    </>
  );
}

// --- Sayfa ---------------------------------------------------------------------------------------------------
interface Kayitli { url: string; hasKey: boolean }
interface Taslak { url: string; /** Yeni anahtar; kayıtlı anahtar buraya hiçbir zaman okunmaz. */ key: string; removeKey: boolean }

const kayitliOku = (): Kayitli => ({ url: getApiUrl(), hasKey: getAppKey() !== undefined });
const bosTaslak = (saved: Kayitli): Taslak => ({ url: saved.url, key: '', removeKey: false });

export function AyarlarPage({
  budgetSheetId = envBudgetSheetId, cacheControl, saveFile = saveJsonFile, now = simdi, liveLastRead = yerelSonCanliOkuma,
  deviceData, reloadPage = tarayiciyiYenile, persistentCache,
}: AyarlarPageProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const phone = device === 'phone';
  const generation = useGeneration();
  const changeSet = useChangeSet();
  const [onizlemeAcik, setOnizlemeAcik] = useState(false);
  const cache = cacheControl ?? varsayilanOnbellekDenetimi();
  const cihaz = deviceData ?? varsayilanCihazDenetimi();
  const kaliciOnbellek = useMemo(() => persistentCache ?? persistentCacheAllowed(), [persistentCache]);

  // Canlı bağlantı: kayıtlı değer (localStorage) ve taslak. Kayıtlı anahtar yalnız "var/yok" olarak bilinir.
  const [saved, setSaved] = useState<Kayitli>(kayitliOku);
  const [draft, setDraft] = useState<Taslak>(() => bosTaslak(saved));
  const yeniAnahtar = draft.key.trim() !== '';
  const dirty = draft.url !== saved.url || yeniAnahtar || draft.removeKey;
  const urlInvalid = draft.url.trim() !== '' && !isValidApiUrl(draft.url);
  const kaydet = useCallback(() => {
    if (urlInvalid || !dirty) return;
    setApiUrl(draft.url);
    if (draft.removeKey) setAppKey('');
    else if (yeniAnahtar) setAppKey(draft.key);
    const next = kayitliOku();
    setSaved(next);
    setDraft(bosTaslak(next));
  }, [draft, dirty, urlInvalid, yeniAnahtar]);
  const vazgec = useCallback(() => setDraft(bosTaslak(saved)), [saved]);

  const canli = useMemo<{ label: string; tone: Tone }>(() => {
    if (!saved.url) return { label: 'Adres yok', tone: 'notr' };
    return isValidApiUrl(saved.url) ? { label: 'Hazır', tone: 'olumlu' } : { label: 'Adres geçersiz', tone: 'hata' };
  }, [saved.url]);
  const anahtarDurumu: { label: string; tone: Tone } = !saved.hasKey
    ? { label: 'Anahtar yok', tone: 'notr' }
    : draft.removeKey ? { label: 'Anahtar kaydedince silinecek', tone: 'uyari' } : { label: 'Anahtar kayıtlı', tone: 'olumlu' };

  const altlikDurumu = urlInvalid
    ? 'Hata: 1 alan düzeltilmeli · Kaydedilmemiş değişiklik var'
    : dirty ? 'Kaydedilmemiş değişiklik var' : 'Değişiklik yok';

  // Nesil tazelik satırı (başlıkta ve Nesil kaynağı satırında aynı).
  const status: DataStatusProps = {
    state: DURUM[generation.state],
    lastReadAt: generation.lastReadAt ?? undefined,
    lastGoodAt: generation.lastGoodAt ?? undefined,
    generationId: generation.generationId ?? undefined,
    message: generation.message ?? undefined,
    onRefresh: () => void generation.refresh(),
  };

  const nesilOkunuyor = generation.state === 'idle' || generation.state === 'checking';
  const counts = generation.manifest?.counts;
  const nesilOzeti = counts
    ? `${sayi(Object.keys(counts).length)} koleksiyon · ${sayi(Object.values(counts).reduce((sum, count) => sum + count, 0))} kayıt`
    : nesilOkunuyor ? OKUNUYOR : generation.state === 'error' ? BILINMIYOR : HENUZ_YOK;

  const bekleyen = changeSet.ready ? String(changeSet.pending) : null;
  const summary: readonly PageHeaderSummary[] = [
    { label: 'Nesil', value: generation.generationId ? generation.generationId.slice(0, 6) : HENUZ_YOK },
    { label: 'Bekleyen değişiklik', value: bekleyen ?? BILINMIYOR, note: 'yalnız bu tarayıcıda' },
    { label: 'Canlı bağlantı', value: canli.label },
  ];

  const yenile = () => void generation.refresh();
  // Ayar koleksiyonu yalnız manifest varken istenir; yoksa nesil durumu (okunuyor / hata) iki satırı çizer.
  const nesilAyarDurumu: AyarDurumu = generation.state === 'error' || generation.state === 'stale'
    ? { durum: 'hata', title: 'Nesil okunamadı', message: generation.message ?? NESIL_OKUNAMADI }
    : { durum: 'okunuyor' };

  const butceTanimli = budgetSheetId.trim() !== '';
  const onizlemeAcilabilir = changeSet.ready && changeSet.pending > 0;

  return (
    <>
      <PageHeader
        location={settingsLink.path}
        section="Uygulama"
        title={settingsLink.label}
        purpose="Aile bilgilerini, biçimleri, e-tablo bağlantısını ve üyeleri yönetin."
        status={status}
        summary={summary}
      />
      <div className={`aile-ayarlar${narrow ? ' aile-ayarlar--dar' : ''}`} data-narrow={narrow}>
        {generation.manifest
          ? <AyarKoleksiyonu phone={phone} onRetry={yenile} />
          : <AyarSatirlari durum={nesilAyarDurumu} phone={phone} onRetry={yenile} />}

        <Row title="Nesil kaynağı" busy={nesilOkunuyor} help="Panel doğrulanmış JSON neslini okur; her okuma yeni bir nesil oluşturur. E-tabloya yazmaz.">
          <dl className="aile-ayarlar__liste">
            <Deger label="Kaynak" value={kaynakEtiketi(generation.source)} />
            <Deger label="İçerik" value={nesilOzeti} />
          </dl>
          <div className="aile-ayarlar__tazelik">
            <DataStatus {...status} />
            {/* Canlı bölge her zaman DOM'da: "Eski veri" belirince duyurulur; içerik metnine karışmaz. */}
            <div className="aile-ayarlar__canli" role="status">
              {generation.state === 'stale' ? <StatusText tone="uyari" label={ESKI_VERI} /> : null}
            </div>
          </div>
          {generation.sourceMessage ? <p className="aile-ayarlar__hata">{generation.sourceMessage}</p> : null}
          {generation.canPickDirectory ? (
            <div className="aile-ayarlar__eylem"><Button variant="secondary" onClick={() => void generation.pickDirectory()}>Klasör seç</Button></div>
          ) : (
            <p className="aile-kucuk aile-ikincil">Bu tarayıcı klasör seçmeyi desteklemiyor; nesil geliştirme sunucusundan okunur.</p>
          )}
        </Row>

        <Row title="Canlı bağlantı" help={CANLI_BAGLANTI_YARDIMI}>
          <div className="aile-ayarlar__durum">
            <span className="aile-ayarlar__etiket aile-kucuk aile-ikincil">Durum</span>
            <StatusText label={canli.label} tone={canli.tone} />
            <StatusText label={anahtarDurumu.label} tone={anahtarDurumu.tone} />
          </div>
          <TextField
            label="Apps Script adresi"
            value={draft.url}
            onChange={(url) => setDraft((current) => ({ ...current, url }))}
            placeholder={APPS_SCRIPT_ORNEK}
            inputMode="url"
            type="url"
            autoComplete="off"
            help={SAKLAMA_NOTU}
            error={urlInvalid ? `Adres ${APPS_SCRIPT_ORNEK} biçiminde olmalı` : undefined}
          />
          <TextField
            label="Uygulama anahtarı"
            value={draft.key}
            onChange={(key) => setDraft((current) => ({ ...current, key, removeKey: false }))}
            type="password"
            autoComplete="off"
            help={`${SAKLAMA_NOTU} ${ANAHTAR_NOTU}`}
          />
          {saved.hasKey && !draft.removeKey && !yeniAnahtar ? (
            <div className="aile-ayarlar__eylem">
              <Button variant="quiet" onClick={() => setDraft((current) => ({ ...current, key: '', removeKey: true }))}>Anahtarı sil</Button>
            </div>
          ) : null}
          {/* Telefonda yapışkan (tasarım: FormFooter telefonda yapışkandır; Ayarlar ekranı). Altlık yüksekliğini belge
              kaydırma payı olarak ayırır: odaklanan alan altlığın altında kalmaz. Tablet ve masaüstünde akışta. */}
          <FormFooter
            narrow={phone}
            status={altlikDurumu}
            statusTone={urlInvalid ? 'hata' : undefined}
            primaryLabel="Kaydet"
            primaryDisabled={urlInvalid || !dirty}
            onPrimary={kaydet}
            secondaryLabel="Vazgeç"
            onSecondary={vazgec}
          />
        </Row>

        <Row title="Bütçe e-tablosu" help="Bütçe doğrudan e-tablodan okunur; kimlik derleme ortamından gelir, panelden değiştirilemez.">
          <div className="aile-ayarlar__durum">
            <span className="aile-ayarlar__etiket aile-kucuk aile-ikincil">Kimlik</span>
            <StatusText
              label={butceTanimli ? 'Kimlik tanımlı (VITE_BUDGET_SHEET_ID)' : 'Kimlik tanımlı değil: VITE_BUDGET_SHEET_ID yok'}
              tone={butceTanimli ? 'olumlu' : 'uyari'}
            />
          </div>
          {butceTanimli ? (
            <>
              <SonCanliOkuma read={liveLastRead} />
              <p className="aile-kucuk aile-ikincil">{CANLI_OKUMA_NOTU}</p>
            </>
          ) : null}
        </Row>

        <Row title="Değişiklik kümesi" help="Panelde yapılan durum ve not değişiklikleri önce bu tarayıcıda birikir; e-tabloya gönderme bu sürümde yok. Dışa aktarılan dosyada adres ve anahtar yer almaz.">
          {changeSet.message ? <p className="aile-ayarlar__hata">{changeSet.message}</p> : null}
          <p className="aile-ayarlar__bekleyen">
            {changeSet.ready
              ? changeSet.pending > 0 ? `${sayi(changeSet.pending)} bekleyen değişiklik` : 'Bekleyen değişiklik yok'
              : `Bekleyen değişiklik: ${BILINMIYOR}`}
          </p>
          {changeSet.persistence === 'unavailable' ? (
            <StatusText tone="uyari" label="Tarayıcı saklaması kullanılamıyor; değişiklikler sayfa yenilenince kaybolur" />
          ) : null}
          <Disclosure
            title="Dışa aktarma önizlemesi"
            meta={changeSet.ready ? `${sayi(changeSet.pending)} işlem` : HENUZ_YOK}
            disabled={!onizlemeAcilabilir}
            open={onizlemeAcik && onizlemeAcilabilir}
            onToggle={setOnizlemeAcik}
          >
            {onizlemeAcik && onizlemeAcilabilir ? (
              <DisaAktarmaOnizlemesi toBatch={changeSet.toBatch} generationId={generation.generationId} pending={changeSet.pending} saveFile={saveFile} now={now} />
            ) : null}
          </Disclosure>
        </Row>

        <Row title="Önbellek" help={kaliciOnbellek ? ONBELLEK_YARDIMI : ONBELLEK_KAPALI_YARDIMI}>
          <Onbellek
            cache={cache}
            pending={changeSet.ready ? changeSet.pending : null}
            phone={phone}
            recountKey={`${generation.lastReadAt ?? ''}|${generation.state}`}
          />
        </Row>

        <Row title="Cihazdaki panel verisi" help={CIHAZ_YARDIMI}>
          <CihazVerisi
            control={cihaz}
            cache={cache}
            pending={changeSet.ready ? changeSet.pending : null}
            phone={phone}
            reload={reloadPage}
          />
        </Row>

        <Row title="Üyeler" help="Üye ve rol bilgisi nesilde yok; bu sürümde davet ve rol değişikliği yapılmaz.">
          <p className="aile-ikincil">{UYE_KAYDI_YOK}</p>
        </Row>
      </div>
    </>
  );
}
