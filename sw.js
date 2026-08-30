const CACHE_NAME = 'purple-line-v11.2';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',

  './break-start.m4a',
  './break-end.m4a',

  './pinkie1-start.m4a',
  './pinkie1-end.m4a',

  './pinkie2-start.m4a',
  './pinkie2-end.m4a',

  './rainbow-start.m4a',
  './rainbow-end.m4a',

  './gumball-start.m4a',
  './gumball-end.m4a',

  './makoto-start.m4a',
  './makoto-end.m4a',

  './darwin-start.m4a',
  './darwin-end.m4a',

  './neuvillette-start.m4a',
  './neuvillette-end.m4a',

  './alastor-start.m4a',
  './alastor-end.m4a',

  './paimon-start.m4a',
  './paimon-end.m4a',
  './durin-start.m4a',
  './durin-end.m4a'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(err => console.warn(`Failed to cache: ${url}`, err)))
      )
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isAppShell =
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/manifest.json');

  if (isAppShell) {
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .then(response => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then(response => {
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
