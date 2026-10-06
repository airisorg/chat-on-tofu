const CACHE = 'relay-public-v1';
const PUBLIC = ['/offline.html', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('relay-public-') && key !== CACHE).map(key => caches.delete(key))))); });
self.addEventListener('fetch', event => {
 const request = event.request;
 const url = new URL(request.url);
 if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return;
 if (request.mode === 'navigate' && url.pathname === '/' && !url.search && !url.hash) {
  event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
 } else if (PUBLIC.includes(url.pathname) && !url.search) {
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
 }
});
