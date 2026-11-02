import type { ReactNode } from 'react';
import type { DataStatusProps, DataStatusState, Tone } from '../shell/contracts';
import { AntButton } from './antd';
import { Icon } from './icons';
import './DataStatus.css';

// Tasarım: components/DataStatus/README.md + envanter.md satırı; davranış bundle.js DataStatus. Sayfa başlığının altındaki
// tazelik satırı: verinin ne zaman, hangi nesilden okunduğu. Tek role="status" satırı (aria-live polite); şerit, kart ya da
// kenarlık yok, rengi yalnız metin taşır (eski/çakışma uyari, hata hata) ve her durumda sözcük söyler: "yenilenemedi",
// "Hata:", "Çakışma:". Simge süsleyicidir. Düğme yalnız işleyici verilince çizilir (işlevsiz düğme yok); okunurken "Yenile"
// devre dışıdır ve nedeni ("Okunuyor…") yanında yazar. Ham antd yalnız ui/ içinde; Button sarmalayıcısına bağlanmadan
// AntButton: bileşen tek başına çalışır. Metinler README'den; eksik bilgi adıyla yazılır ("bilinmiyor", "henüz yok").
// Saat tr-TR / Europe/Istanbul "14:32"; başka güne ait okuma tarihiyle "27.10.2026 14:32" (contracts: "28.10.2026 14:05").
export type { DataStatusProps, DataStatusState };

const ZAMAN_DILIMI = 'Europe/Istanbul';
const saatBicimi = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: ZAMAN_DILIMI });
const tarihBicimi = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZAMAN_DILIMI });

export const BILINMIYOR = 'bilinmiyor';
const HENUZ_YOK = 'henüz yok';
/** README: "Nesil a1b2c3" — 64 hex'lik generation_id'nin ilk 6 karakteri; tamamı data-generation-id'de. */
const NESIL_KISA = 6;
const HATA_ONEKI = /^hata:\s*/i;

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

export function DataStatus(props: DataStatusProps) {
  const { state, generationId, onRefresh, onCompare } = props;
  const tone = TON[state];
  const parts = parcalar(props);

  let action: ReactNode = null;
  if (state === 'conflict') {
    if (onCompare) action = <AntButton className="aile-ds__btn" color="primary" variant="text" onClick={onCompare}>Karşılaştır</AntButton>;
  } else if (onRefresh) {
    action = (
      <AntButton className="aile-ds__btn" color="primary" variant="text" icon={<Icon name="refresh" />} disabled={state === 'checking'} onClick={onRefresh}>
        {state === 'stale' || state === 'error' ? 'Yeniden dene' : 'Yenile'}
      </AntButton>
    );
  }

  const items: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) items.push(<span key={`${part.key}-sep`} className="aile-ds__sep" aria-hidden="true"> · </span>);
    items.push(
      <span
        key={part.key}
        className={part.icon ? 'aile-ds__msg' : undefined}
        data-generation-id={part.key === 'nesil' && generationId ? generationId : undefined}
      >
        {part.icon ? <Icon name="alert" className="aile-ds__icon" /> : null}
        {part.text}
      </span>,
    );
  });
  if (action) items.push(<span key="action-sep" className="aile-ds__sep" aria-hidden="true"> · </span>, <span key="action">{action}</span>);

  return (
    <div role="status" aria-live="polite" className={`aile-ds aile-ds--${state} aile-kucuk`} data-state={state} data-tone={tone}>
      {items}
    </div>
  );
}
