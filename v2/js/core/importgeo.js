// Import av jorder fra KML, zippet shapefil eller GeoJSON. Resultatet er GeoJSON i EPSG:4326 (lengde, bredde).
// Shapefiler omprojiseres av shpjs ut fra .prj-filen (f.eks. EUREF89 UTM 33, som er vanlig i Norge).
import { polygonAreaM2 } from './geo.js';

const NAME_KEYS = ['name', 'navn', 'Name', 'NAVN', 'NAME', 'teignavn', 'TEIGNAVN', 'skiftenavn', 'title', 'id', 'ID'];

export function polygonsFrom(geojson) {
  const out = [];
  const feats = Array.isArray(geojson) ? geojson.flatMap((g) => g.features || []) : geojson.type === 'FeatureCollection' ? geojson.features : geojson.type === 'Feature' ? [geojson] : [{ type: 'Feature', geometry: geojson, properties: {} }];
  feats.forEach((f, i) => {
    const g = f?.geometry;
    if (!g) return;
    const add = (geometry) => {
      const geometry2 = strip3d(geometry);
      const props = f.properties || {};
      const nameKey = NAME_KEYS.find((k) => props[k] !== undefined && props[k] !== null && String(props[k]).trim());
      out.push({ name: nameKey ? String(props[nameKey]).trim().slice(0, 80) : '', geometry: geometry2, areaDaa: polygonAreaM2(geometry2) / 1000, props, index: i });
    };
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') add(g);
    else if (g.type === 'GeometryCollection') for (const x of g.geometries) if (x.type === 'Polygon' || x.type === 'MultiPolygon') add(x);
  });
  out.forEach((p, i) => { if (!p.name) p.name = `Jorde ${i + 1}`; });
  return out;
}
function strip3d(g) {
  const fix = (c) => (typeof c[0] === 'number' ? [Number(c[0].toFixed(7)), Number(c[1].toFixed(7))] : c.map(fix));
  return { type: g.type, coordinates: fix(g.coordinates) };
}
export function looksLikeWgs84(polys) {
  return polys.every((p) => JSON.stringify(p.geometry.coordinates).match(/-?\d+(\.\d+)?/g).every((n, i) => Math.abs(Number(n)) <= (i % 2 ? 90 : 180)));
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kml')) {
    const { kml } = await import('../../vendor/togeojson.js');
    const doc = new DOMParser().parseFromString(await file.text(), 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('Ugyldig KML');
    return polygonsFrom(kml(doc));
  }
  if (name.endsWith('.zip')) {
    const { shp } = await import('../../vendor/shp.js');
    return polygonsFrom(await shp(await file.arrayBuffer()));
  }
  if (name.endsWith('.geojson') || name.endsWith('.json')) return polygonsFrom(JSON.parse(await file.text()));
  if (name.endsWith('.shp')) throw new Error('shp-alone');
  throw new Error('format');
}
