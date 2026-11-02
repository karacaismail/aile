import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installKeyboardMode } from '../dashboard/keyboard.ts';
import { App } from './App';
import { installPreloadRecovery } from './preloadRecovery';
import './fonts.css';
import './admin.css';

installKeyboardMode();
// Before any lazy page import: a chunk removed by a newer deploy reloads the page once (guarded against loops).
installPreloadRecovery();
createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
