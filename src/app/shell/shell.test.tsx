import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test-utils/render';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { BottomTabs } from './BottomTabs';
import { SideNav } from './SideNav';

describe('BottomTabs', () => {
  it('4 sekme, aktif olan aria-current', () => {
    const { hook } = memoryLocation({ path: '/aydinlatma/salon' });
    render(<Router hook={hook}><BottomTabs /></Router>);
    const tabs = screen.getAllByRole('link');
    expect(tabs).toHaveLength(4);
    expect(screen.getByTestId('tab-aydinlatma')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('tab-satinalma')).not.toHaveAttribute('aria-current');
  });
});

describe('SideNav', () => {
  it('4 modül + ayarlar bağlantısı, aktif olan aria-current', () => {
    const { hook } = memoryLocation({ path: '/tadilat/isler' });
    render(<Router hook={hook}><SideNav /></Router>);
    expect(screen.getByTestId('nav-tadilat')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-satinalma')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('nav-ayarlar')).toBeInTheDocument();
  });
});
