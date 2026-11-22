const CACHE_NAME = 'sensometric-shell-v3';
const STATIC_PATHS = new Set([
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.webmanifest',
    '/sensometric-logo.png',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/favicon-32.png'
]);

function cacheResponse(request, response, errorMessage) {
    if (!response.ok) {
        return Promise.resolve(response);
    }

    return caches.open(CACHE_NAME)
        .then(cache => cache.put(request, response.clone()))
        .then(() => response)
        .catch(error => {
            console.error(errorMessage, error);
            return response;
        });
}

self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith('sensometric-shell-') && key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => cacheResponse('/index.html', response, 'Unable to cache the app page:'))
                .catch(() => caches.match('/index.html').then(cached => cached || Response.error()))
        );
        return;
    }

    if (STATIC_PATHS.has(url.pathname)) {
        event.respondWith(
            caches.match(request)
                .then(cached => cached || fetch(request).then(response => {
                    return cacheResponse(request, response, 'Unable to cache an app asset:');
                }))
        );
    }
});
