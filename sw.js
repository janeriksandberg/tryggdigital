// Service worker: gjør at appen virker uten nett ute på jordet (kartfliser hentes fra nett).
const VERSION = 'tryggdigital-v1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/i18n.js', 'js/strings.js', 'js/ui.js', 'js/store.js', 'js/scanner.js', 'js/picker.js',
  'js/admin.js', 'js/map.js', 'js/geo.js', 'js/sprayer.js', 'js/demo.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/leaflet-geoman.min.js', 'vendor/leaflet-geoman.css',
  'vendor/qrcode.js', 'vendor/barcode-ponyfill.js', 'vendor/zxing_reader.wasm',
  'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png', 'vendor/images/layers.png', 'vendor/images/layers-2x.png',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Nett først (for ferske oppdateringer), cache som reserve når det ikke er dekning
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
