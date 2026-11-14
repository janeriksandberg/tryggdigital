// Hybrid logisk klokke (HLC). Gir versjonsstempler som kan sammenlignes som tekst og som alltid øker,
// også når en enhet har feil klokke. Format: <ms base36, 9 tegn>.<teller base36, 4 tegn>.<enhets-id>
let last = { p: 0, c: 0 };
let node = 'x';

export function initClock(nodeId, persisted) {
  node = String(nodeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'x';
  if (persisted) {
    const p = parse(persisted);
    if (p) last = { p: p.p, c: p.c };
  }
}
export const nodeId = () => node;

export function parse(v) {
  if (typeof v !== 'string') return null;
  const [p, c, n] = v.split('.');
  if (!p || !c) return null;
  return { p: parseInt(p, 36), c: parseInt(c, 36), n };
}
const fmt = (p, c, n) => `${p.toString(36).padStart(9, '0')}.${c.toString(36).padStart(4, '0')}.${n}`;

export function now(wall = Date.now()) {
  if (wall > last.p) last = { p: wall, c: 0 };
  else last = { p: last.p, c: last.c + 1 };
  return fmt(last.p, last.c, node);
}
/** Kalles når vi ser en versjon fra en annen enhet, så vår neste versjon blir nyere. */
export function observe(v, wall = Date.now()) {
  const r = parse(v);
  if (!r) return;
  // Ignorer stempler som ligger urimelig langt fram i tid (mer enn ett døgn), så én enhet med feil klokke ikke låser alle
  if (r.p > wall + 86400000) return;
  const p = Math.max(last.p, r.p, wall);
  let c = 0;
  if (p === last.p && p === r.p) c = Math.max(last.c, r.c) + 1;
  else if (p === last.p) c = last.c + 1;
  else if (p === r.p) c = r.c + 1;
  last = { p, c };
}
export const current = () => fmt(last.p, last.c, node);
