import '@mantine/core/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';

export function mountApp() {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
