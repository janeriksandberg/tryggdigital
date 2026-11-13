// Språkstøtte. Rekkefølge i STRINGS: [nb, en, pl, lt, uk, vi]
import { STRINGS } from './strings.js';

export const LANGS = [
  { code: 'nb', name: 'Norsk', flag: '🇳🇴' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'lt', name: 'Lietuvių', flag: '🇱🇹' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
];
const IDX = { nb: 0, en: 1, pl: 2, lt: 3, uk: 4, vi: 5 };
const LKEY = 'tryggdigital.lang';

let current = (() => {
  try {
    const saved = localStorage.getItem(LKEY);
    if (saved && saved in IDX) return saved;
  } catch { /* */ }
  const nav = (navigator.language || 'nb').slice(0, 2).toLowerCase();
  // Norsk er standard; utenlandske plukkere får eget språk automatisk hvis enheten bruker et av dem
  return ['pl', 'lt', 'uk', 'vi'].includes(nav) ? nav : 'nb';
})();

export const lang = () => current;
export function setLang(code) {
  if (!(code in IDX)) return;
  current = code;
  try { localStorage.setItem(LKEY, code); } catch { /* */ }
  document.documentElement.lang = code === 'nb' ? 'nb' : code;
}
document.documentElement.lang = current === 'nb' ? 'nb' : current;

export function t(key, vars) {
  const row = STRINGS[key];
  let s = row ? row[IDX[current]] || row[0] : key;
  if (!row) console.warn('Mangler tekst:', key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
