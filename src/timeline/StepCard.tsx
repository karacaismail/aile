import { financeMoney as money } from '../finance/format';
import type { FinanceEvent } from '../finance/data';
import { dateLabel } from './data';
import { cardCharge, isCardCharge, isPurchase, stepChange, type PurchaseDetails } from './purchase';
import { SourceNote } from '../components/Info';

/**
 * One ledger step, one reading order. Every part answers the next question of
 * the family's journey and carries `data-step-part` so CSS and regression tests
 * share a single contract instead of inferring the order from class names:
 *   identity → facts (what, how much, when, how) → after (cash and debt after
 *   this step, each with its change) → accounts (per bank) → source (conditions
 *   and certainty). Step links close the card and name the destination step.
 * Flow and table views compose the same parts; no part recalculates finance:
 * changes are plain differences against the preceding unfiltered ledger step.
 */
export const stepParts = ['identity', 'facts', 'after', 'accounts', 'source'] as const;
export type StepPart = typeof stepParts[number];

const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
const tone = (value: number) => value > 0 ? 'inflow' : value < 0 ? 'outflow' : 'neutral';

/** Kind tone of a step; always shown together with the visible kind label, never colour alone. */
export function stepTone(event: FinanceEvent) {
  if (event.type === 'Gelir') return 'income';
  if (event.cashChange < 0) return 'outflow';
  if (isPurchase(event) || isCardCharge(event)) return 'card';
  if (event.cashChange > 0) return 'transfer';
  return 'neutral';
}

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
export const stepHeadingId = (id: string) => `timeline-step-${id}`;

