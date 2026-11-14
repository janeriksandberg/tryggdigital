// Felles hjelpere for visningene.
import * as store from '../core/store.js';
export function dbAll() {
  const o = { settings: store.settings() };
  for (const c of ['people', 'fields', 'varieties', 'crateTypes', 'products', 'shifts', 'crates', 'sprays', 'stock', 'pallets', 'consents', 'assignments', 'tasks', 'alerts']) o[c] = store.all(c);
  return o;
}
/** Hvem gjorde endringen (for _by). Administrator: e-post; demo: 'demo-admin'. */
import { S } from '../session.js';
export const actor = () => (S.mode === 'demo' ? 'demo-admin' : S.admin?.email || null);
/** Debounce for sanntidsoppdateringer. */
export function debounce(fn, ms = 250) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
