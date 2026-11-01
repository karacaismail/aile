import { describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, within } from '@/test-utils/render';
import { FormFooter } from './FormFooter';

describe('FormFooter error list', () => {
  it('lists one entry per counted error, including an error whose field has no focusable element, and reaches fields by path at click time', async () => {
    const view = render(<form><label htmlFor="ad">Ad *</label><input id="ad" data-path="ad" /><textarea aria-label="Not" />
      <FormFooter errors={{ ad: 'Ad gerekli', cct_max: 'CCT aralığı ters' }} onCancel={vi.fn()} /></form>);
    expect(screen.getByRole('status')).toHaveTextContent(/^2 alan düzeltilmeli$/);
    const list = screen.getByRole('group', { name: 'Düzeltilecek alanlar' });
    expect(within(list).getByRole('button', { name: 'Ad' })).toBeInTheDocument();
    // No element carries this path: the entry still names the problem in words, without a dead button.
    expect(within(list).getByText('CCT aralığı ters')).toBeInTheDocument();
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    // The field is replaced while the same errors remain: the button still reaches the current element.
    view.rerender(<form><label htmlFor="ad2">Ad *</label><input id="ad2" data-path="ad" /><textarea aria-label="Not" />
      <FormFooter errors={{ ad: 'Ad gerekli', cct_max: 'CCT aralığı ters' }} onCancel={vi.fn()} /></form>);
    screen.getByLabelText('Not').focus();
    await userEvent.click(within(screen.getByRole('group', { name: 'Düzeltilecek alanlar' })).getByRole('button', { name: 'Ad' }));
    expect(screen.getByLabelText(/^Ad/)).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(/^2 alan düzeltilmeli$/);
  });
});
