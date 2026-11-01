import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FactList, SectionHeading, SourceNote, JourneyLinks } from './Info';
afterEach(cleanup);
it('keeps a missing amount distinct from zero and its source qualification with the value', () => {
  render(<FactList label="Alım bilgileri" items={[
    { label: 'Planlanan alım', value: null, detail: 'Fiyat bekleniyor' },
    { label: 'Kasadan çıkan', value: 0, detail: 'Ödeme ekstre adımında' },
  ]} />);
  const facts=screen.getByRole('group',{name:'Alım bilgileri'});
  expect(within(facts).getByText('Belirtilmedi')).toBeVisible();
  const amount=within(facts).getByText('0');
  expect(amount.closest('dd')).toHaveTextContent('Ödeme ekstre adımında');
  expect(facts.querySelectorAll('dt')).toHaveLength(2);
});
it('keeps heading actions and explanatory source separate from page-to-page links', () => {
  render(<><SectionHeading title="Alım planı" level={3} description="Planlanan tutarlar" actions={<button>Filtrele</button>} />
    <SourceNote label="Hazırlık kaydı">Teslim durumu ödeme kanıtı değildir.</SourceNote>
    <JourneyLinks label="Sıradaki işlem" items={[{href:'#/butce/yeni',label:'Harcama kaydet'}]} /></>);
  expect(screen.getByRole('heading',{name:'Alım planı',level:3})).toBeVisible();
  expect(screen.getByText('Teslim durumu ödeme kanıtı değildir.')).toBeVisible();
  expect(within(screen.getByRole('navigation',{name:'Sıradaki işlem'})).getByRole('link',{name:'Harcama kaydet'})).toHaveAttribute('href','#/butce/yeni');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});
