import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccordionList } from './AccordionList';
import { Disclosure } from './Disclosure';
import { PivotStack } from './PivotStack';

// Hareket sözleşmesi: durum anında anlamsal olarak güncellenir; geçiş yalnız kullanıcının başlattığı değişikliği
// canlandırır. Açılan gövdeler 0fr → 1fr yükseklik geçişini @starting-style ile başlatır; bu kural varsayılan açık
// gövdeye ilk çizimde de uygulanırsa sayfa hazır olduktan sonra kayar ve geçiş sürerken gövdedeki düğmeye yapılan
// dokunuş boşa gidebilir (/ev telefon "Odayı aç"). Açılış geçişi yalnız kullanıcının aç/kapa yaptığı gövdede
// (data-gecis) çalışır.
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const PANELLER = [
  ['AccordionList.css', 'aile-acc-panel'],
  ['Disclosure.css', 'aile-disc-panel'],
  ['PivotStack.css', 'aile-pivot-panel'],
] as const;

/** Bir CSS metnindeki @starting-style bloklarının içindeki seçiciler (iç içe süslü parantez sayılarak). */
function startingSelectors(css: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@starting-style', from);
    if (at < 0) return out;
    const open = css.indexOf('{', at);
    let depth = 1;
    let i = open + 1;
    let selectorStart = i;
    while (depth > 0 && i < css.length) {
      const ch = css[i];
      if (ch === '{') {
        if (depth === 1) out.push(css.slice(selectorStart, i).trim());
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 1) selectorStart = i + 1;
      }
      i++;
    }
    from = i;
  }
}

const regionOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-controls')!)!;

describe('açılış geçişi yalnız kullanıcı aç/kapa yaptığında', () => {
  it.each(PANELLER)('%s: @starting-style gövde kuralı yalnız [data-gecis] gövdeye uygulanır', (file, panel) => {
    const selectors = startingSelectors(read(file)).filter(selector => selector.includes(panel));
    expect(selectors.length, `${file} açılış geçişi tanımlı`).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector, `${file}: ${selector}`).toMatch(/\[data-gecis\]/);
  });

  it('AccordionList: varsayılan açık ilk gövde geçişsiz çizilir; kullanıcı açtığı gövdede geçiş işareti olur', async () => {
    const user = userEvent.setup();
    render(
      <AccordionList
        items={[
          { key: 'a1', title: 'Salon', body: [['Planlanan', '₺8.500,00']] },
          { key: 'a2', title: 'Mutfak', body: [['Planlanan', '₺1.000,00']] },
        ]}
      />,
    );
    const ilk = screen.getByRole('button', { name: /Salon/ });
    const ikinci = screen.getByRole('button', { name: /Mutfak/ });
    expect(ilk).toHaveAttribute('aria-expanded', 'true');
    expect(regionOf(ilk)).not.toHaveAttribute('data-gecis');
    await user.click(ikinci);
    expect(ikinci).toHaveAttribute('aria-expanded', 'true');
    expect(regionOf(ikinci)).toHaveAttribute('data-gecis');
    expect(regionOf(ilk)).not.toHaveAttribute('data-gecis');
  });

  it('AccordionList: "Tümünü aç" kullanıcı eylemidir, açtığı gövdelerde geçiş işareti olur', async () => {
    const user = userEvent.setup();
    render(
      <AccordionList
        caption="Odalar"
        items={[
          { key: 'a1', title: 'Salon', body: [['Planlanan', '₺8.500,00']] },
          { key: 'a2', title: 'Mutfak', body: [['Planlanan', '₺1.000,00']] },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Tümünü aç' }));
    expect(regionOf(screen.getByRole('button', { name: /Mutfak/ }))).toHaveAttribute('data-gecis');
  });

  it('Disclosure: defaultOpen geçişsiz; kullanıcı açınca geçiş işareti olur', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Disclosure title="Oda" defaultOpen><p>Salon</p></Disclosure>);
    expect(screen.getByRole('region', { name: 'Oda' })).not.toHaveAttribute('data-gecis');
    unmount();
    render(<Disclosure title="Oda"><p>Salon</p></Disclosure>);
    await user.click(screen.getByRole('button', { name: 'Oda' }));
    expect(screen.getByRole('region', { name: 'Oda' })).toHaveAttribute('data-gecis');
  });

  it('PivotStack: ilk açık satır geçişsiz; kullanıcı açtığı satırda geçiş işareti olur', async () => {
    const user = userEvent.setup();
    render(<PivotStack columns={['Önce', 'Sonra']} rows={[['Salon', [[100, 50], [null, null]]], ['Mutfak', [[200, null], [10, 5]]]]} />);
    const ilk = screen.getByRole('button', { name: /^Salon/ });
    const ikinci = screen.getByRole('button', { name: /^Mutfak/ });
    expect(ilk).toHaveAttribute('aria-expanded', 'true');
    expect(regionOf(ilk)).not.toHaveAttribute('data-gecis');
    await user.click(ikinci);
    expect(regionOf(ikinci)).toHaveAttribute('data-gecis');
  });
});
