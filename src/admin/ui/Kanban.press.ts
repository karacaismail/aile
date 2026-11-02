import type { PointerEvent } from 'react';

// Görünüm ailesinin (a12: Kanban, Timeline, PivotStack, FilterArea) ortak basılı durum yardımcısı. Dosya sahipliği
// nedeniyle Kanban.* adını taşır; entegrasyon ortak bir ui/ modülüne taşıyabilir.
// Neden: dokunmatik WebKit'te :active, sayfada touchstart dinleyicisi yoksa çoğu kez görünmez; basılı geri bildirim
// Pointer Events ile tek yoldan verilir. data-pressed yalnız görseldir (CSS secili yüzey); etkinleştirme yerel
// <button>'un click'idir. Tarayıcı kaydırmaya karar verince pointercancel gelir: basılı durum silinir ve click
// oluşmaz, yani kaydırma bir kaydı açmaz. Fare yalnız birincil düğmeyle basılı sayılır. React bu özniteliği
// yönetmez (yeniden çizimde silinmez); bırakma, iptal ve işaretçinin çıkması siler.

function press(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.currentTarget.dataset.pressed = 'true';
}

function release(event: PointerEvent<HTMLElement>) {
  delete event.currentTarget.dataset.pressed;
}

/** Yerel düğmeye yayılır: {...PRESS_HANDLERS}. Durum tutmaz; her öğe kendi data-pressed özniteliğini taşır. */
export const PRESS_HANDLERS = {
  onPointerDown: press,
  onPointerUp: release,
  onPointerCancel: release,
  onPointerLeave: release,
} as const;
