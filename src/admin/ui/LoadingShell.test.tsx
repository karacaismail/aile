import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LoadingShell } from './LoadingShell';

// Tasarım › Loading: aynı yerleşimde iskelet + üstte tek ince şerit; döner simge ve tam sayfa örtü yok.
// Seçiciler role/metin ve bileşenin kendi data-part sözleşmesi üzerinden; antd iç sınıfı yok.
const readCss = () => readFileSync(resolve(__dirname, 'LoadingShell.css'), 'utf8');

describe('LoadingShell', () => {
  it('announces loading politely and marks the region busy', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Yükleniyor');
    expect(status.querySelector('[data-stub]')).toBeNull();
  });

  it('announces the given label instead of the default', () => {
    render(<LoadingShell label="Alımlar okunuyor" />);
    expect(screen.getByRole('status')).toHaveTextContent('Alımlar okunuyor');
    expect(screen.queryByText('Yükleniyor')).toBeNull();
  });

  it('renders three placeholder rows by default, all hidden from assistive technology', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status');
    const rows = status.querySelectorAll('[data-part="row"]');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders the requested number of rows', () => {
    render(<LoadingShell rows={5} />);
    expect(screen.getByRole('status').querySelectorAll('[data-part="row"]')).toHaveLength(5);
  });

  it('falls back to three rows when rows is not a positive count', () => {
    const { rerender } = render(<LoadingShell rows={0} />);
    expect(screen.getByRole('status').querySelectorAll('[data-part="row"]')).toHaveLength(3);
    rerender(<LoadingShell rows={-2} />);
    expect(screen.getByRole('status').querySelectorAll('[data-part="row"]')).toHaveLength(3);
  });

  it('shows exactly one decorative strip above the rows', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status');
    const strips = status.querySelectorAll('[data-part="strip"]');
    expect(strips).toHaveLength(1);
    expect(strips[0]).toHaveAttribute('aria-hidden', 'true');
    const rows = status.querySelector('[data-part="rows"]');
    expect(rows).not.toBeNull();
    expect(strips[0].compareDocumentPosition(rows!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no digits, spinner or image while loading', () => {
    render(<LoadingShell rows={4} />);
    const status = screen.getByRole('status');
    expect(status.textContent).not.toMatch(/\d/);
    expect(status.querySelector('img, svg')).toBeNull();
    expect(status.querySelectorAll('[aria-hidden="true"] *').length).toBeGreaterThan(0);
  });

  it('switches between the wide and narrow row layouts', () => {
    const { rerender } = render(<LoadingShell />);
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'wide');
    rerender(<LoadingShell narrow />);
    expect(screen.getByRole('status')).toHaveAttribute('data-layout', 'narrow');
  });

  it('keeps a photo slot and text blocks in every row for both layouts', () => {
    const { rerender } = render(<LoadingShell rows={1} />);
    let row = screen.getByRole('status').querySelector('[data-part="row"]')!;
    expect(row.querySelectorAll('[data-part="photo"]')).toHaveLength(1);
    expect(row.querySelectorAll('[data-part="block"]').length).toBeGreaterThanOrEqual(2);
    rerender(<LoadingShell rows={1} narrow />);
    row = screen.getByRole('status').querySelector('[data-part="row"]')!;
    expect(row.querySelectorAll('[data-part="photo"]')).toHaveLength(1);
    expect(row.querySelectorAll('[data-part="block"]').length).toBeGreaterThanOrEqual(2);
  });

  describe('stylesheet', () => {
    it('keeps the strip still under reduced motion', () => {
      const css = readCss();
      expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
      expect(css).toMatch(/animation:\s*none/);
    });

    it('takes colour, radius and easing only from --aile tokens', () => {
      const css = readCss();
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\brgba?\(/);
      expect(css).toMatch(/var\(--aile-liste-zemin\)/);
      expect(css).toMatch(/var\(--aile-eylem\)/);
      expect(css).toMatch(/var\(--aile-egri\)/);
      expect(css).toMatch(/var\(--aile-kose-kart\)/);
    });

    it('draws no ring, outline or shadow', () => {
      const css = readCss();
      expect(css).not.toMatch(/outline|box-shadow/);
    });
  });
});
