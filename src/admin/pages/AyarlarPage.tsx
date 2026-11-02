import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { sheetId as envBudgetSheetId } from '../../dashboard/data';
import { getApiUrl, getAppKey, setApiUrl, setAppKey } from '../../sync/config';
import { useChangeSet, useCollection, useGeneration, type BatchConversion, type GenerationState, type OverlayRecord, type SettingRecord } from '../data';
import { useDevice } from '../device';
import type { DataStatusProps, DataStatusState, PageHeaderSummary, Tone } from '../shell/contracts';
import { settingsLink } from '../shell/navigation';
import { PageHeader } from '../shell/PageHeader';
import { Button, DataStatus, Disclosure, ErrorState, FormFooter, LoadingShell, StatusText, TextField } from '../ui';
import './AyarlarPage.css';

// Tasarım: bundle.js › Pages.Ayarlar (Row: başlık + yardım solda, alanlar sağda; dar ekranda alt alta; altta FormFooter),
// README.md "Sayfa iskeleti" 1–2 (başlık + özet ≤3), ekranlar.md SayfaAyarlar / SayfaAyarlarDar. Yerleşim AyarlarPage.css.
// Veri: nesil (useGeneration), ayar koleksiyonu (useCollection('settings'), salt okunur: panel Sheets'e yazmaz, bu yüzden
// tasarımdaki Aile/Biçimler giriş alanları burada okunan değer + "Henüz yok" olarak yazılır), canlı Apps Script adresi ve
// anahtarı (src/sync/config.ts → localStorage; anahtar maskeli, yalnız bu tarayıcıda), bütçe Sheet kimliği durumu (env,
// kimlik yazılmaz), yerel değişiklik kümesi (bekleyen op + toBatch JSON önizlemesi; gönderme yok). Üye koleksiyonu nesilde
// yok → "Kaynakta üye kaydı yok". Eksik bilgi adıyla; hata "Hata: …"; işlevsiz düğme yok; native select yok.

export interface AyarlarPageProps {
  /** Bütçe e-tablosu kimliği (varsayılan VITE_BUDGET_SHEET_ID). Sayfa kimliği yazmaz, yalnız tanımlı olup olmadığını söyler. */
  budgetSheetId?: string;
}

const HENUZ_YOK = 'Henüz yok';
const BILINMIYOR = 'Bilinmiyor';
const AYAR_KAYDI_YOK = 'Kaynakta ayar kaydı yok.';
const UYE_KAYDI_YOK = 'Kaynakta üye kaydı yok.';
const TARIH_BICIMI = 'gg.aa.yyyy (28.10.2026)';
const SAKLAMA_NOTU = 'Yalnız bu tarayıcıda saklanır; e-tabloya ve nesle yazılmaz.';
const APPS_SCRIPT_ORNEK = 'https://script.google.com/macros/s/…/exec';
/** src/sync/config.ts isApiConfigured ile aynı biçim; taslak değer kaydedilmeden önce burada denetlenir. */
const APPS_SCRIPT_BICIMI = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/;
const PARA_BIRIMI_ADI: Record<string, string> = { TRY: 'Türk lirası (₺)' };

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
interface RowProps { title: string; help?: string; children: ReactNode }

