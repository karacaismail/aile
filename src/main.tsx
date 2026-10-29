import '@mantine/core/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { timelineEntryUrl } from './entry';
const timelineEntry = timelineEntryUrl(window.location.pathname, import.meta.env.BASE_URL);
if (timelineEntry) window.history.replaceState(null, '', timelineEntry);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
