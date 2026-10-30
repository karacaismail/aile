import { useEffect } from 'react';

// The initial HTML installs this same function before asynchronous modules load.
// React adopts that document-owned mode; mounting must not erase an early Tab.
export function installKeyboardMode() {
  const root = document.documentElement;
  if (root.dataset.keyboard !== undefined) return;
  root.dataset.keyboard = 'false';
  const key = (e: KeyboardEvent) => { if (e.key === 'Tab') root.dataset.keyboard = 'true'; };
  const pointer = () => { root.dataset.keyboard = 'false'; };
  document.addEventListener('keydown', key, true);
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('touchstart', pointer, true);
  return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('touchstart', pointer, true); delete root.dataset.keyboard; };
}

export function useKeyboardMode() { useEffect(installKeyboardMode, []); }
