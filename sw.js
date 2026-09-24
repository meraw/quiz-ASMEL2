/*
 * Quiz ASMEL - service worker (offline support)
 *
 * Every file of the app (index.html, app.js, style.css, manifest.json, icons
 * and everything in data/) is NETWORK FIRST: always try to get the newest
 * version, and use the saved copy only when offline.
 *
 * Change CACHE_VERSION below whenever this file changes, so installed apps
 * replace the old service worker and clear the old saved copies.
 */
const CACHE_VERSION = 'asmel-quiz-v5';

// Files saved at install time. Paths are relative to this file, so the app
// also works under a subpath such as /quiz-asmel/.
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'validation.js',
  'study.js',
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle GET requests for files of this site
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
