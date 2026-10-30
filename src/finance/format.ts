const currency = new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 2,
});

export const financeMoney = (value: number) => currency.format(value).replace('₺', '').trim() + ' ₺';
