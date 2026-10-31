import { financeMoney as money } from '../finance/format';
import type { FinanceEvent } from '../finance/data';
import { dateLabel } from './data';
import { isPurchase, type PurchaseDetails } from './purchase';

/**
 * One ledger step, one reading order. Every part answers the next question of
 * the family's journey and carries `data-step-part` so CSS and regression tests
 * share a single contract instead of inferring the order from class names:
 *   identity → facts (what, how much, when, how) → after (cash and debt after
 *   this step) → accounts (per bank) → source (conditions and certainty).
 * Flow and table views compose the same parts; no part recalculates finance.
 */
export const stepParts = ['identity', 'facts', 'after', 'accounts', 'source'] as const;
export type StepPart = typeof stepParts[number];

const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
const tone = (value: number) => value > 0 ? 'inflow' : value < 0 ? 'outflow' : 'neutral';

export const balanceFields = [
  ['cash', 'Harcanabilir nakit'], ['cardDebt', 'Toplam kart borcu'],
  ['requiredBalance', 'Net nakit konumu'], ['kmhPrincipal', 'KMH anaparası'],
  ['kmhCost', 'KMH faiz + vergi'], ['denizPrincipal', 'Denizbank anapara'],
  ['denizCost', 'Denizbank faiz + vergi'], ['isPrincipal', 'İşbank anapara'],
  ['isCost', 'İşbank faiz + vergi'],
] as const;
const accounts = [
  ['Denizbank kredi kartı', 'denizPrincipal', 'denizCost'],
  ['İşbank kredi kartı', 'isPrincipal', 'isCost'],
  ['KMH', 'kmhPrincipal', 'kmhCost'],
] as const;

const isWeeklyCash = (event: FinanceEvent) => /^week-\d+-etut-\d+$/.test(event.id) && event.type === 'Nakit hareketi' && event.cashChange < 0 && event.source.includes('her cuma akşamı');

/** Kind, position and title: where this step sits in the ledger. */
export function StepIdentity({ event, number }: { event: FinanceEvent; number: number }) {
  return <header className="timeline-step-identity" data-step-part="identity">
    <p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span><span>Adım {number}</span></p>
    <h3>{event.title}</h3>
  </header>;
}

function PlannedPurchase({ event, purchase }: { event: FinanceEvent; purchase: PurchaseDetails | null }) {
  return <>
    <dl className="timeline-purchase-facts">
      <div className="timeline-purchase-amount"><dt>Planlanan alım tutarı</dt><dd>{purchase ? money(purchase.amount) : <span className="timeline-missing">Tutar doğrulanamadı</span>}</dd></div>
      <div><dt>Alım tarihi</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
      <div><dt>Ödeme yöntemi</dt><dd>{purchase?.method ?? 'Yöntem doğrulanamadı'}{purchase?.instalments && <span className="timeline-purchase-terms">{purchase.instalments === 1 ? 'Tek çekim' : `${purchase.instalments} taksit`}</span>}</dd></div>
    </dl>
    {purchase && <div className="timeline-immediate-effect"><p><strong>Bu adımda</strong> {purchase.method === 'Nakit' ? <>Kasadan {money(purchase.amount)} çıkar.</> : <>Kasadan çıkan {money(Math.abs(event.cashChange))} · Karta eklenen {money(purchase.amount)}.</>}</p>{purchase.method !== 'Nakit' && <p>Kasadan ödeme, ekstre ödeme adımlarındadır.</p>}</div>}
    <p className="timeline-purchase-status">Planlanan işlem · Gerçekleşmiş harcama değildir.</p>
  </>;
}

function PlannedCashPayment({ event, previous }: { event: FinanceEvent; previous?: FinanceEvent }) {
  return <>
    <dl className="timeline-purchase-facts">
      <div className="timeline-purchase-amount"><dt>Planlanan ödeme</dt><dd>{money(Math.abs(event.cashChange))}</dd></div>
      <div><dt>Ödeme tarihi</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
      <div><dt>Ödeme yöntemi</dt><dd>Elden nakit · Her cuma akşamı</dd></div>
    </dl>
    <div className="timeline-immediate-effect"><p><strong>Bu adımda</strong> Kasadan {money(Math.abs(event.cashChange))} çıkar.</p><p>Bu adımda yeni KMH kullanımı: {previous ? money(Math.max(0, Math.round((event.kmhPrincipal - previous.kmhPrincipal) * 100) / 100)) : 'doğrulanamadı'}.</p></div>
    <p className="timeline-purchase-status">Planlanan işlem · Gerçekleşmiş harcama değildir.</p>
  </>;
}

