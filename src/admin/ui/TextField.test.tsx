import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextField } from './TextField';

// Tasarım: components/TextField/README.md — etiket üstte ve her zaman var, yardım/hata altta 14 px,
// hata "Hata: …" ile başlar, placeholder etiket yerine geçmez. Seçiciler role/label ile; antd iç sınıfı yok.
describe('TextField', () => {
  it('links the visible label to the input', () => {
    render(<TextField label="Alım adı" />);
    const input = screen.getByLabelText('Alım adı');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByText('Alım adı').tagName).toBe('LABEL');
  });

  it('keeps the label accessible when it is visually hidden', () => {
    render(<TextField label="Seçeneklerde ara" hideLabel icon="search" placeholder="Ara" />);
    const input = screen.getByRole('textbox', { name: 'Seçeneklerde ara' });
    expect(input).toHaveAttribute('placeholder', 'Ara');
    expect(screen.getByText('Seçeneklerde ara')).toHaveClass('aile-gorsel-gizli');
    const icon = document.querySelector('svg[data-icon="search"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('describes the input with the help text', () => {
    render(<TextField label="Not" help="En fazla 80 karakter" />);
    const input = screen.getByLabelText('Not');
    expect(input).toHaveAccessibleDescription('En fazla 80 karakter');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the error, prefixes it with "Hata:" and describes the input with it', () => {
    render(<TextField label="Alım adı" help="En fazla 80 karakter" error="Ad boş olamaz" />);
    const input = screen.getByLabelText('Alım adı');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Hata: Ad boş olamaz');
    expect(screen.queryByText('En fazla 80 karakter')).toBeNull();
    expect(screen.getByText('Hata: Ad boş olamaz').closest('[data-invalid="true"]')).not.toBeNull();
  });

  it('does not double an error that already starts with "Hata:"', () => {
    render(<TextField label="Tutar" error="Hata: Fiyat yok" />);
    expect(screen.getByLabelText('Tutar')).toHaveAccessibleDescription('Hata: Fiyat yok');
  });

  it('reports the typed value as a string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Alım adı" onChange={onChange} />);
    await user.type(screen.getByLabelText('Alım adı'), 'Koltuk');
    expect(onChange).toHaveBeenCalledTimes(6);
    expect(onChange).toHaveBeenLastCalledWith('Koltuk');
    for (const [value] of onChange.mock.calls) expect(typeof value).toBe('string');
  });

  it('forwards inputMode and shows the suffix', () => {
    render(<TextField label="Planlanan tutar" inputMode="decimal" suffix="₺" placeholder="8.500,00" />);
    const input = screen.getByLabelText('Planlanan tutar');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('₺')).toBeInTheDocument();
  });

  it('disables the input when asked', () => {
    render(<TextField label="Oda" value="Salon" disabled />);
    const input = screen.getByLabelText('Oda');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('Salon');
  });

  it('uses the ui barrel for antd and tokens instead of literals', () => {
    const source = readFileSync(resolve(__dirname, 'TextField.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]antd['"]/);
    expect(source).not.toMatch(/@ant-design\/icons/);
    const css = readFileSync(resolve(__dirname, 'TextField.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
