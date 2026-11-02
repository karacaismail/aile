import { useEffect, useLayoutEffect, useRef, type FocusEvent } from 'react';
import type { DataStatusProps, DataStatusState, Tone } from '../shell/contracts';
import { Icon } from './icons';
import './DataStatus.css';

// Tasarım: components/DataStatus/README.md + envanter.md satırı; davranış bundle.js DataStatus. Sayfa başlığının altındaki
// tazelik satırı: verinin ne zaman, hangi nesilden okunduğu. Tek role="status" satırı (aria-live polite); şerit, kart ya da
// kenarlık yok, rengi yalnız metin taşır (eski/çakışma uyari, hata hata) ve her durumda sözcük söyler: "yenilenemedi",
// "Hata:", "Çakışma:". Simge süsleyicidir. Düğme yalnız işleyici verilince çizilir (işlevsiz düğme yok); okunurken "Yenile"
// devre dışıdır ve nedeni ("Okunuyor…") yanında yazar. Metinler README'den; eksik bilgi adıyla yazılır ("bilinmiyor", "henüz yok").
// Saat tr-TR / Europe/Istanbul "14:32"; başka güne ait okuma tarihiyle "27.10.2026 14:32" (contracts: "28.10.2026 14:05").
// Yerel HTML, antd yok: tek uygulama tüm profillere hizmet eder. Satır doğal sarılır; ayırıcı "·" önündeki parçaya bağlıdır,
// böylece sarılan satır hiçbir zaman "·" ile başlamaz. Parça metni kendi öğesindedir (aile-ds__metin): satırdan uzun bir
// parça (ör. hata nedenindeki dosya yolu) kendi içinde sarılır, belgeyi taşırmaz. Parçalar tek metin kutusundadır
// (aile-ds__parcalar); eylem onun yanında kalacak yer varsa metin kutunun içinde sarılır, düğme satırda kalır: yedek fonttan
// Outfit'e geçişteki birkaç piksellik genişlik farkı düğmeyi alt satıra itip sayfayı kaydırmaz (DataStatus.css).
// Eylem yerel <button>: 44 px, coarse girişte 48 px.
// Odak dönüşü: okuma başlarken devre dışı kalan odaklı düğme odağı belgeye bırakır (tarayıcı odak düzeltmesi); okuma
// bitince odak, kullanıcı bu arada başka yere geçmediyse aynı düğmeye ("Yenile" ya da "Yeniden dene") geri verilir.
export type { DataStatusProps, DataStatusState };

const ZAMAN_DILIMI = 'Europe/Istanbul';
const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: ZAMAN_DILIMI });
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZAMAN_DILIMI });

export const BILINMIYOR = 'bilinmiyor';
const HENUZ_YOK = 'henüz yok';
/** README: "Nesil a1b2c3" — 64 hex'lik generation_id'nin ilk 6 karakteri; tamamı data-generation-id'de. */
const NESIL_KISA = 6;
const HATA_ONEKI = /^hata:\s*/i;
const AYIRICI = ' · ';

/** ISO zamanı İstanbul saatiyle yazar: bugünse "14:32", başka günse "27.10.2026 14:32"; geçersizse undefined. */
export function zamanMetni(iso: string | undefined, simdi: Date = new Date()): string | undefined {
  if (!iso) return undefined;
  const an = new Date(iso);
  if (Number.isNaN(an.getTime())) return undefined;
  const saat = saatBicimi.format(an);
  const gun = tarihBicimi.format(an);
  return gun === tarihBicimi.format(simdi) ? saat : `${gun} ${saat}`;
}

const TON: Record<DataStatusState, Tone> = { checking: 'notr', fresh: 'notr', stale: 'uyari', error: 'hata', conflict: 'uyari' };

interface Parca { key: string; text: string; icon?: boolean }

