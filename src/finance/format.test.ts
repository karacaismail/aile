import { expect, it } from 'vitest';
import { financeMoney } from './format';

it('shows a positive sub-lira obligation instead of rounding it to zero', () => {
  expect(financeMoney(.49)).toMatch(/^0,49\s₺$/);
});

it('preserves instalment cents without adding decimals to whole amounts', () => {
  expect(financeMoney(12222.22)).toMatch(/^12\.222,22\s₺$/);
  expect(financeMoney(500)).toMatch(/^500\s₺$/);
});
