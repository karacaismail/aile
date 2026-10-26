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
  it('oda etiketi, ilerleme, rozetler ve CCT şeridi', () => {
    const { hook } = memoryLocation({ path: '/aydinlatma', static: false });
    render(<Router hook={hook}><RoomCard oda="cocuk" layers={[full, task, night]} /></Router>);
    const card = screen.getByTestId('room-card');
    expect(card).toHaveAttribute('data-oda', 'cocuk');
    expect(screen.getByText('Çocuk odası')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('3 katman')).toBeInTheDocument();
    expect(screen.getByText('gece')).toBeInTheDocument();
    expect(screen.getByText('görev CRI≥90')).toBeInTheDocument();
    expect(screen.queryByText(/yok$/)).not.toBeInTheDocument();
    expect(screen.getByTestId('cct-strip')).toHaveAttribute('data-cct', '2200-4000');
  });
  it('eksik temel katman uyarısı ve gri şerit; tıklama oda sayfasına gider', async () => {
    const { hook, history } = memoryLocation({ path: '/aydinlatma', static: false, record: true });
    render(<Router hook={hook}><RoomCard oda="salon" layers={[layer({ id: 'x', oda: 'salon', katman_tur: 'ikincil' })]} /></Router>);
    expect(screen.getByText('ana yok')).toBeInTheDocument();
    expect(screen.getByText('görev yok')).toBeInTheDocument();
    expect(screen.getByText('gece yok')).toBeInTheDocument();
    expect(screen.getByText('1 katman')).toBeInTheDocument();
    expect(screen.getByTestId('cct-strip')).toHaveAttribute('data-cct', 'none');
    await userEvent.click(screen.getByRole('link', { name: /Salon/ }));
    expect(history.at(-1)).toBe('/aydinlatma/salon');
  });
});
