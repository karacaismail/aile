import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Money, formatMoney, parseMoneyInput } from './Money';
import type { Money as MoneyValue } from '../shell/contracts';

// Tasarım README › İçerik ilkeleri: "Para: ₺8.500,00 (tr-TR, iki ondalık), tutar stiliyle, tablo ve satırda sağa
// hizalı." Eksik bilgi saklanmaz, adıyla yazılır ("Fiyat yok", "Henüz yok", "Bilinmiyor"); ₺0,00 asla eksiğin yerine
// geçmez. Hata metni örneği: "Hata: Tutar yalnız rakam ve virgül içerebilir." → giriş ondalığı virgüldür, nokta binlik.
// Veri platformu tutarı metin ondalık taşır ("8500.00"); panel sayıya çevirip yuvarlamaz.
const TRY = (amount: string): MoneyValue => ({ amount, currency: 'TRY' });

describe('formatMoney', () => {
  it('writes TRY as ₺8.500,00: tr-TR, two decimals, grouping with a dot', () => {
    expect(formatMoney(TRY('8500.00'))).toBe('₺8.500,00');
    expect(formatMoney(TRY('8500'))).toBe('₺8.500,00');
    expect(formatMoney(TRY('40425.9'))).toBe('₺40.425,90');
    expect(formatMoney(TRY('0'))).toBe('₺0,00');
    expect(formatMoney(TRY('-1234.5'))).toBe('-₺1.234,50');
  });

  it('keeps the decimal text exact instead of rounding through a float', () => {
    expect(formatMoney(TRY('12345678901234567890.12'))).toBe('₺12.345.678.901.234.567.890,12');
  });

  it('formats other ISO 4217 codes in the same tr-TR layout', () => {
    expect(formatMoney({ amount: '8500.00', currency: 'EUR' })).toBe('€8.500,00');
    expect(formatMoney({ amount: '8500.00', currency: 'USD' })).toBe('$8.500,00');
  });

  it('does not throw on a malformed currency code: writes the number and the code as given', () => {
    const text = formatMoney({ amount: '8500.00', currency: 'TL' });
    expect(text).toContain('8.500,00');
    expect(text).toContain('TL');
  });

  it('names a missing value with the given text and never writes ₺0,00 for it', () => {
    expect(formatMoney(null)).toBe('Fiyat yok');
    expect(formatMoney(undefined)).toBe('Fiyat yok');
    expect(formatMoney(null, 'Henüz yok')).toBe('Henüz yok');
    expect(formatMoney(undefined, 'Henüz yok')).toBe('Henüz yok');
  });

  it('does not claim absence for a malformed amount: writes "Bilinmiyor"', () => {
    expect(formatMoney(TRY('abc'))).toBe('Bilinmiyor');
    expect(formatMoney(TRY(''))).toBe('Bilinmiyor');
    expect(formatMoney(TRY('8.500,00'))).toBe('Bilinmiyor');
    expect(formatMoney(TRY('abc'), 'Henüz yok')).not.toBe('Henüz yok');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['8.500,50', '8500.50'],
    ['8500,5', '8500.50'],
    ['8500', '8500.00'],
    ['0,99', '0.99'],
    ['1.234.567,89', '1234567.89'],
    ['  8.500,50  ', '8500.50'],
    ['₺8.500,50', '8500.50'],
    ['₺ 8.500,50', '8500.50'],
    ['8.500,50 TL', '8500.50'],
    ['8.500,50 tl', '8500.50'],
    ['-250,00', '-250.00'],
    ['007,5', '7.50'],
  ])('reads %j as the decimal text %j (comma decimal, dot grouping)', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['8.5'],
    ['8500.50'],
    ['8,500.50'],
    ['8.500,505'],
    ['12.34,5'],
    ['1.2345,00'],
    [',50'],
    ['8 500,50'],
    ['8.500,50 EUR'],
  ])('returns null for %j instead of guessing', input => {
    expect(parseMoneyInput(input)).toBeNull();
  });

  it('normalises a negative zero to 0.00', () => {
    expect(parseMoneyInput('-0,00')).toBe('0.00');
  });

  it('round-trips a formatted amount back to the platform decimal', () => {
    const value = TRY('8500.50');
    expect(parseMoneyInput(formatMoney(value))).toBe(value.amount);
  });
});

describe('Money', () => {
  it('renders the formatted amount in a span.aile-tutar (tabular-nums, right-aligned by admin.css)', () => {
    const { container } = render(<Money value={TRY('8500.00')} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.className.split(' ')).toContain('aile-tutar');
    expect(root.className).not.toContain('aile-tutar--eksik');
    expect(root).not.toHaveAttribute('data-missing');
    expect(root).not.toHaveAttribute('role');
    expect(root.textContent).toBe('₺8.500,00');
    expect(screen.getByText('₺8.500,00')).toBeInTheDocument();
  });

  it('names a missing plan value "Fiyat yok" by default and marks the span as missing', () => {
    const { container } = render(<Money value={null} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.textContent).toBe('Fiyat yok');
    expect(root.className.split(' ')).toEqual(expect.arrayContaining(['aile-tutar', 'aile-tutar--eksik']));
    expect(root).toHaveAttribute('data-missing', 'true');
    expect(container.textContent).not.toContain('₺');
  });

  it('uses the given label for a missing actual value ("Henüz yok")', () => {
    render(<Money value={undefined} label="Henüz yok" />);
    expect(screen.getByText('Henüz yok')).toBeInTheDocument();
    expect(screen.queryByText('Fiyat yok')).toBeNull();
  });

  it('keeps the label out of the way when a value exists', () => {
    render(<Money value={TRY('120.00')} label="Henüz yok" />);
    expect(screen.getByText('₺120,00')).toBeInTheDocument();
    expect(screen.queryByText('Henüz yok')).toBeNull();
  });

  it('marks a malformed amount as missing and writes "Bilinmiyor"', () => {
    const { container } = render(<Money value={TRY('n/a')} label="Henüz yok" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.textContent).toBe('Bilinmiyor');
    expect(root).toHaveAttribute('data-missing', 'true');
  });

  it('accepts the shared contracts Money shape, an id and extra class names', () => {
    const planned: MoneyValue | null = { amount: '97800.00', currency: 'TRY' };
    const { container } = render(<Money value={planned} id="plan-1" className="ek" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('id', 'plan-1');
    expect(root.className.split(' ')).toEqual(expect.arrayContaining(['aile-tutar', 'ek']));
    expect(root.textContent).toBe('₺97.800,00');
  });

  it('styles only through --aile-* tokens: no literal colours, pixel sizes, outlines or shadows in its CSS', () => {
    const css = readFileSync(resolve(__dirname, 'Money.css'), 'utf8');
    expect(css).toContain('var(--aile-');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/[1-9][0-9]*(\.[0-9]+)?px/);
    expect(css).not.toMatch(/outline|box-shadow|border-left|border-right|border-top|border-bottom/);
  });
});
