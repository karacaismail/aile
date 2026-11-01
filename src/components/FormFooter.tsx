import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { tokens } from '@/dashboard/tokens';

type Errors = Record<string, ReactNode>;
const failingPaths = (errors: Errors) => Object.keys(errors).filter((k) => errors[k] != null && errors[k] !== false);

function focusField(target: HTMLElement | undefined) {
  if (!target) return;
  target.scrollIntoView?.({ block: 'center' });
  target.focus({ preventScroll: true });
}

/**
 * Gönderim doğrulaması başarısız olunca DOM sırasındaki ilk hatalı alana odaklan ve görünüme getir.
 * Alanlar Mantine `data-path` sözleşmesini taşır (`getInputProps` verir; `setFieldValue` ile bağlı alanlar açıkça yazar).
 */
export function focusFirstError(root: HTMLElement | null, errors: Errors): void {
  if (!root) return;
  const failing = new Set(failingPaths(errors));
  focusField(Array.from(root.querySelectorAll<HTMLElement>('[data-path]')).find((el) => failing.has(el.dataset.path ?? '')));
}

/** The visible label of a field (without the required marker), so the error list uses the words the form shows. */
function fieldLabel(field: HTMLElement) {
  const own = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.labels?.[0] : null;
  const text = own?.textContent ?? field.getAttribute('aria-label') ?? '';
  return text.replace(/\s*\*\s*$/, '').trim() || 'Alan';
}

/**
 * Kayıt formlarının ortak yapışkan alt çubuğu: hata sayısı (odak almadan duyurulur; bölge hep var, metin yalnız hata varken),
 * hatalı alanların adlandırılmış listesi (her biri alana götürür; ikinci canlı bölge değildir),
 * Sil (var olan kayıtta), Vazgeç ve Kaydet. Doğrulama ve kayıt kararı formun kendisinde kalır.
 */
export function FormFooter({ errors, onCancel, onDelete }: { errors: Errors; onCancel: () => void; onDelete?: () => void }) {
  const count = Object.values(errors).filter(Boolean).length;
  const ref = useRef<HTMLDivElement>(null);
  // One entry per counted error: a field found by its data-path becomes a button (looked up again at click time);
  // an error without a focusable field is still named in words, so the list and the count always agree.
  const [fields, setFields] = useState<{ path: string; label: string; reachable: boolean }[]>([]);
  // Paths and messages: the list is rebuilt when either changes, never on every render.
  const key = JSON.stringify(failingPaths(errors).map((path) => [path, String(errors[path])]));
  // WCAG 2.4.11: the scroll container keeps a bottom scroll padding equal to this sticky footer, so a focused
  // field is scrolled clear of it (technique C43). The footer height changes with the error list, so it is observed.
  useLayoutEffect(() => {
    const footer = ref.current;
    let scroller = footer?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!footer || !scroller || typeof ResizeObserver === 'undefined') return;
    const target = scroller;
    const gap = parseFloat(tokens.spaceSmall);
    const apply = () => { target.style.scrollPaddingBottom = `${footer.offsetHeight + gap}px`; };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(footer);
    // WebKit ignores scroll padding when it scrolls a newly focused field into view; correct only the overlap.
    // Keyboard focus only: a pointer focus on mousedown must not move the field away before the click lands.
    const form = footer.closest('form');
    const reveal = (event: FocusEvent) => {
      const field = event.target as HTMLElement;
      if (document.documentElement.dataset.keyboard !== 'true' || footer.contains(field)) return;
      const box = field.getBoundingClientRect();
      const overlap = box.bottom - footer.getBoundingClientRect().top;
      // Never push a tall field's top edge out of the scroll container.
      if (overlap > 0) target.scrollTop += Math.min(overlap + gap, box.top - target.getBoundingClientRect().top);
    };
    form?.addEventListener('focusin', reveal);
    return () => { observer.disconnect(); form?.removeEventListener('focusin', reveal); target.style.scrollPaddingBottom = ''; };
  }, []);
  // Labels come from the rendered form in DOM order, after the error state has been committed.
  useLayoutEffect(() => {
    const form = ref.current?.closest('form');
    const order = form ? Array.from(form.querySelectorAll<HTMLElement>('[data-path]')).map((el) => el.dataset.path) : [];
    const entries = new Map(JSON.parse(key) as [string, string][]);
    const paths = [...entries.keys()];
    paths.sort((a, b) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity));
    setFields(paths.map((path) => {
      const element = form?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
      return element ? { path, label: fieldLabel(element), reachable: true } : { path, label: entries.get(path) ?? path, reachable: false };
    }));
  }, [key]);
  return (
    <Stack ref={ref} gap={tokens.spaceDense} mt="sm" pt={tokens.spaceTight} style={{ position: 'sticky', bottom: 0, zIndex: tokens.layerSticky, background: 'var(--mantine-color-body)' }}>
      <Text component="p" role="status" aria-live="polite" size="sm" c="var(--mantine-color-error)" m={0} data-testid="form-errors">{count ? `${count} alan düzeltilmeli` : ''}</Text>
      {fields.length > 0 && <div className="form-error-fields" role="group" aria-label="Düzeltilecek alanlar">
        {fields.map((field) => field.reachable
          ? <button key={field.path} type="button" className="form-error-field" onClick={() => focusField(ref.current?.closest('form')?.querySelector<HTMLElement>(`[data-path="${CSS.escape(field.path)}"]`) ?? undefined)}>{field.label}</button>
          : <span key={field.path} className="form-error-field" data-unreachable="true">{field.label}</span>)}
      </div>}
      <Group justify="space-between">
        {onDelete ? <Button variant="subtle" color="red" leftSection={<TrashIcon size={18} aria-hidden />} onClick={onDelete}>Sil</Button> : <span />}
        <Group gap="xs">
          <Button variant="default" onClick={onCancel}>Vazgeç</Button>
          <Button type="submit" leftSection={<FloppyDiskIcon size={18} aria-hidden />}>Kaydet</Button>
        </Group>
      </Group>
    </Stack>
  );
}
