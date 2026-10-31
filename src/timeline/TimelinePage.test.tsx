import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TimelinePage from './TimelinePage';
import { buildFinance } from '../finance/data';
import { syntheticFinance, syntheticLongFinance } from '../finance/fixtures';
import { useFinance } from '../finance/useFinance';

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