function parcalar({ state, lastReadAt, generationId, lastGoodAt, message }: DataStatusProps): Parca[] {
  const okuma = zamanMetni(lastReadAt);
  const sonIyi = zamanMetni(lastGoodAt);
  const sonOkuma = `Son okuma ${okuma ?? BILINMIYOR}`;
  const sonIyiNesil = `Son başarılı nesil ${sonIyi ?? BILINMIYOR}`;
  switch (state) {
    case 'fresh': {
      const nesil = generationId ? generationId.slice(0, NESIL_KISA) : BILINMIYOR;
      return [{ key: 'okuma', text: sonOkuma }, { key: 'nesil', text: `Nesil ${nesil}` }];
    }
    case 'checking':
      return [{ key: 'okunuyor', text: 'Okunuyor…' }, { key: 'okuma', text: okuma ? sonOkuma : `Son okuma ${HENUZ_YOK}` }];
    case 'stale':
      return [{ key: 'son-iyi', text: sonIyiNesil, icon: true }, { key: 'neden', text: 'yenilenemedi' }];
    case 'error': {
      const neden = message ? message.trim().replace(HATA_ONEKI, '') : `Okuma başarısız${okuma ? ` ${okuma}` : ''}`;
      const liste: Parca[] = [{ key: 'hata', text: `Hata: ${neden}`, icon: true }];
      if (sonIyi) liste.push({ key: 'son-iyi', text: sonIyiNesil });
      return liste;
    }
    case 'conflict':
      return [
        { key: 'cakisma', text: message?.trim() || 'Çakışma: bu kayıt başka yerde değişti', icon: true },
        { key: 'surum', text: 'iki sürüm var' },
      ];
  }
}

/** Devre dışı kalırken odağı kaybeden eylem düğmesine, okuma bitince odağı geri verir (kullanıcı başka yere geçmediyse). */
function useFocusReturn(disabled: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const hadFocus = useRef(false);

  useEffect(() => {
    if (!disabled || !hadFocus.current) return undefined;
    // Okuma sürerken kullanıcı başka bir yere dokunursa odak ona aittir; geri alınmaz.
    const forget = () => { hadFocus.current = false; };
    document.addEventListener('pointerdown', forget, true);
    return () => document.removeEventListener('pointerdown', forget, true);
  }, [disabled]);

  useLayoutEffect(() => {
    const button = ref.current;
    if (disabled || !button || !hadFocus.current) return;
    const active = document.activeElement;
    if (active === button) return;
    hadFocus.current = false;
    if (active === null || active === document.body) button.focus({ preventScroll: true });
  }, [disabled]);

  const onFocus = () => { hadFocus.current = true; };
  // Devre dışı kalma nedeniyle düşen odak "kullanıcı ayrıldı" sayılmaz.
  const onBlur = (event: FocusEvent<HTMLButtonElement>) => { if (!event.currentTarget.disabled) hadFocus.current = false; };
  return { ref, onFocus, onBlur };
}

export function DataStatus(props: DataStatusProps) {
  const { state, generationId, onRefresh, onCompare } = props;
  const tone = TON[state];
  const parts = parcalar(props);
  const disabled = state === 'checking';
  const focus = useFocusReturn(disabled);

  const handler = state === 'conflict' ? onCompare : onRefresh;
  const label = state === 'conflict' ? 'Karşılaştır' : state === 'stale' || state === 'error' ? 'Yeniden dene' : 'Yenile';
  const action = handler ? (
    <button
      ref={focus.ref}
      type="button"
      className="aile-ds__btn"
      data-focus-line=""
      disabled={disabled}
      onClick={() => handler()}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
    >
      {state === 'conflict' ? null : <Icon name="refresh" />}
      {label}
    </button>
  ) : null;

  return (
    <div role="status" aria-live="polite" className={`aile-ds aile-ds--${state} aile-kucuk`} data-state={state} data-tone={tone}>
      <span className="aile-ds__parcalar">
        {parts.map((part, index) => {
          const last = index === parts.length - 1;
          return (
            <span key={part.key} className={part.icon ? 'aile-ds__parca aile-ds__msg' : 'aile-ds__parca'}>
              {part.icon ? <Icon name="alert" className="aile-ds__icon" /> : null}
              {/* Tam nesil kimliği metni taşıyan öğededir ("Nesil a1b2c3" metniyle bulunan öğe kimliği de taşır). */}
              <span className="aile-ds__metin" data-generation-id={part.key === 'nesil' && generationId ? generationId : undefined}>{part.text}</span>
              {!last || action ? (
                <span className={last ? 'aile-ds__sep aile-ds__sep--eylem' : 'aile-ds__sep'} aria-hidden="true">{AYIRICI}</span>
              ) : null}
            </span>
          );
        })}
      </span>
      {action}
    </div>
  );
}
