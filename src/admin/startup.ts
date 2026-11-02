import { installKeyboardMode } from '../dashboard/keyboard.ts';

// Build-time inline script for admin.html: the same keyboard-mode installer the
// main entry uses, injected before the module graph loads so an early Tab counts.
export const adminStartupScript = `(${installKeyboardMode.toString()})();`;