/** Kind, position and title: where this step begins. The heading is the focus target of step links. */
export function StepIdentity({ event, number }: { event: FinanceEvent; number: number }) {
  return <header className="timeline-step-identity" data-step-part="identity" data-tone={stepTone(event)}>
    <p className="timeline-meta"><span className="timeline-kind" data-kind={event.type}>{event.type}</span><span className="timeline-step-number">Adım {number}</span></p>
    <h3 id={stepHeadingId(event.id)} tabIndex={-1}>{event.title}</h3>
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

/** Engine card purchase: the principal added to the single card that moved; anything else stays unknown. */
function PlannedCardCharge({ event, previous }: { event: FinanceEvent; previous?: FinanceEvent }) {
  const charge = cardCharge(event, previous);
  return <>
    <dl className="timeline-purchase-facts">
      <div className="timeline-purchase-amount"><dt>Karta eklenen anapara</dt><dd>{charge ? money(charge.amount) : <span className="timeline-missing">Tutar doğrulanamadı</span>}</dd></div>
      <div><dt>İşlem tarihi</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
      <div><dt>Borcun eklendiği kart</dt><dd>{charge?.card ?? 'Kart doğrulanamadı'}</dd></div>
    </dl>
    {charge && <div className="timeline-immediate-effect"><p><strong>Bu adımda</strong> Kasadan çıkan {money(Math.abs(event.cashChange))} · {charge.card} anaparasına eklenen {money(charge.amount)}.</p><p>Kasadan ödeme, ekstre ödeme adımlarındadır.</p></div>}
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

function PlainStep({ event, previous }: { event: FinanceEvent; previous?: FinanceEvent }) {
  const kmhChange = previous ? Math.round((event.kmhPrincipal - previous.kmhPrincipal) * 100) / 100 : 0;
  return <><dl className="timeline-purchase-facts">
    <div className="timeline-purchase-amount"><dt>Net nakit etkisi</dt>{' '}<dd className="timeline-change" data-tone={tone(event.cashChange)}>{signedMoney(event.cashChange)}</dd></div>
    <div><dt>Tarih</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
  </dl>{kmhChange !== 0 && <dl className="timeline-step-effect" role="group" aria-label="Bu işlemin dağılımı">
    {/* Where the net amount went, from the full-ledger predecessor: the overdraft principal first, the rest to spendable cash. */}
    <div><dt>KMH anaparası değişimi</dt><dd>{signedMoney(kmhChange)}</dd></div>
    <div><dt>Harcanabilir nakde yansıyan</dt><dd>{signedMoney(stepChange(event, previous, 'cash') ?? 0)}</dd></div>
  </dl>}</>;
}

/** The opening row is the starting account state, not a payment: its key figure is the opening net position, labelled as state. */
function OpeningState({ event }: { event: FinanceEvent }) {
  return <><dl className="timeline-purchase-facts">
    <div className="timeline-purchase-amount"><dt>Açılış net nakit konumu</dt><dd className={event.requiredBalance < 0 ? 'negative' : undefined}>{money(event.requiredBalance)}</dd></div>
    <div><dt>Tarih</dt><dd><time dateTime={event.date}>{dateLabel(event.date)}</time></dd></div>
  </dl><p className="timeline-purchase-status">Dönem başındaki hesap durumu; bir ödeme veya tahsilat değildir.</p></>;
}

const factKinds = {
  purchase: ['timeline-purchase', 'Planlanan alım bilgileri'],
  card: ['timeline-purchase timeline-card-charge', 'Kart harcaması bilgileri'],
  cash: ['timeline-cash-payment', 'Planlanan nakit ödeme bilgileri'],
  plain: ['timeline-step-facts', 'Adım bilgileri'],
  opening: ['timeline-step-facts timeline-opening', 'Açılış durumu'],
} as const;

/** What happens, for how much, when and how: the first answer of every step. */
export function StepFacts({ event, purchase, previous }: { event: FinanceEvent; purchase: PurchaseDetails | null; previous?: FinanceEvent }) {
  const kind = isPurchase(event) ? 'purchase' : isCardCharge(event) ? 'card' : isWeeklyCash(event) ? 'cash' : event.type === 'Başlangıç' ? 'opening' : 'plain';
  const [className, label] = factKinds[kind];
  return <div className={className} data-step-part="facts" role="group" aria-label={label}>
    {kind === 'purchase' ? <PlannedPurchase event={event} purchase={purchase} /> : kind === 'card' ? <PlannedCardCharge event={event} previous={previous} /> : kind === 'cash' ? <PlannedCashPayment event={event} previous={previous} /> : kind === 'opening' ? <OpeningState event={event} /> : <PlainStep event={event} previous={previous} />}
  </div>;
}

export function FutureInstalments({ event }: { event: FinanceEvent }) {
  return <div className="timeline-future-instalments"><p><span>İki kartın gelecek taksitleri</span> <strong>{money(event.futureInstalments)}</strong></p><p>Toplam kart borcuna dahildir; bu adımın ödeme tutarı değildir.</p></div>;
}

/** Change against the preceding ledger step; nothing is claimed for the ledger's first step. Only cash is toned: lower debt is not an outflow. */
function Change({ value, quiet = false, toned = true }: { value: number | null; quiet?: boolean; toned?: boolean }) {
  if (value === null || (quiet && value === 0)) return null;
  return <dd className="timeline-balance-change" data-tone={value === 0 || !toned ? 'none' : tone(value)}>{value === 0 ? 'Değişmedi' : <>Bu adımda <span className="timeline-amount">{signedMoney(value)}</span></>}</dd>;
}

/** Per-bank principal and cost after this step; a bank whose principal moved carries that change. */
function StepAccounts({ event, previous }: { event: FinanceEvent; previous?: FinanceEvent }) {
  return <div className="timeline-account-breakdown" data-step-part="accounts">
    <h4>Borç dağılımı</h4>
    {accounts.map(([name, principal, cost]) => {
      const moved = stepChange(event, previous, principal);
      return <div className="timeline-bank-group" role="group" aria-label={name} key={name} data-moved={moved ? 'true' : undefined}>
        <h5>{name}</h5>
        <dl><div><dt>Anapara</dt><dd>{money(event[principal])}</dd><Change value={moved} quiet /></div><div><dt>Faiz + vergi</dt><dd>{money(event[cost])}</dd></div></dl>
      </div>;
    })}
    <FutureInstalments event={event} />
  </div>;
}

/** Cash and debt after this step with their change, then the bank breakdown. Net position also shows a non-zero change, because spendable cash stays 0 while it falls. */
export function StepAfter({ event, previous }: { event: FinanceEvent; previous?: FinanceEvent }) {
  const title = isPurchase(event) ? 'Alım sonrası · tüm hesaplar' : 'Adım sonrası · tüm hesaplar';
  return <div className="timeline-account-state" data-step-part="after" role="group" aria-label={title}>
    <div className="timeline-result"><h4>Adım sonrası</h4>
    <dl className="timeline-balances" aria-label="Bu adımdan sonraki hesap bakiyesi">
      {balanceFields.slice(0, 2).map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={event[key] < 0 ? 'negative' : undefined}>{money(event[key])}</dd><Change value={stepChange(event, previous, key)} toned={key === 'cash'} /></div>)}
    </dl>
    <dl className="timeline-net-position"><div><dt>Net nakit konumu</dt><dd className={event.requiredBalance < 0 ? 'negative' : undefined}>{money(event.requiredBalance)}</dd><Change value={stepChange(event, previous, 'requiredBalance')} quiet /></div></dl>
    </div><StepAccounts event={event} previous={previous} />
  </div>;
}

/** Certainty, source conditions and any funding gap; always open, never a disclosure. */
export function StepSource({ event }: { event: FinanceEvent }) {
  return <footer className="timeline-details" data-step-part="source">
    <SourceNote label="Kaynak ve koşullar">{event.certainty} · {event.source}</SourceNote>
    {event.fundingGap > 0 && <p className="negative">Fon eksiği {money(event.fundingGap)} · Kullanılabilir para değildir.</p>}
  </footer>;
}

export type StepNeighbour = { id: string; number: number; title: string; date: string };
export type StepLinks = { previous?: StepNeighbour; next?: StepNeighbour; onStep: (id: string) => void; onEnd: () => void };

/** The end of a step: destination-named links to the neighbouring visible steps, across page boundaries. */
function StepLinksNav({ number, links }: { number: number; links: StepLinks }) {
  const link = (direction: 'previous' | 'next', target: StepNeighbour) => <button type="button" className="timeline-step-link" data-direction={direction} onClick={() => links.onStep(target.id)}>
    <span className="timeline-step-link-label">{direction === 'previous' && <span aria-hidden="true">← </span>}{direction === 'previous' ? 'Önceki adım' : 'Sonraki adım'} · Adım {target.number} · {dateLabel(target.date)}{direction === 'next' && <span aria-hidden="true"> →</span>}</span>
    <span className="timeline-step-link-target">{target.title}</span>
  </button>;
  return <div className="timeline-step-links" role="group" aria-label={`${number}. adımdan geçiş`}>
    {links.previous ? link('previous', links.previous) : <span className="timeline-step-link-edge">Görünen ilk adım</span>}
    {links.next ? link('next', links.next) : <button type="button" className="timeline-step-link" data-direction="next" onClick={links.onEnd}><span className="timeline-step-link-label">Görünen son adım</span><span className="timeline-step-link-target">Dönem ayrıntılarına geç</span></button>}
  </div>;
}

export function StepCard({ event, number, purchase, previous, links, selected = false }: { event: FinanceEvent; number: number; purchase: PurchaseDetails | null; previous?: FinanceEvent; links?: StepLinks; selected?: boolean }) {
  const control = ['Kontrol', 'Ay sonu'].includes(event.type);
  return <li className={`timeline-step${isPurchase(event) ? ' timeline-purchase-step' : ''}${control ? ' timeline-control' : ''}`}>
    <article aria-label={`${number}. adım · ${event.title}`} data-tone={stepTone(event)} data-selected={selected ? 'true' : undefined}>
      <div className="timeline-step-context">
        <StepIdentity event={event} number={number} />
        <StepFacts event={event} purchase={purchase} previous={previous} />
      </div>
      <StepAfter event={event} previous={previous} />
      <StepSource event={event} />
      {links && <StepLinksNav number={number} links={links} />}
    </article>
  </li>;
}
