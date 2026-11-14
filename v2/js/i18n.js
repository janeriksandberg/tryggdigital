// Språk. Norsk (nb) er kildespråket. Manglende tekst faller tilbake til engelsk, deretter norsk.
// Språkfilene i lang/ lastes ved behov og lagres av service workeren for bruk offline.
import nb from './lang/nb.js';
import en from './lang/en.js';
import { LANGS } from './lang/index.js';

export { LANGS };
const tables = { nb, en };
const LKEY = 'td2.lang';
let current = 'nb';
let deviceLang = 'nb';
const listeners = new Set();

function detect() {
  try { const s = localStorage.getItem(LKEY); if (s && LANGS.some((l) => l.code === s)) return s; } catch { /* */ }
  for (const n of navigator.languages || [navigator.language || 'nb']) {
    const c = String(n).toLowerCase();
    const hit = LANGS.find((l) => l.code === c) || LANGS.find((l) => l.code === c.slice(0, 2)) || (['no', 'nn'].includes(c.slice(0, 2)) ? LANGS[0] : null);
    if (hit) return hit.code;
  }
  return 'nb';
}

export const lang = () => current;
export const langInfo = (code = current) => LANGS.find((l) => l.code === code) || LANGS[0];
export const locale = () => langInfo().locale || current;
export const onLang = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function loadLang(code) {
  if (!tables[code]) tables[code] = (await import(`./lang/${code}.js`)).default;
  return tables[code];
}
/** Setter språk. persist=false brukes når en plukker midlertidig får sitt eget språk etter skanning. */
/** silent=true: bytt språk uten å tegne siden på nytt (brukes midt i en plukkers registrering, som tegnes etterpå). */
export async function setLang(code, { persist = true, silent = false } = {}) {
  if (!LANGS.some((l) => l.code === code)) code = 'nb';
  await loadLang(code);
  current = code;
  if (persist) { deviceLang = code; try { localStorage.setItem(LKEY, code); } catch { /* */ } }
  const info = langInfo(code);
  document.documentElement.lang = code;
  document.documentElement.dir = info.dir || 'ltr';
  if (!silent) for (const fn of listeners) try { fn(code); } catch { /* */ }
}
export const resetToDeviceLang = () => (current !== deviceLang ? setLang(deviceLang, { persist: false }) : Promise.resolve());
export const getDeviceLang = () => deviceLang;

export function t(key, vars) {
  let s = tables[current]?.[key] ?? tables.en[key] ?? tables.nb[key];
  if (s === undefined) { console.warn('Mangler tekst:', key); s = key; }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
/** Tekst på et bestemt språk (f.eks. personvernerklæring i plukkerens språk). */
export function tIn(code, key, vars) {
  let s = tables[code]?.[key] ?? tables.en[key] ?? tables.nb[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export const hasKey = (code, key) => !!tables[code] && key in tables[code];

export async function initLang() {
  const c = detect();
  deviceLang = c;
  await setLang(c, { persist: false });
}
