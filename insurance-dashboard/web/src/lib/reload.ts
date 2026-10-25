/* A tab opened before a deploy asks for a lazy chunk whose hashed name no longer exists: the server answers 404 (firebase.json rewrites
   extensionless paths only) and Vite raises vite:preloadError. Reload once to pick up the new index.html and its chunk names; a second
   failure within a minute is a real error and reaches the error boundary. */
const KEY = 'fox:preload-reload';

export function reloadOnStaleChunk(): void {
  addEventListener('vite:preloadError', (e) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY) ?? 0); } catch { return; }  // no storage: no loop guard, so no reload
    if (Date.now() - last < 60_000) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch { return; }
    e.preventDefault();
    location.reload();
  });
}
