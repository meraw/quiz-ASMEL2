/*
 * Quiz ASMEL - service worker (offline support)
 *
 * - index.html and everything in data/  -> NETWORK FIRST: always try to get
 *   the newest version (so new questions appear), use the saved copy offline.
 * - everything else (app.js, style.css, icons) -> use the saved copy at once,
 *   and refresh it in the background for the next visit.
 *
 * If you change app.js or style.css and want phones to pick it up sooner,
 * change CACHE_VERSION below.
 */
const CACHE_VERSION = 'asmel-quiz-v2';

// Files saved at install time. Paths are relative to this file, so the app
// also works under a subpath such as /quiz-asmel/.
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/subjects.json',
  'data/profiles.json',
  'data/questions/index.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Remove caches of older versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isNetworkFirst(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  const scope = new URL(self.registration.scope).pathname; // e.g. /quiz-asmel/
  const relative = path.startsWith(scope) ? path.slice(scope.length) : path;
  return relative === '' || relative === 'index.html' || relative.startsWith('data/');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    // "no-cache" asks the server whether the file changed, skipping the browser's HTTP cache
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fresh = fetch(request)
    .then((response) => { if (response.ok) cache.put(request, response.clone()); return response; })
    .catch(() => cached);
  return cached || fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle GET requests for files of this site
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(isNetworkFirst(request) ? networkFirst(request) : staleWhileRevalidate(request));
});