/** Tasarım Row: h2 + yardım solda, alanlar sağda; data-narrow'da alt alta. Kenar yalnız alt cizgi ayırıcı. */
function Row({ title, help, children }: RowProps) {
  const id = useId();
  return (
    <section className="aile-ayarlar__satir" aria-labelledby={id}>
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

// --- Dışa aktarma önizlemesi (yalnız açıkken bağlanır; yedi kalem koleksiyonu o zaman okunur) --------------------
interface OnizlemeProps { toBatch(records: readonly OverlayRecord[]): BatchConversion | null; generationId: string | null; pending: number }

function DisaAktarmaOnizlemesi({ toBatch, generationId, pending }: OnizlemeProps) {
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

  if (error) return <p className="aile-ayarlar__hata">{error}</p>;
  if (loading || !batch) return <LoadingShell rows={2} label="Kayıtlar okunuyor" />;
  const json = JSON.stringify({ schemaVersion: 1, kind: 'aile-change-set-batch', generation_id: generationId, pending, ops: batch.ops, skipped: batch.skipped }, null, 2);
  return (
    <div className="aile-ayarlar__onizleme">
      <p className="aile-kucuk aile-ikincil">{`${batch.ops.length} işlem gönderilebilir · ${batch.skipped.length} atlandı · gönderme yok`}</p>
      <pre className="aile-ayarlar__json" aria-label="Dışa aktarma JSON" tabIndex={0} data-focus-line="">{json}</pre>
    </div>
  );
}

// --- Sayfa ---------------------------------------------------------------------------------------------------
export function AyarlarPage({ budgetSheetId = envBudgetSheetId }: AyarlarPageProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const generation = useGeneration();
  const settings = useCollection('settings');
  const changeSet = useChangeSet();
  const [onizlemeAcik, setOnizlemeAcik] = useState(false);

  // Canlı bağlantı: kayıtlı değer (localStorage) ve taslak. Kaydet yalnız geçerli ve değişmiş taslakta.
  const [saved, setSaved] = useState(() => ({ url: getApiUrl(), key: getAppKey() ?? '' }));
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = draft.url !== saved.url || draft.key !== saved.key;
  const urlInvalid = draft.url.trim() !== '' && !isValidApiUrl(draft.url);
  const kaydet = useCallback(() => {
    if (urlInvalid || !dirty) return;
    setApiUrl(draft.url);
    setAppKey(draft.key);
    setSaved({ url: getApiUrl(), key: getAppKey() ?? '' });
  }, [draft, dirty, urlInvalid]);
  const vazgec = useCallback(() => setDraft(saved), [saved]);

  const canli = useMemo<{ label: string; tone: Tone }>(() => {
    if (!saved.url) return { label: 'Adres yok', tone: 'notr' };
    return isValidApiUrl(saved.url) ? { label: 'Hazır', tone: 'olumlu' } : { label: 'Adres geçersiz', tone: 'hata' };
  }, [saved.url]);

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

  const counts = generation.manifest?.counts;
  const nesilOzeti = counts
    ? `${Object.keys(counts).length} koleksiyon · ${Object.values(counts).reduce((sum, count) => sum + count, 0)} kayıt`
    : HENUZ_YOK;

  const bekleyen = changeSet.ready ? String(changeSet.pending) : null;
  const summary: readonly PageHeaderSummary[] = [
    { label: 'Nesil', value: generation.generationId ? generation.generationId.slice(0, 6) : HENUZ_YOK },
    { label: 'Bekleyen değişiklik', value: bekleyen ?? BILINMIYOR, note: 'yalnız bu tarayıcıda' },
    { label: 'Canlı bağlantı', value: canli.label },
  ];

  // Ayar koleksiyonu (salt okunur).
  const ayarlar = settings.rows.filter((row) => row.kind === 'setting');
  const ayarBos = !settings.loading && settings.error === null && ayarlar.length === 0;
  const paraKodu = ayarDegeri(settings.rows, 'para_birimi');
  const ayarIcerik = (children: ReactNode) => {
    if (settings.loading) return <LoadingShell rows={2} label="Ayarlar okunuyor" />;
    if (settings.error) return <ErrorState message={settings.error} onRetry={() => void generation.refresh()} />;
    if (ayarBos) return <p className="aile-ikincil">{AYAR_KAYDI_YOK}</p>;
    return children;
  };

  const butceTanimli = budgetSheetId.trim() !== '';

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
        <Row title="Aile" help="Üst barda ve raporlarda görünür. E-tablodan (app_ayarlar) okunur; panel bu alanları yazmaz.">
          {ayarIcerik(
            <dl className="aile-ayarlar__liste">
              <Deger label="Aile adı" value={ayarDegeri(settings.rows, 'aile_adi')} />
              <Deger label="Ay başlangıç günü" value={ayarDegeri(settings.rows, 'ay_baslangic_gunu')} />
            </dl>,
          )}
        </Row>

        <Row title="Biçimler" help="Tüm tutar ve tarihler bu biçimle yazılır.">
          {ayarIcerik(
            <dl className="aile-ayarlar__liste">
              <Deger label="Para birimi" value={paraKodu ? PARA_BIRIMI_ADI[paraKodu] ?? paraKodu : null} />
              <Deger label="Tarih biçimi" value={TARIH_BICIMI} />
            </dl>,
          )}
        </Row>

        <Row title="Nesil kaynağı" help="Panel doğrulanmış JSON neslini okur; her okuma yeni bir nesil oluşturur. E-tabloya yazmaz.">
          <dl className="aile-ayarlar__liste">
            <Deger label="Kaynak" value={kaynakEtiketi(generation.source)} />
            <Deger label="İçerik" value={nesilOzeti} />
          </dl>
          <DataStatus {...status} />
          {generation.sourceMessage ? <p className="aile-ayarlar__hata">{generation.sourceMessage}</p> : null}
          {generation.canPickDirectory ? (
            <div><Button variant="secondary" onClick={() => void generation.pickDirectory()}>Klasör seç</Button></div>
          ) : (
            <p className="aile-kucuk aile-ikincil">Bu tarayıcı klasör seçmeyi desteklemiyor; nesil geliştirme sunucusundan okunur.</p>
          )}
        </Row>

        <Row title="Canlı bağlantı" help="Uygulama kayıtları bu Apps Script adresinden canlı okunur. Adres ve anahtar yalnız bu tarayıcıda saklanır.">
          <div className="aile-ayarlar__durum">
            <span className="aile-ayarlar__etiket aile-kucuk aile-ikincil">Durum</span>
            <StatusText label={canli.label} tone={canli.tone} />
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
            onChange={(key) => setDraft((current) => ({ ...current, key }))}
            type="password"
            autoComplete="off"
            help={`${SAKLAMA_NOTU} Boş bırakılırsa anahtar silinir.`}
          />
          <FormFooter
            narrow={device === 'phone'}
            sticky={device === 'phone'}
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
        </Row>

        <Row title="Değişiklik kümesi" help="Panelde yapılan durum ve not değişiklikleri önce bu tarayıcıda birikir; e-tabloya gönderme bu sürümde yok.">
          {changeSet.message ? <p className="aile-ayarlar__hata">{changeSet.message}</p> : null}
          <p className="aile-ayarlar__bekleyen">
            {changeSet.ready
              ? changeSet.pending > 0 ? `${changeSet.pending} bekleyen değişiklik` : 'Bekleyen değişiklik yok'
              : `Bekleyen değişiklik: ${BILINMIYOR}`}
          </p>
          {changeSet.persistence === 'unavailable' ? (
            <StatusText tone="uyari" label="Tarayıcı saklaması kullanılamıyor; değişiklikler sayfa yenilenince kaybolur" />
          ) : null}
          <Disclosure
            title="Dışa aktarma önizlemesi"
            meta={changeSet.ready ? `${changeSet.pending} işlem` : HENUZ_YOK}
            disabled={!changeSet.ready || changeSet.pending === 0}
            open={onizlemeAcik && changeSet.ready && changeSet.pending > 0}
            onToggle={setOnizlemeAcik}
          >
            {onizlemeAcik && changeSet.ready && changeSet.pending > 0 ? (
              <DisaAktarmaOnizlemesi toBatch={changeSet.toBatch} generationId={generation.generationId} pending={changeSet.pending} />
            ) : null}
          </Disclosure>
        </Row>

        <Row title="Üyeler" help="Üye ve rol bilgisi nesilde yok; bu sürümde davet ve rol değişikliği yapılmaz.">
          <p className="aile-ikincil">{UYE_KAYDI_YOK}</p>
        </Row>
      </div>
    </>
  );
}
