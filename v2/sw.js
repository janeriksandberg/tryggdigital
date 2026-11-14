// Service worker for Tryggdigital v2 (generert av tools/build-sw.mjs – ikke rediger sw.js direkte).
// Omfang: bare /v2/. Appen lastes fra lokal buffer først, slik at den starter selv om GitHub Pages er nede
// eller enheten er uten nett. Nye versjoner hentes i bakgrunnen og tas i bruk ved neste oppstart.
// Bufrene heter «td2-…», og vi rører aldri bufrene til versjon 1.
const VERSION = 'td2-a013b179fc2f';
const FILES = [
 "./",
 "css/app.css",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon.svg",
 "index.html",
 "js/app.js",
 "js/config.js",
 "js/core/backup.js",
 "js/core/crops.js",
 "js/core/crypt.js",
 "js/core/csv.js",
 "js/core/domain.js",
 "js/core/geo.js",
 "js/core/hlc.js",
 "js/core/idb.js",
 "js/core/importgeo.js",
 "js/core/labels.js",
 "js/core/log.js",
 "js/core/qrauth.js",
 "js/core/schema.js",
 "js/core/store.js",
 "js/core/weather.js",
 "js/demo.js",
 "js/i18n.js",
 "js/icons.js",
 "js/lang/en.js",
 "js/lang/index.js",
 "js/lang/lt.js",
 "js/lang/nb.js",
 "js/lang/pl.js",
 "js/lang/ro.js",
 "js/lang/uk.js",
 "js/lang/vi.js",
 "js/map.js",
 "js/net/auth.js",
 "js/net/fb.js",
 "js/net/lan.js",
 "js/net/sync.js",
 "js/scanner.js",
 "js/session.js",
 "js/ui.js",
 "js/views/admin/crops.js",
 "js/views/admin/devices.js",
 "js/views/admin/fields.js",
 "js/views/admin/index.js",
 "js/views/admin/overview.js",
 "js/views/admin/pay.js",
 "js/views/admin/people.js",
 "js/views/admin/products.js",
 "js/views/admin/registrations.js",
 "js/views/admin/reports.js",
 "js/views/admin/settings.js",
 "js/views/admin/spraying.js",
 "js/views/admin/today.js",
 "js/views/admin/trace.js",
 "js/views/foreman.js",
 "js/views/kiosk.js",
 "js/views/login.js",
 "js/views/print.js",
 "js/views/privacy.js",
 "js/views/shared.js",
 "js/views/sprayform.js",
 "js/views/super.js",
 "js/views/support.js",
 "js/views/tenants.js",
 "js/views/welcome.js",
 "js/views/work.js",
 "manifest.webmanifest",
 "vendor/barcode-ponyfill.js",
 "vendor/firebase.js",
 "vendor/images/layers-2x.png",
 "vendor/images/layers.png",
 "vendor/images/marker-icon-2x.png",
 "vendor/images/marker-icon.png",
 "vendor/images/marker-shadow.png",
 "vendor/leaflet-geoman.css",
 "vendor/leaflet-geoman.min.js",
 "vendor/leaflet.css",
 "vendor/leaflet.js",
 "vendor/qrcode.js",
 "vendor/shp.js",
 "vendor/togeojson.js",
 "vendor/zxing_reader.wasm"
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('td2-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === 'navigate') {
      const hit = await cache.match('./');
      return hit || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
