import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TimelinePage from './TimelinePage';
import { buildFinance } from '../finance/data';
import { syntheticFinance, syntheticLongFinance } from '../finance/fixtures';
import { useFinance } from '../finance/useFinance';
import { FinancePeriodProvider, useFinancePeriod } from '../app/family/FinancePeriod';
import { useEffect } from 'react';

vi.mock('../finance/useFinance', () => ({ useFinance: vi.fn() }));
// The branded Select is covered in browser tests; use its value/onChange contract here.
vi.mock('../dashboard/Select', () => ({ Select: (props: { value: string; onChange: (value: string) => void; data: { value: string; label: string }[] }) => <select aria-label="Gösterilen dönem" value={props.value} onChange={event => props.onChange(event.target.value)}>{props.data.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select> }));
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const mount = () => render(<MantineProvider><TimelinePage /></MantineProvider>);
const panel = () => screen.getByRole('tabpanel');
const rows = () => screen.queryAllByRole('article').length || screen.queryAllByRole('row').length - 1;
function advanceFrame() {
  const pending = [...frames]; frames.clear();
  act(() => { pending.forEach(([, callback]) => callback(performance.now())); });
}
function selectPeriod(value: string) { fireEvent.change(screen.getByRole('combobox', { name: 'Gösterilen dönem' }), { target: { value } }); }
beforeEach(() => {
  frames.clear(); nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticLongFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('moves to the named next step and focuses its identity without changing the ledger or route', () => {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  mount();
  const first = screen.getAllByRole('article')[0];
  const second = screen.getAllByRole('article')[1];
  const totals = screen.getByRole('region', { name: 'Ocak 2098 özeti' }).textContent;
  fireEvent.click(within(first).getByRole('button', { name: /Sonraki adım.*Örnek adım 2/ }));
  expect(within(second).getByRole('heading', { level: 3 })).toHaveFocus();
  expect(second).toHaveAttribute('data-selected', 'true');
  expect(scroll).toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Ocak 2098 özeti' }).textContent).toBe(totals);
  fireEvent.click(within(second).getByRole('button', { name: /Önceki adım.*Örnek adım 1/ }));
  expect(within(first).getByRole('heading', { level: 3 })).toHaveFocus();
});

it('crosses a fifty-step page boundary and returns to the exact preceding step', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  mount(); selectPeriod('all'); advanceFrame(); advanceFrame(); advanceFrame();
  fireEvent.click(within(screen.getByRole('article', { name: /^50\. adım/ })).getByRole('button', { name: /Sonraki adım.*Örnek adım 51/ }));
  const next = screen.getByRole('article', { name: /^51\. adım/ });
  expect(within(next).getByRole('heading', { level: 3 })).toHaveFocus();
  fireEvent.click(within(next).getByRole('button', { name: /Önceki adım.*Örnek adım 50/ }));
  advanceFrame(); advanceFrame(); advanceFrame();
  expect(within(screen.getByRole('article', { name: /^50\. adım/ })).getByRole('heading', { level: 3 })).toHaveFocus();
});

it('states a generic card purchase as the principal added to the one card that moved, in flow and table, outside purchase and payment filters', () => {
  const data = buildFinance(syntheticLongFinance());
  // Only İşbank principal moves against the immediately preceding full-ledger step; cash does not move.
  Object.assign(data.events[4], { type: 'Kart alışverişi', title: 'İşbank · Okul yemeği', isPrincipal: 650, cardDebt: 862, source: 'Finansman motoru · Okul yemek kartı' });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  const step = screen.getByRole('article', { name: '5. adım · İşbank · Okul yemeği' });
  const facts = within(step).getByRole('group', { name: 'Kart harcaması bilgileri' });
  expect(within(facts).getByText('Karta eklenen anapara').nextElementSibling).toHaveTextContent('350 ₺');
  expect(facts).toHaveTextContent('5 Ocak 2098');
  expect(within(facts).getByText('Borcun eklendiği kart').nextElementSibling).toHaveTextContent('İşbank kredi kartı');
  expect(facts).toHaveTextContent('Kasadan çıkan 0 ₺');
  expect(within(step).queryByText('Net nakit etkisi')).not.toBeInTheDocument();
  expect(facts).not.toHaveTextContent('taksit');
  const expected = facts.textContent;
  fireEvent.click(screen.getByRole('tab', { name: 'Tablo' }));
  expect(within(screen.getByRole('row', { name: /Okul yemeği/ })).getByRole('group', { name: 'Kart harcaması bilgileri' }).textContent).toBe(expected);
  fireEvent.click(screen.getByRole('tab', { name: 'Zaman akışı' }));
  for (const filter of ['Alışveriş', 'Ödemeler']) {
    fireEvent.click(screen.getByRole('button', { name: filter }));
    expect(screen.queryByRole('article', { name: /Okul yemeği/ })).not.toBeInTheDocument();
  }
});

it('keeps an ambiguous or unmoved generic card purchase unknown instead of zero or a guessed card', () => {
  const data = buildFinance(syntheticLongFinance());
  Object.assign(data.events[4], { type: 'Kart alışverişi', title: 'Belirsiz kart alımı', isPrincipal: 650, denizPrincipal: 260 });
  Object.assign(data.events[6], { type: 'Kart alışverişi', title: 'Hareketsiz kart alımı' });
  Object.assign(data.events[8], { type: 'Kart alışverişi', title: 'Nakitli kart alımı', isPrincipal: 650, cashChange: -10 });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount(); advanceFrame();
  for (const title of ['Belirsiz kart alımı', 'Hareketsiz kart alımı', 'Nakitli kart alımı']) {
    const facts = within(screen.getByRole('article', { name: new RegExp(title) })).getByRole('group', { name: 'Kart harcaması bilgileri' });
    expect(within(facts).getByText('Karta eklenen anapara').nextElementSibling).toHaveTextContent('Tutar doğrulanamadı');
    expect(within(facts).getByText('Borcun eklendiği kart').nextElementSibling).toHaveTextContent('Kart doğrulanamadı');
    expect(facts).not.toHaveTextContent(/kredi kartı|0 ₺ ·/);
  }
});

it('pairs each after-step balance and the moved bank with its change against the preceding full-ledger step', () => {
  const data = buildFinance(syntheticLongFinance());
  Object.assign(data.events[4], { type: 'Kart alışverişi', title: 'İşbank · Okul yemeği', isPrincipal: 650, cardDebt: 862 });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  const after = within(screen.getByRole('article', { name: /^5\. adım/ })).getByRole('group', { name: 'Adım sonrası · tüm hesaplar' });
  expect(within(after).getByText('Toplam kart borcu').nextElementSibling).toHaveTextContent('862 ₺');
  expect(within(after).getByText('Toplam kart borcu').parentElement).toHaveTextContent('Bu adımda +350 ₺');
  expect(within(after).getByText('Harcanabilir nakit').parentElement).toHaveTextContent('Değişmedi');
  expect(within(after).getByRole('group', { name: 'İşbank kredi kartı' })).toHaveTextContent('Bu adımda +350 ₺');
  expect(within(after).getByRole('group', { name: 'Denizbank kredi kartı' })).not.toHaveTextContent('Bu adımda');
  // The ledger's first step has no predecessor: no movement is claimed.
  const opening = within(screen.getByRole('article', { name: /^1\. adım/ })).getByRole('group', { name: 'Adım sonrası · tüm hesaplar' });
  expect(opening).not.toHaveTextContent(/Bu adımda|Değişmedi/);
  // A filter never changes the predecessor: the movement still compares with step 4.
  fireEvent.click(screen.getByRole('button', { name: 'Ödemeler' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tüm adımlar' }));
  expect(within(screen.getByRole('article', { name: /^5\. adım/ })).getByText('Toplam kart borcu').parentElement).toHaveTextContent('Bu adımda +350 ₺');
});

it('marks where each step begins and ends: a kind-toned identity with the step number, then destination-named step links', () => {
  mount();
  const [first, second] = screen.getAllByRole('article');
  expect(first.querySelector('[data-step-part="identity"]')).toHaveAttribute('data-tone', 'neutral');
  expect(within(first).queryByRole('button', { name: /Önceki adım/ })).not.toBeInTheDocument();
  const links = within(second).getByRole('group', { name: '2. adımdan geçiş' });
  expect(within(links).getByRole('button', { name: /Önceki adım.*Örnek adım 1/ })).toBeVisible();
  expect(within(links).getByRole('button', { name: /Sonraki adım.*Örnek adım 3/ })).toHaveTextContent('3 Ocak');
});

it('compares a filtered step with its hidden full-ledger predecessor and links only to visible neighbours', () => {
  const data = buildFinance(syntheticLongFinance());
  // Steps 6 and 10 are payments; 7-9 stay hidden under Ödemeler. Step 5 (hidden) is the predecessor of 6.
  Object.assign(data.events[5], { title: 'Ödeme A', cashChange: -100, cash: 654221, requiredBalance: 654221 });
  for (const event of data.events.slice(6)) Object.assign(event, { cash: 654221, requiredBalance: 654221 });
  Object.assign(data.events[9], { title: 'Ödeme B', cashChange: -50, cash: 654171, requiredBalance: 654171 });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Ödemeler' }));
  const payment = screen.getByRole('article', { name: '6. adım · Ödeme A' });
  const after = within(payment).getByRole('group', { name: 'Adım sonrası · tüm hesaplar' });
  expect(within(after).getByText('Harcanabilir nakit').parentElement).toHaveTextContent('Bu adımda -100 ₺');
  expect(within(after).getByText('Net nakit konumu').parentElement).toHaveTextContent('Bu adımda -100 ₺');
  expect(within(payment).queryByRole('button', { name: /Önceki adım/ })).not.toBeInTheDocument();
  fireEvent.click(within(payment).getByRole('button', { name: /Sonraki adım · Adım 10 .*Ödeme B/ }));
  expect(within(screen.getByRole('article', { name: '10. adım · Ödeme B' })).getByRole('heading', { level: 3 })).toHaveFocus();
  // Changing the filter clears the step highlight; nothing is re-focused later.
  fireEvent.click(screen.getByRole('button', { name: 'Tüm adımlar' }));
  advanceFrame();
  expect(screen.getByRole('article', { name: '10. adım · Ödeme B' })).not.toHaveAttribute('data-selected');
  expect(document.activeElement).not.toBe(within(screen.getByRole('article', { name: '6. adım · Ödeme A' })).getByRole('heading', { level: 3 }));
});

it('says a filtered day count covers only the visible steps of that day', () => {
  const data = buildFinance(syntheticLongFinance());
  // Three steps on one day, two of them payments.
  for (const index of [1, 2, 3]) data.events[index].date = '2098-01-02';
  Object.assign(data.events[1], { cashChange: -10 }); Object.assign(data.events[3], { cashChange: -20 });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  const day = () => screen.getByRole('region', { name: /2 Ocak 2098/ });
  expect(day()).toHaveTextContent('3 adım');
  fireEvent.click(screen.getByRole('button', { name: 'Ödemeler' }));
  expect(day()).toHaveTextContent('2 görünen adım');
  expect(day()).not.toHaveTextContent(/(^|\D)3 adım/);
});

it('renders the first eight verified steps immediately, then sixteen per frame without changing source totals', () => {
  mount();
  expect(rows()).toBe(8);
  expect(panel()).toHaveAttribute('aria-busy', 'true');
  const summary = screen.getByRole('region', { name: 'Ocak 2098 özeti' });
  const totals = summary.textContent;
  expect(totals).toContain('654.321 ₺');
  advanceFrame(); expect(rows()).toBe(24);
  advanceFrame(); expect(rows()).toBe(28);
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(summary.textContent).toBe(totals);
  expect(frames.size).toBe(0);
  selectPeriod('all');
  expect(rows()).toBe(8);
  for (const count of [24, 40, 50]) { advanceFrame(); expect(rows()).toBe(count); }
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
  expect(screen.getAllByRole('article').at(-1)).toHaveAccessibleName(/^50\. adım/);
});

it('shares progressive source rows with table and cancels obsolete work on view, filter, period and page changes', () => {
  const view = mount();
  expect(rows()).toBe(8);
  const firstFrame = nextFrame;
  fireEvent.click(screen.getByRole('tab', { name: 'Tablo' }));
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(firstFrame);
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(rows()).toBe(8);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Örnek adım 1');
  advanceFrame(); expect(rows()).toBe(24);
  const tableFrame = nextFrame;
  fireEvent.click(screen.getByRole('button', { name: 'Alışveriş' }));
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(tableFrame);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Tüm adımlar' }));
  selectPeriod('2098-02');
  expect(rows()).toBe(8);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Örnek adım 29');
  selectPeriod('all');
  const next = within(screen.getByRole('navigation', { name: 'Adım sayfaları üst' })).getByRole('button', { name: 'Sonraki adımlar' });
  next.focus(); fireEvent.click(next);
  expect(rows()).toBe(8);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Örnek adım 51');
  for (const count of [24, 40, 50]) { advanceFrame(); expect(rows()).toBe(count); }
  expect(next).toHaveFocus();
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  fireEvent.click(next);
  expect(rows()).toBe(8);
  const unmountedFrame = nextFrame;
  view.unmount();
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(unmountedFrame);
  expect(frames.size).toBe(0);
});

it('keeps a complete visible page during a verified refresh with the same event identities', () => {
  const view = mount();
  advanceFrame(); advanceFrame();
  expect(rows()).toBe(28);
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticLongFinance()), loading: false, error: null, updatedAt: new Date(), refresh: vi.fn() });
  view.rerender(<MantineProvider><TimelinePage /></MantineProvider>);
  expect(rows()).toBe(28);
  expect(panel()).toHaveAttribute('aria-busy', 'false');
  expect(frames.size).toBe(0);
});

 it('shows finance cash and KMH independently, without treating net position as spendable cash', () => {
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  const step = screen.getByRole('article', { name: '1. adım · Sentetik dönem başlangıcı' });
  expect(within(step).getByText('Harcanabilir nakit').nextElementSibling).toHaveTextContent('0 ₺');
  expect(within(step).getByText('Net nakit konumu').nextElementSibling).toHaveTextContent('-50 ₺');
  const overdraft = within(step).getByRole('group', { name: 'KMH' });
  expect(within(overdraft).getByText('Anapara').nextElementSibling).toHaveTextContent('50 ₺');
  expect(within(overdraft).getByText('Faiz + vergi').nextElementSibling).toHaveTextContent('2 ₺');
  expect(within(step).getByText('Toplam kart borcu').nextElementSibling).toHaveTextContent('512 ₺');
  expect(within(step).getByText(/banka oranı teyitsiz/)).toBeVisible();
  expect(screen.queryByText(/nakit modeli KMH.*içermez/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Tablo' }));
  const row = screen.getAllByRole('row')[1];
  expect(row.querySelector('[data-balance="cash"]')).toHaveTextContent('0 ₺');
  expect(row.querySelector('[data-balance="requiredBalance"]')).toHaveTextContent('-50 ₺');
  expect(row.querySelector('[data-balance="kmhPrincipal"]')).toHaveTextContent('50 ₺');
});

it('preserves source cents and excludes internal transfers from the income filter', () => {
  const data = buildFinance(syntheticFinance());
  data.events[0].cardDebt = 512.49;
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  expect(screen.getByRole('article', { name: /1. adım/ })).toHaveTextContent('512,49 ₺');
  selectPeriod('2098-02');
  fireEvent.click(screen.getByRole('button', { name: 'Gelir' }));
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByText(/gelir adımı yok/)).toBeVisible();
});

it('filters before/after moving purchases chronologically in both views without changing balances', () => {
  const data = buildFinance(syntheticLongFinance());
  data.events[2].type = 'Alışveriş · Taşınma öncesi'; data.events[2].title = 'Koltuk siparişi';
  data.events[4].type = 'Kart alışverişi'; data.events[4].title = 'Elektrik faturası';
  data.events[28].type = 'Alışveriş · Taşınma sonrası'; data.events[28].title = 'Yatak';
  // A before-moving category can be scheduled later: never infer the group from its date.
  data.events[30].type = 'Alışveriş · Taşınma öncesi'; data.events[30].title = 'Perde';
  vi.mocked(useFinance).mockReturnValue({ data, loading:false, error:null, updatedAt:null, refresh:vi.fn() });
  mount(); selectPeriod('all');
  const summary = screen.getByRole('region', {name:'Tüm dönem özeti'}).textContent;
  fireEvent.click(screen.getByRole('button', {name:'Alışveriş'}));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  const groups=screen.getByRole('group',{name:'Alım grubu'});
  fireEvent.click(within(groups).getByRole('button',{name:'Taşınma öncesi'}));
  expect(screen.getAllByRole('article').map(el=>el.getAttribute('aria-label'))).toEqual(['3. adım · Koltuk siparişi','31. adım · Perde']);
  expect(screen.getByRole('region',{name:'Tüm dönem özeti'}).textContent).toBe(summary);
  fireEvent.click(screen.getByRole('tab',{name:'Tablo'}));
  expect(screen.getAllByRole('row').slice(1).map(el=>el.querySelector('time')?.dateTime)).toEqual(['2098-01-03','2098-02-03']);
  fireEvent.click(within(groups).getByRole('button',{name:'Taşınma sonrası'}));
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Yatak');
  selectPeriod('2098-01');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('Bu dönemde taşınma sonrası alımı yok.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Tüm dönemde göster'}));
  expect(screen.getAllByRole('row')[1]).toHaveTextContent('Yatak');
  expect(within(groups).getByRole('button',{name:'Taşınma sonrası'})).toHaveAttribute('aria-pressed','true');
});

it('puts purchase amount, date and payment before all-account balances in flow and table, using unfiltered predecessors', () => {
  const data = buildFinance(syntheticLongFinance());
  const cash = data.events[2], card = data.events[5];
  Object.assign(cash, {type:'Alışveriş · Taşınma öncesi',title:'Örnek abonelik',cashChange:-375,source:'Nakit · Nakit · Planlanan alım.'});
  Object.assign(card, {type:'Alışveriş · Taşınma öncesi',title:'Örnek mobilya',denizPrincipal:4920.5,cashChange:0,source:'Kredi kartı · Denizbank · Planlanan alım. Taksit: 6'});
  vi.mocked(useFinance).mockReturnValue({data,loading:false,error:null,updatedAt:null,refresh:vi.fn()});
  mount(); fireEvent.click(screen.getByRole('button',{name:'Alışveriş'}));
  const assertFacts = (container: HTMLElement, amount: string, date: string, method: string) => {
    const facts=within(container).getByRole('group', { name: 'Planlanan alım bilgileri' });
    expect(facts).toHaveTextContent(amount);expect(facts).toHaveTextContent(date);expect(facts).toHaveTextContent(method);
    expect(within(container).queryByText('Net nakit etkisi')).not.toBeInTheDocument();
  };
  const cardStep=screen.getByRole('article',{name:'6. adım · Örnek mobilya'});
  assertFacts(cardStep,'4.720,5 ₺','6 Ocak 2098','Denizbank kredi kartı');
  expect(cardStep).toHaveTextContent('6 taksit');
  const facts=within(cardStep).getByRole('group', { name: 'Planlanan alım bilgileri' });
  const balances=within(cardStep).getByRole('group',{name:'Alım sonrası · tüm hesaplar'});
  expect(facts.compareDocumentPosition(balances)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(balances).toHaveTextContent('İki kartın gelecek taksitleri');
  assertFacts(screen.getByRole('article',{name:'3. adım · Örnek abonelik'}),'375 ₺','3 Ocak 2098','Nakit');
  fireEvent.click(screen.getByRole('tab',{name:'Tablo'}));
  const tableRows=screen.getAllByRole('row');
  assertFacts(tableRows[1],'375 ₺','3 Ocak 2098','Nakit');
  assertFacts(tableRows[2],'4.720,5 ₺','6 Ocak 2098','Denizbank kredi kartı');
});

it('explains weekly tutoring as cash in hand and separates any incremental overdraft from the expense', () => {
  const data = buildFinance(syntheticFinance());
  Object.assign(data.events[1],{id:'week-0-etut-1',date:'2098-01-03',type:'Nakit hareketi',title:'Etüt (Abla)',cashChange:-420,source:'Kullanıcı teyidi · her cuma akşamı',kmhPrincipal:125});
  vi.mocked(useFinance).mockReturnValue({data,loading:false,error:null,updatedAt:null,refresh:vi.fn()});
  mount();
  const card=screen.getByRole('article',{name:'2. adım · Etüt (Abla)'});
  expect(card).toHaveTextContent('Elden nakit · Her cuma akşamı');
  expect(card).toHaveTextContent('Planlanan ödeme420 ₺');
  expect(card).toHaveTextContent('Bu adımda yeni KMH kullanımı: 75 ₺');
  expect(within(card).queryByText('Net nakit etkisi')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'Tablo'}));
  expect(screen.getByRole('row',{name:/Etüt/})).toHaveTextContent('Elden nakit · Her cuma akşamı');
});

