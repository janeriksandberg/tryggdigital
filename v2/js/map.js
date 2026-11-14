// Kart (Leaflet + Geoman) med Kartverkets topografiske kart og OpenStreetMap som reserve.
import { h } from './ui.js';

export function baseMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, ...opts });
  const kv = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: 19, maxNativeZoom: 18, attribution: '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
  });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
  let ok = 0, fail = 0, switched = false;
  kv.on('tileload', () => ok++);
  kv.on('tileerror', () => { fail++; if (!switched && ok === 0 && fail >= 4) { switched = true; map.removeLayer(kv); osm.addTo(map); } });
  kv.addTo(map);
  L.control.layers({ 'Kartverket topo': kv, OpenStreetMap: osm }, null, { position: 'topright' }).addTo(map);
  return map;
}
export function fitToFields(map, fields) {
  const g = L.geoJSON(fields.filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry })));
  if (fields.length && g.getBounds().isValid()) map.fitBounds(g.getBounds(), { padding: [30, 30], maxZoom: 17 });
  else map.setView([60.5, 9.5], 5);
}
export const fieldStyle = (f, selected = false) => ({ color: f.color || '#157a52', weight: selected ? 5 : 3, fillOpacity: selected ? 0.4 : 0.22, fillColor: f.color || '#157a52' });
export function fieldPreview(el, fields, selectedId, pos) {
  const map = baseMap(el, { zoomControl: false });
  const sel = fields.find((f) => f.id === selectedId);
  fitToFields(map, sel ? [sel] : fields);
  for (const f of fields) if (f.geometry) L.geoJSON({ type: 'Feature', geometry: f.geometry }, { style: fieldStyle(f, f.id === selectedId) }).addTo(map);
  if (pos) L.circleMarker([pos.lat, pos.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(map);
  setTimeout(() => map.invalidateSize(), 150);
  return map;
}
export const mapAvailable = () => typeof window.L !== 'undefined';
export const mapEl = (cls) => h('div', { class: `map ${cls}` });
