// Network first, cache as offline fallback. A new deploy is picked up on the
// next online launch; offline the last good copy keeps working.
const CACHE = 'mygarmin-app-6524193f322d';
// The pose model (~20 MB) survives app updates; it changes only with its pinned version.
const MODELS = 'mygarmin-models-0.10.14';
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './js/app.js', './js/engine.js', './js/store.js', './js/legacy.js', './js/charts.js', './js/insights.js', './js/sheet.js', './js/calendar.js', './js/heartrate.js', './js/pose.js', './js/posemodel.js',
  './vendor/diagrams.js',
  './data/library.json', './data/blocks/block2.json', './data/blocks/block2b.json', './data/blocks/bridge3.json',
  './data/seed/index.json', './data/seed/meta.json', './data/seed/profile.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/sc-sheet.png', './icons/sc-log.png', './icons/sc-progress.png',
];

self.addEventListener('install', (event) => {
  // `reload` bypasses the HTTP cache, so a new version never installs stale files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MODELS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/vendor/mediapipe/')) {
    event.respondWith(caches.open(MODELS).then((c) => c.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) c.put(event.request, res.clone());
      return res;
    }))));
    return;
  }
  event.respondWith(
    // Network first and always revalidated (a 304 is cheap); the cache is only for offline use.
    fetch(event.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); }
      return res;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
