import { describe, it, expect } from 'vitest';
import { render, screen, userEvent } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Item } from '@shared/schema';
import { RoomCard } from './RoomCard';

const layer = (p: Partial<Item>): Item => ({ id: p.id ?? 'L', tip: 'aydinlatma', ad: 'Katman', oda: 'cocuk', ...p });
const full = layer({ id: '1', katman_tur: 'ana', lux_min: 150, cct_min: 2700, cct_max: 4000, kontrol_cihaz: 'hue_dimmer' });
const task = layer({ id: '2', katman_tur: 'gorev', cri_min: 95, cct_min: 4000 });
const night = layer({ id: '3', katman_tur: 'gece', cct_min: 2200, cct_max: 2200 });

describe('RoomCard', () => {
  // Tur 5: '1/3' halkası ve '3 katman' rozeti tek sayım metnine, 'gece' rozeti kapsam cümlesine, süs şeridi metinli olguya dönüştü.
  it('oda etiketi, ilerleme, kapsam ve ışık rengi', () => {
    const { hook } = memoryLocation({ path: '/aydinlatma', static: false });
    render(<Router hook={hook}><RoomCard oda="cocuk" layers={[full, task, night]} /></Router>);
    const card = screen.getByTestId('room-card');
    expect(card).toHaveAttribute('data-oda', 'cocuk');
    expect(screen.getByText('Çocuk odası')).toBeInTheDocument();
    expect(screen.getByText('3 katman · 1 tanesi tam tanımlı')).toBeInTheDocument();
    expect(screen.getByText('Ana, görev, gece var')).toBeInTheDocument();
    expect(screen.getByText('Görev katmanında CRI ≥ 90')).toBeInTheDocument();
    expect(screen.queryByText(/yok$|^Eksik/)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Çocuk odası ışık rengi' })).toHaveTextContent('2200–4000 K');
  });
  it('eksik temel katmanlar tek cümle; renk yoksa ışık rengi olgusu yok; tıklama oda sayfasına gider', async () => {
    const { hook, history } = memoryLocation({ path: '/aydinlatma', static: false, record: true });
    render(<Router hook={hook}><RoomCard oda="salon" layers={[layer({ id: 'x', oda: 'salon', katman_tur: 'ikincil' })]} /></Router>);
    expect(screen.getByText('Eksik: ana, görev, gece')).toBeInTheDocument();
    expect(screen.getByText('1 katman · 0 tanesi tam tanımlı')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /ışık rengi/ })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: /Salon/ }));
    expect(history.at(-1)).toBe('/aydinlatma/salon');
  });
});
