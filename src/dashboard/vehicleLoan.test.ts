import { describe, expect, it } from 'vitest';
import { readVehicleLoan } from './data';

const rows = [
  ['Taşınma tarihi', 'Date(2027,5,20)'],
  ['Araç peşinatı toplamı ₺', 350000], ['Araç kredisi tutarı ₺', 120000], ['Kredi vadesi (ay)', 36],
  ['Kredinin yıllık faizi', 0.615], ['Faiz vergisi (KKDF + BSMV)', 0.3], ['İlk taksit tarihi', 'Date(2027,1,15)'],
  ['Aylık taksit ₺', 7531.81], ['Birikimden peşinat ₺', 230000], ['Taşıt kredisi aylık faizi', 0.035],
];

describe('readVehicleLoan', () => {
  it('reads every vehicle loan input from the Parametreler rows by label', () => {
    expect(readVehicleLoan(rows)).toEqual({ downPayment: 350000, loanAmount: 120000, months: 36, annualRate: 0.615, taxRate: 0.3, firstInstalment: '2027-02-15', instalment: 7531.81, cashDownPayment: 230000, autoMonthlyRate: 0.035 });
  });
  it('returns null instead of inventing a value when a required cell is missing', () => {
    expect(readVehicleLoan(rows.filter(r => r[0] !== 'Kredinin yıllık faizi'))).toBeNull();
  });
  it('reads the first instalment from a Sheets date serial as GViz sends it', () => {
    expect(readVehicleLoan(rows.map(r => r[0] === 'İlk taksit tarihi' ? [r[0], 46433] : r))?.firstInstalment).toBe('2027-02-15');
  });
  it('keeps an absent car-loan rate unknown', () => {
    expect(readVehicleLoan(rows.filter(r => r[0] !== 'Taşıt kredisi aylık faizi'))?.autoMonthlyRate).toBeNull();
  });
});
