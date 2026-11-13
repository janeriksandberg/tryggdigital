// Geometri-hjelpere for jorder (GeoJSON, EPSG:4326, [lng, lat])
const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;

// Areal av en ring på kula (m²) – samme metode som brukes i bl.a. Turf/Leaflet.draw
function ringArea(coords) {
  let area = 0;
  const n = coords.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % n];
    area += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((area * R * R) / 2);
}

export function polygonAreaM2(geometry) {
  if (!geometry) return 0;
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let a = 0;
  for (const p of polys) {
    a += ringArea(p[0]);
    for (let i = 1; i < p.length; i++) a -= ringArea(p[i]);
  }
  return a;
}
export const m2ToDaa = (m2) => m2 / 1000;

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInPolygon(pt, geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
}

export function distanceM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Korteste avstand fra punkt til polygonkant (tilnærming i lokal plan projeksjon)
export function distanceToPolygonM(pt, geometry) {
  if (pointInPolygon(pt, geometry)) return 0;
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const k = Math.cos(rad(pt[1]));
  const toXY = ([lng, lat]) => [rad(lng) * R * k, rad(lat) * R];
  const p = toXY(pt);
  let best = Infinity;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = toXY(ring[i]);
      const b = toXY(ring[i + 1]);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const cx = a[0] + t * dx, cy = a[1] + t * dy;
      best = Math.min(best, Math.hypot(p[0] - cx, p[1] - cy));
    }
  }
  return best;
}

// Finn jordene sortert etter avstand fra posisjonen
export function rankFields(fields, lng, lat) {
  return fields
    .map((f) => ({ field: f, dist: distanceToPolygonM([lng, lat], f.geometry) }))
    .sort((a, b) => a.dist - b.dist);
}