function PlainStep({ event }: { event: FinanceEvent }) {
  return <dl className="timeline-purchase-facts">
    <div className="timeline-purchase-amount"><dt>Net nakit etkisi</dt>{' '}<dd className="timeline-change" data-tone={tone(event.cashChange)}>{signedMoney(event.cashChange)}</dd></div>
    <div><dt>Tarih</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
  </dl>;
}

/** What happens, for how much, when and how: the first answer of every step. */
export function StepFacts({ event, purchase, previous }: { event: FinanceEvent; purchase: PurchaseDetails | null; previous?: FinanceEvent }) {
  const kind = isPurchase(event) ? 'purchase' : isWeeklyCash(event) ? 'cash' : 'plain';
  const label = kind === 'purchase' ? 'Planlanan alım bilgileri' : kind === 'cash' ? 'Planlanan nakit ödeme bilgileri' : 'Adım bilgileri';
  return <div className={kind === 'purchase' ? 'timeline-purchase' : kind === 'cash' ? 'timeline-cash-payment' : 'timeline-step-facts'} data-step-part="facts" role="group" aria-label={label}>
    {kind === 'purchase' ? <PlannedPurchase event={event} purchase={purchase} /> : kind === 'cash' ? <PlannedCashPayment event={event} previous={previous} /> : <PlainStep event={event} />}
  </div>;
}

export function FutureInstalments({ event }: { event: FinanceEvent }) {
  return <div className="timeline-future-instalments"><p><span>İki kartın gelecek taksitleri</span> <strong>{money(event.futureInstalments)}</strong></p><p>Toplam kart borcuna dahildir; bu adımın ödeme tutarı değildir.</p></div>;
}

/** Per-bank principal and cost after this step; grouped under the all-account state. */
function StepAccounts({ event }: { event: FinanceEvent }) {
  return <div className="timeline-account-breakdown" data-step-part="accounts">
    <h4>Borç dağılımı</h4>
    {accounts.map(([name, principal, cost]) => <div className="timeline-bank-group" role="group" aria-label={name} key={name}>
      <h5>{name}</h5>
      <dl><div><dt>Anapara</dt><dd>{money(event[principal])}</dd></div><div><dt>Faiz + vergi</dt><dd>{money(event[cost])}</dd></div></dl>
    </div>)}
    <FutureInstalments event={event} />
  </div>;
}

/** Cash and debt after this step, then the bank breakdown. */
export function StepAfter({ event }: { event: FinanceEvent }) {
  const title = isPurchase(event) ? 'Alım sonrası · tüm hesaplar' : 'Adım sonrası · tüm hesaplar';
  return <div className="timeline-account-state" data-step-part="after" role="group" aria-label={title}>
    <h4>Adım sonrası</h4>
    <dl className="timeline-balances" aria-label="Bu adımdan sonraki hesap bakiyesi">
      {balanceFields.slice(0, 2).map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={event[key] < 0 ? 'negative' : undefined}>{money(event[key])}</dd></div>)}
    </dl>
    <dl className="timeline-net-position"><div><dt>Net nakit konumu</dt><dd className={event.requiredBalance < 0 ? 'negative' : undefined}>{money(event.requiredBalance)}</dd></div></dl>
    <StepAccounts event={event} />
  </div>;
}

/** Certainty, source conditions and any funding gap; always open, never a disclosure. */
export function StepSource({ event }: { event: FinanceEvent }) {
  return <footer className="timeline-details" data-step-part="source">
    <p className="timeline-source"><strong className="timeline-source-label">Kaynak ve koşullar</strong>{event.certainty} · {event.source}</p>
    {event.fundingGap > 0 && <p className="negative">Fon eksiği {money(event.fundingGap)} · Kullanılabilir para değildir.</p>}
  </footer>;
}

export function StepCard({ event, number, purchase, previous }: { event: FinanceEvent; number: number; purchase: PurchaseDetails | null; previous?: FinanceEvent }) {
  const control = ['Kontrol', 'Ay sonu'].includes(event.type);
  return <li className={`timeline-step${isPurchase(event) ? ' timeline-purchase-step' : ''}${control ? ' timeline-control' : ''}`}>
    <article aria-label={`${number}. adım · ${event.title}`}>
      <div className="timeline-step-context">
        <StepIdentity event={event} number={number} />
        <StepFacts event={event} purchase={purchase} previous={previous} />
      </div>
      <StepAfter event={event} />
      <StepSource event={event} />
    </article>
  </li>;
}
