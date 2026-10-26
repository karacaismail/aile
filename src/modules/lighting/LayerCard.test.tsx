import { describe, it, expect } from 'vitest';
import { render, screen, userEvent } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { LayerCard } from './LayerCard';

const base: Item = {
  id: 'L1', tip: 'aydinlatma', ad: 'Salon ana', oda: 'salon', katman_tur: 'ana', katman_ad: 'Tavan çizgisel', amac: 'Genel aydınlatma',
  lux_min: 150, lux_max: 200, lux_duzlem: 'yatay', cct_mod: 'ayarli', cct_min: 2700, cct_max: 4000, cri_min: 80, r9_min: 50, flicker: 'ff',
  kontrol_cihaz: 'hue_dimmer', urun_sinifi: 'COB şerit 24V', tahmini_tl_min: 1000, tahmini_tl_max: 1500, adim: 'elektrik', kim: ['E', 'K'],
  uzunluk_m: 4, w_per_m: 10, surucu_w: 60,
};

function wrap(ui: React.ReactElement) {
  const loc = memoryLocation({ path: '/aydinlatma/salon', static: false, record: true });
  return { ...loc, ...render(<Router hook={loc.hook}>{ui}</Router>) };
}

describe('LayerCard', () => {
  it('spec satırları, rozetler ve sürücü payı', async () => {
    const { history } = wrap(<LayerCard layer={base} room={{ kopek_erisim: 'kapali' }} linkedCount={2} />);
    expect(screen.getByText('Tavan çizgisel')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Genel aydınlatma')).toBeInTheDocument();
    expect(screen.getByText(/150–200 lux/)).toBeInTheDocument();
    expect(screen.getByText(/2700–4000 K/)).toBeInTheDocument();
    expect(screen.getByText(/CRI 80/)).toBeInTheDocument();
    expect(screen.getByText(/R9 50/)).toBeInTheDocument();
    expect(screen.getByText('Flicker-free')).toBeInTheDocument();
    expect(screen.getByText('Hue Dimmer')).toBeInTheDocument();
    expect(screen.getByText('COB şerit 24V')).toBeInTheDocument();
    expect(screen.getByText('₺1.000–1.500')).toBeInTheDocument();
    expect(screen.getByText('Elektrik')).toBeInTheDocument();
    expect(screen.getByText('Elektrikçi')).toBeInTheDocument();
    expect(screen.getByText('Kendim')).toBeInTheDocument();
    expect(screen.getByText('2 ürün')).toBeInTheDocument();
    expect(screen.getByText('sürücü payı %50')).toBeInTheDocument();
    expect(screen.queryByText(/CRI < 90/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link'));
    expect(history.at(-1)).toBe('/aydinlatma/salon/L1');
  });
  it('görev katmanında CRI<90, köpek kuralı, yetersiz sürücü ve uzun şerit uyarıları', () => {
    wrap(<LayerCard layer={{ ...base, katman_tur: 'gorev', katman_ad: undefined, cri_min: 80, acikta: true, montaj_yukseklik_cm: 30, uzunluk_m: 6, surucu_w: 40 }} room={{ kopek_erisim: 'serbest' }} />);
    expect(screen.getByText('Görev')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Salon ana/ })).toBeInTheDocument();
    expect(screen.getByText('CRI < 90')).toBeInTheDocument();
    expect(screen.getByText('köpek kuralı')).toBeInTheDocument();
    expect(screen.getByText('sürücü yetersiz')).toBeInTheDocument();
    expect(screen.getByText('iki uçtan besleme')).toBeInTheDocument();
  });
  it('alan yoksa satır gizlenir', () => {
    wrap(<LayerCard layer={{ id: 'L2', tip: 'aydinlatma', ad: 'Boş', oda: 'salon' }} />);
    expect(screen.getByText('Boş')).toBeInTheDocument();
    expect(screen.queryByText(/lux/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ürün/)).not.toBeInTheDocument();
  });
});
