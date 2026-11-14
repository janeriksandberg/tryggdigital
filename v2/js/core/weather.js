// Værvarsel fra Meteorologisk institutt (api.met.no, Locationforecast 2.0 compact).
// Vilkår (https://docs.api.met.no/doc/TermsOfService): maks 4 desimaler i koordinater, ikke spør på nytt før «Expires»,
// nettlesere identifiserer seg med Origin (vi sender ingen egne headere, så forespørselen er en «enkel» CORS-forespørsel),
// og data skal krediteres MET Norge (NLOD 2.0 / CC BY 4.0). Vi bruker jordets midtpunkt, ikke brukerens posisjon.
// Dette er et VARSEL, ikke målt vær. Sprøyteren må alltid bekrefte verdiene.
export const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
export const CREDIT = 'Data fra MET Norge (api.met.no), NLOD 2.0 / CC BY 4.0';
const CACHE_KEY = 'td2.met.';

export const round4 = (x) => Math.round(Number(x) * 1e4) / 1e4;

export function centroid(geometry) {
  const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.type === 'MultiPolygon' ? geometry.coordinates[0][0] : null;
  if (!ring?.length) return null;
  let x = 0, y = 0;
  const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
  return { lon: round4(x / n), lat: round4(y / n) };
}

/** Velger tidssteget nærmest et tidspunkt og henter ut verdiene sprøyteren trenger. */
export function pickWeather(json, at = new Date()) {
  const series = json?.properties?.timeseries || [];
  if (!series.length) return null;
  let best = series[0], diff = Infinity;
  for (const s of series) { const d = Math.abs(new Date(s.time) - at); if (d < diff) { diff = d; best = s; } }
  const det = best.data?.instant?.details || {};
  return {
    time: best.time,
    temp: det.air_temperature ?? null,
    wind: det.wind_speed ?? null,
    gust: det.wind_speed_of_gust ?? null,
    windDir: det.wind_from_direction ?? null,
    humidity: det.relative_humidity ?? null,
    precip1h: best.data?.next_1_hours?.details?.precipitation_amount ?? null,
    updated: json?.properties?.meta?.updated_at || null,
    source: 'MET Norge Locationforecast 2.0',
    forecast: true,
  };
}
export function compass(deg) {
  if (deg === null || deg === undefined) return '';
  return ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'][Math.round(deg / 45) % 8];
}

export async function fetchForecast(lat, lon, at = new Date()) {
  const r = await fetchForecastJson(lat, lon);
  return r.cached ? { ...pickWeather(r.json, at), cached: true } : pickWeather(r.json, at);
}
/** Hele varselet (brukes også til frost- og sprøytevarsel på oversikten). Samme mellomlager og samme vilkår. */
export async function fetchForecastJson(lat, lon) {
  const la = round4(lat), lo = round4(lon);
  const key = `${CACHE_KEY}${la},${lo}`;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && Date.now() < c.expires) return { json: c.json, cached: true };
  } catch { /* */ }
  const res = await fetch(`${MET_URL}?lat=${la}&lon=${lo}`, { mode: 'cors', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
  if (res.status === 429) throw new Error('throttled');
  if (!res.ok) throw new Error('http ' + res.status);
  const json = await res.json();
  const exp = Date.parse(res.headers.get('Expires') || '') || Date.now() + 30 * 60 * 1000;
  try { localStorage.setItem(key, JSON.stringify({ expires: Math.max(exp, Date.now() + 10 * 60 * 1000), json })); } catch { /* full lagring */ }
  return { json, cached: false };
}