it('exposes one reading order for every step and states a plain payment amount and date before the balances', () => {
  vi.mocked(useFinance).mockReturnValue({ data: buildFinance(syntheticFinance()), loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  const step = screen.getByRole('article', { name: '2. adım · Sentetik ay sonu' });
  expect([...step.querySelectorAll<HTMLElement>('[data-step-part]')].map(part => part.dataset.stepPart)).toEqual(['identity', 'facts', 'after', 'accounts', 'source']);
  const facts = within(step).getByRole('group', { name: 'Adım bilgileri' });
  expect(facts).toHaveTextContent('Net nakit etkisi +550 ₺');
  expect(facts).toHaveTextContent('31 Ocak 2098');
  const balances = within(step).getByRole('group', { name: 'Adım sonrası · tüm hesaplar' });
  expect(facts.compareDocumentPosition(balances) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(balances).getByRole('group', { name: 'KMH' }).closest('[data-step-part]')).toHaveAttribute('data-step-part', 'accounts');
  expect(within(step).getByText('Kaynak ve koşullar').closest('[data-step-part]')).toHaveAttribute('data-step-part', 'source');
  fireEvent.click(screen.getByRole('tab', { name: 'Tablo' }));
  expect(within(screen.getByRole('row', { name: /Sentetik ay sonu/ })).getByRole('group', { name: 'Adım bilgileri' })).toHaveTextContent('Net nakit etkisi +550 ₺');
});

it('offers an in-page jump between the period control and the always-open period details without changing route or filters', () => {
  const data = buildFinance(syntheticLongFinance());
  // Non-zero overdraft at the month end must be reachable from the top of a 28-step month.
  Object.assign(data.events[27], { kmhPrincipal: 125, kmhCost: 4 });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  const scrolled: Element[] = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Ödemeler' }));
  const control = screen.getByRole('complementary', { name: 'Dönem kontrolü' });
  const jump = within(control).getByRole('button', { name: 'Dönem ayrıntıları' });
  fireEvent.click(jump);
  const details = screen.getByRole('complementary', { name: 'Dönem ayrıntıları · Ocak 2098' });
  expect(details).toHaveFocus();
  expect(scrolled.at(-1)).toBe(details);
  expect(within(details).getByText('KMH anaparası').nextElementSibling).toHaveTextContent('125 ₺');
  expect(within(details).getByText('KMH faiz + vergi').nextElementSibling).toHaveTextContent('4 ₺');
  expect(screen.getByRole('button', { name: 'Ödemeler' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('combobox', { name: 'Gösterilen dönem' })).toHaveValue('2098-01');
  fireEvent.click(within(details).getByRole('button', { name: 'Dönem kontrolüne dön' }));
  expect(jump).toHaveFocus();
});

it('gives purchase and cash steps the same reading order and pairs principal with costs by account', () => {
  const data = buildFinance(syntheticLongFinance());
  Object.assign(data.events[2], { type: 'Alışveriş · Taşınma öncesi', title: 'Örnek alım', denizPrincipal: 700, source: 'Kredi kartı · Denizbank · Taksit: 6' });
  Object.assign(data.events[5], { id: 'week-0-etut-1', type: 'Nakit hareketi', title: 'Etüt (Abla)', cashChange: -420, source: 'Kullanıcı teyidi · her cuma akşamı' });
  vi.mocked(useFinance).mockReturnValue({ data, loading: false, error: null, updatedAt: null, refresh: vi.fn() });
  mount();
  for (const [number, title] of [[3, 'Örnek alım'], [6, 'Etüt (Abla)']] as const) {
    const step = screen.getByRole('article', { name: `${number}. adım · ${title}` });
    const headings = within(step).getAllByRole('heading').map(heading => heading.textContent);
    expect(headings).toEqual([title, 'Adım sonrası', 'Borç dağılımı', 'Denizbank kredi kartı', 'İşbank kredi kartı', 'KMH']);
    const facts = within(step).getByRole('group', { name: title === 'Örnek alım' ? 'Planlanan alım bilgileri' : 'Planlanan nakit ödeme bilgileri' });
    const balances = within(step).getByRole('group', { name: title === 'Örnek alım' ? 'Alım sonrası · tüm hesaplar' : 'Adım sonrası · tüm hesaplar' });
    expect(facts.compareDocumentPosition(balances) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const values = data.events[number - 1];
    for (const [name, principal, cost] of [['Denizbank kredi kartı', values.denizPrincipal, values.denizCost], ['İşbank kredi kartı', values.isPrincipal, values.isCost], ['KMH', values.kmhPrincipal, values.kmhCost]] as const) {
      const account = within(balances).getByRole('group', { name });
      expect(within(account).getByText('Anapara').nextElementSibling).toHaveTextContent(`${principal} ₺`);
      expect(within(account).getByText('Faiz + vergi').nextElementSibling).toHaveTextContent(`${cost} ₺`);
    }
    expect(within(step).getByText('Kaynak ve koşullar')).toBeVisible();
    expect(step.querySelector('details')).toBeNull();
  }
});

it('shows the actual prior-ledger KMH change beside a transfer without calling reserve income', () => {
  const data=buildFinance(syntheticLongFinance());
  Object.assign(data.events[0],{kmhPrincipal:3000,cash:0});
  Object.assign(data.events[1],{type:'Birikimden aktarım',title:'Birikimden aktarım',cashChange:5000,cash:2000,kmhPrincipal:0});
  vi.mocked(useFinance).mockReturnValue({data,loading:false,error:null,updatedAt:null,refresh:vi.fn()});
  mount();
  const step=screen.getByRole('article',{name:'2. adım · Birikimden aktarım'});
  const facts=within(step).getByRole('group',{name:'Adım bilgileri'});
  expect(within(facts).getByText('KMH anaparası değişimi')).toBeVisible();
  expect(within(facts).getByText('-3.000 ₺')).toBeVisible();
  expect(within(facts).getByText('+5.000 ₺')).toBeVisible();
  expect(within(step).getByRole('group',{name:'Adım sonrası · tüm hesaplar'})).toHaveTextContent('Harcanabilir nakit2.000 ₺');
  expect(step).not.toHaveTextContent('Gelir');
});

it('says so when the shared month is not in this ledger instead of silently showing another month', () => {
  function Preset() { const [, set] = useFinancePeriod(); useEffect(() => set('2099-05'), [set]); return null; }
  render(<MantineProvider><FinancePeriodProvider><Preset /><TimelinePage /></FinancePeriodProvider></MantineProvider>);
  expect(screen.getByRole('note', { name: 'Seçilen ay' })).toHaveTextContent('Mayıs 2099 bu hesapta yok; Ocak 2098 gösteriliyor.');
});
