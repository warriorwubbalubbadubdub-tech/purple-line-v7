const CACHE_NAME = 'purple-line-v12';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',

  './break-start.mp3',
  './break-end.mp3',

  './pinkie1-start.mp3',
  './pinkie1-end.mp3',

  './pinkie2-start.mp3',
  './pinkie2-end.mp3',

  './rainbow-start.mp3',
  './rainbow-end.mp3',

  './gumball-start.mp3',
  './gumball-end.mp3',

  './makoto-start.mp3',
  './makoto-end.mp3',

  './darwin-start.mp3',
  './darwin-end.mp3',

  './neuvillette-start.mp3',
  './neuvillette-end.mp3',

  './alastor-start.mp3',
  './alastor-end.mp3',

  './paimon-start.mp3',
  './paimon-end.mp3',

  './durin-start.m4a',
  './durin-end.m4a'
];


// ========================================
// INSTALL
// ========================================

self.addEventListener('install', event => {

  event.waitUntil(

    caches.open(CACHE_NAME)

      .then(cache => {

        return Promise.allSettled(

          ASSETS.map(url =>

            cache.add(url).catch(error => {

              console.warn(
                '[Purple Line SW] Failed to cache:',
                url,
                error
              );

            })

          )

        );

      })

      .then(() => {

        // Activate the new service worker immediately
        return self.skipWaiting();

      })

  );

});


// ========================================
// ACTIVATE
// ========================================

self.addEventListener('activate', event => {

  event.waitUntil(

    caches.keys()

      .then(keys => {

        return Promise.all(

          keys

            .filter(key => key !== CACHE_NAME)

            .map(key => caches.delete(key))

        );

      })

      .then(() => {

        // Take control of existing tabs/PWA windows immediately
        return self.clients.claim();

      })

  );

});


// ========================================
// MESSAGE
// ========================================

self.addEventListener('message', event => {

  if (
    event.data &&
    event.data.type === 'SKIP_WAITING'
  ) {

    self.skipWaiting();

  }

});


// ========================================
// FETCH
// ========================================

self.addEventListener('fetch', event => {

  if (event.request.method !== 'GET') {
    return;
  }

  const request = event.request;
  const url = new URL(request.url);

  const isAppShell =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/manifest.json');


  // ========================================
  // APP SHELL
  // NETWORK FIRST
  // ========================================

  if (isAppShell) {

    event.respondWith(

      fetch(request, {
        cache: 'no-store'
      })

      .then(response => {

        if (response && response.ok) {

          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {

              cache.put(request, copy);

            });

        }

        return response;

      })

      .catch(() => {

        return caches.match(request)

          .then(cached => {

            if (cached) {
              return cached;
            }

            return caches.match('./index.html');

          });

      })

    );

    return;
  }


  // ========================================
  // STATIC FILES / AUDIO
  // CACHE FIRST
  // ========================================

  event.respondWith(

    caches.match(request)

      .then(cachedResponse => {

        if (cachedResponse) {
          return cachedResponse;
        }


        return fetch(request)

          .then(response => {

            if (
              response &&
              response.ok
            ) {

              const copy =
                response.clone();

              caches.open(CACHE_NAME)
                .then(cache => {

                  cache.put(
                    request,
                    copy
                  );

                });

            }

            return response;

          });

      })

  );

});
