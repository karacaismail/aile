import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installKeyboardMode } from '../dashboard/keyboard.ts';
import { App } from './App';
import './admin.css';

installKeyboardMode();
createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
