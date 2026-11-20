import { lazy } from 'react';

const RELOAD_KEY = 'sgc-chunk-reload-at';

/** True when a JS/CSS chunk could not be loaded (usually: a deploy removed the file this old tab expects). */
export const isChunkLoadError = (err) => {
  const text = `${err?.name || ''} ${err?.message || err || ''}`;
  return /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(text);
};

/**
 * React.lazy that survives deploys: if the page's chunk is missing because a newer build replaced it,
 * reload once to pick up the new build instead of showing a blank / broken page.
 * Guarded so a real outage cannot cause a reload loop (at most one reload per minute).
 */
const lazyWithReload = (factory) => lazy(() => factory().catch((err) => {
  if (isChunkLoadError(err)) {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last > 60 * 1000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
      window.location.reload();
      return new Promise(() => {}); // keep Suspense fallback while the page reloads
    }
  }
  throw err;
}));

export default lazyWithReload;
