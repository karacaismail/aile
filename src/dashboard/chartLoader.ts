// Both optional entry points share the first import and its observed same-origin resources.
const preloadResources = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"], link[rel="stylesheet"]')].map(link => link.href).filter(href => new URL(href).origin === location.origin);
let request: Promise<typeof import('./Charts')> | undefined;
let failedResources: string[] = [];

export function loadCharts() {
  if (!request) {
    const before = new Set(preloadResources());
    const started = import('./Charts');
    // Vite adds this import's preload links synchronously; later route imports must stay out.
    const added = preloadResources().filter(href => !before.has(href));
    request = started.catch(error => {
      failedResources = added;
      throw error;
    });
  }
  return request;
}

/** Explicit user recovery only; no storage, outbox, service-worker or unrelated cache changes. */
export async function revalidateChartResources(signal: AbortSignal) {
  await Promise.all(failedResources.map(async href => {
    const response = await fetch(href, { cache: 'reload', credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('Chart resource unavailable');
    await response.arrayBuffer();
  }));
}
