import { useEffect } from 'react';
export function useKeyboardMode() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.keyboard = 'false';
    const key = (e: KeyboardEvent) => { if (e.key === 'Tab') root.dataset.keyboard = 'true'; };
    const pointer = () => { root.dataset.keyboard = 'false'; };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('touchstart', pointer, true);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('touchstart', pointer, true); delete root.dataset.keyboard; };
  }, []);
}
