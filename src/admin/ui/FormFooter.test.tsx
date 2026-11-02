import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { FormFooter, type FormFooterProps } from './FormFooter';

// Button ayrı görevde gerçek bileşen olur; burada tasarım ButtonProps biçimini (variant, block, disabled, onClick,
// children) koruyan düz bir düğme ile değiştirilir. Testler FormFooter'ın yerleşimini ve davranışını ölçer.
vi.mock('./Button', () => ({
  Button: ({ children, onClick, disabled, variant, block, 'aria-describedby': describedBy }: { children?: ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; block?: boolean; 'aria-describedby'?: string }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant} data-block={block ? 'true' : undefined} aria-describedby={describedBy}>{children}</button>
  ),
}));

describe('FormFooter', () => {
  it('announces the status in a live region with the given tone', () => {
    render(<FormFooter status="Kaydedilmemiş değişiklik var" statusTone="uyari" primaryLabel="Kaydet" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Kaydedilmemiş değişiklik var');
    expect(status).toHaveAttribute('data-tone', 'uyari');
  });

  it('keeps the live region in the DOM even without a status so later messages are announced', () => {
    render(<FormFooter primaryLabel="Kaydet" />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(status).not.toHaveAttribute('data-tone');
  });

  it('wide: status left, then secondary and primary in that order; both fire their handlers', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const { container } = render(
      <FormFooter status="Kaydedilmemiş değişiklik yok" primaryLabel="Kaydet" secondaryLabel="Vazgeç" onPrimary={onPrimary} onSecondary={onSecondary} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Vazgeç', 'Kaydet']);
    expect(buttons[0]).toHaveAttribute('data-variant', 'secondary');
    expect(buttons[1]).toHaveAttribute('data-variant', 'primary');
    expect(buttons[0]).not.toHaveAttribute('data-block');
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('data-narrow');
    expect(root).not.toHaveAttribute('data-sticky');
    // Durum metni eylemlerden önce gelir (solda okunur, odak sırası aynı).
    expect(root.firstElementChild).toBe(screen.getByRole('status'));

    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    await user.click(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('disabled primary: the reason is visible in the status and the click does nothing', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    render(<FormFooter status="Hata: 2 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled secondaryLabel="Vazgeç" onPrimary={onPrimary} />);
    const primary = screen.getByRole('button', { name: 'Kaydet' });
    expect(primary).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Vazgeç' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Hata: 2 alan düzeltilmeli');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'hata');
    await user.click(primary);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('disabled primary is described by the status live region; an enabled one is not', () => {
    const { rerender } = render(<FormFooter status="Hata: 2 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled />);
    const status = screen.getByRole('status');
    expect(status.id).not.toBe('');
    expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveAttribute('aria-describedby', status.id);
    expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveAccessibleDescription('Hata: 2 alan düzeltilmeli');

    rerender(<FormFooter status="Kaydedilmemiş değişiklik yok" primaryLabel="Kaydet" />);
    expect(screen.getByRole('button', { name: 'Kaydet' })).not.toHaveAttribute('aria-describedby');
  });

  it('hata tone always reads "Hata: …" so colour is never the only signal', () => {
    render(<FormFooter status="1 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Hata: 1 alan düzeltilmeli$/);
    // Zaten "Hata:" ile başlayan metin ikinci kez öneklenmez.
  });

  it('does not double the "Hata:" prefix', () => {
    render(<FormFooter status="Hata: 1 alan düzeltilmeli" statusTone="hata" primaryLabel="Kaydet" primaryDisabled />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Hata: 1 alan düzeltilmeli$/);
  });

  it('narrow: primary comes first and full width, footer is sticky by default', () => {
    const { container } = render(<FormFooter narrow status="Kaydedilmemiş değişiklik var" statusTone="uyari" primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-narrow', 'true');
    expect(root).toHaveAttribute('data-sticky', 'true');
    const buttons = within(root).getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Kaydet', 'Vazgeç']);
    for (const button of buttons) expect(button).toHaveAttribute('data-block', 'true');
  });

  it('narrow with sticky={false} stays in flow (e.g. inside a bottom sheet footer)', () => {
    const { container } = render(<FormFooter narrow sticky={false} primaryLabel="Sonuçları göster" secondaryLabel="Filtreleri temizle" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-narrow', 'true');
    expect(root).not.toHaveAttribute('data-sticky');
  });

  it('sticky on a wide form keeps the wide order', () => {
    const { container } = render(<FormFooter sticky primaryLabel="Kaydet" secondaryLabel="Vazgeç" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-sticky', 'true');
    expect(root).not.toHaveAttribute('data-narrow');
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Vazgeç', 'Kaydet']);
  });

  it('renders no button for a missing label', () => {
    render(<FormFooter status="Henüz yok" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Henüz yok');
  });

  it('refuses a disabled primary without a visible reason at compile time', () => {
    // @ts-expect-error — primaryDisabled yalnız status ile birlikte geçerlidir (neden görünür olmalı).
    const props: FormFooterProps = { primaryLabel: 'Kaydet', primaryDisabled: true };
    expect(props.primaryDisabled).toBe(true);
    const ok: FormFooterProps = { primaryLabel: 'Kaydet', primaryDisabled: true, status: 'Hata: 2 alan düzeltilmeli', statusTone: 'hata' };
    expect(ok.status).toContain('Hata:');
  });

  it('source: Button from ./Button, styles from tokens only, no outline/box-shadow, sticky honours the safe area', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const tsx = readFileSync(resolve(__dirname, 'FormFooter.tsx'), 'utf8');
    expect(tsx).toMatch(/from\s+'\.\/Button'/);
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/|echarts|@mantine\/)/);
    expect(tsx).not.toContain('data-stub');
    const css = readFileSync(resolve(__dirname, 'FormFooter.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\boutline\s*:/);
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).toContain('position: sticky');
    expect(css).toContain('safe-area-inset-bottom');
    // Her var() --aile- ile başlar; başka token kaynağı yok.
    for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) expect(match[1]).toMatch(/^--aile-/);
    // Sabit piksel yalnız: 1 px ayırıcı çizgi, 14/20 küçük metin (alt sınır) ve safe-area için 0px yedeği. Başka px yok.
    const px = [...css.matchAll(/(\d+)px/g)].map(match => match[1]);
    expect(new Set(px)).toEqual(new Set(['0', '1', '14', '20']));
  });
});
