import { timelineEntryUrl } from './entry';
const timelineEntry = timelineEntryUrl(window.location.pathname, import.meta.env.BASE_URL);
if (timelineEntry) window.history.replaceState(null, '', timelineEntry);
// Vite loads this async module's CSS before evaluating it. The initial HTML
// remains useful while application resources arrive, without unstyled React UI.
void import('./app/mount').then(({ mountApp }) => mountApp()).catch(() => {
  document.dispatchEvent(new Event('aile:startup-error'));
});
