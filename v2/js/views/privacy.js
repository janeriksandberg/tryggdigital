// Personvernerklæring og bekreftelse. Vises for alle brukere første gang og hver gang innholdet endres
// (ny versjon av standardteksten eller endring i kundens opplysninger), på brukerens valgte språk.
import { t, tIn, lang, loadLang, langInfo, LANGS } from '../i18n.js';
import { h, icon, modal, fmtDateTime } from '../ui.js';
import * as store from '../core/store.js';
import { S } from '../session.js';
import { topbar } from '../app.js';

// Øk når standardteksten (pv.*-nøklene) endres innholdsmessig. Da må alle bekrefte på nytt.
export const PRIVACY_VERSION = '2026-11-14';
export const privacyKey = () => `${PRIVACY_VERSION}#${store.settings().privacyRev || 0}`;

export function hasAccepted(subjectId) {
  const key = privacyKey();
  return store.all('consents').some((c) => c.subjectId === subjectId && c.version === key);
}
export function recordConsent(subjectId, kind, code) {
  return store.put('consents', { id: `${subjectId}__${privacyKey().replace(/[^A-Za-z0-9-]/g, '_')}`, subjectId, kind, version: privacyKey(), lang: code, ts: new Date().toISOString(), device: S.installId }, kind === 'admin' ? subjectId : subjectId);
}

/** Selve teksten, bygget fra oversatte avsnitt og kundens egne opplysninger. */
export function privacyBody(code = lang()) {
  const st = store.settings();
  const vars = {
    controller: st.farmName || tIn(code, 'pv.yourEmployer'),
    orgNo: st.orgNo || '–',
    contact: [st.contactEmail, st.contactPhone].filter(Boolean).join(', ') || '–',
  };
  const tt = (k) => tIn(code, k, vars);
  const sec = (k, bullets) => [h('h3', {}, tt(`pv.${k}.h`)), bullets ? h('ul', {}, bullets.map((b) => h('li', {}, tt(`pv.${k}.${b}`)))) : h('p', {}, tt(`pv.${k}.p`))];
  return h('div', { class: 'privacy-text', lang: code, dir: langInfo(code).dir || 'ltr' },
    h('p', {}, h('strong', {}, tt('pv.intro'))),
    ...sec('what', ['b1', 'b2', 'b3', 'b4', 'b5']),
    ...sec('why', ['b1', 'b2', 'b3', 'b4']),
    ...sec('basis'),
    ...sec('who', ['b1', 'b2', 'b3', 'b4']),
    ...sec('keep'),
    ...sec('rights'),
    ...sec('card'),
    st.privacyExtra ? [h('h3', {}, tt('pv.extra.h')), h('p', { lang: 'nb' }, st.privacyExtra)] : null,
    h('p', { class: 'small muted' }, tt('pv.version'), ' ', privacyKey()));
}

// Én åpen forespørsel per person: hvis visningen tegnes på nytt mens erklæringen vises,
// gjenbrukes samme dialog i stedet for å legge en ny oppå.
const pending = new Map();

/** Viser erklæringen og ber om bekreftelse. Returnerer true hvis bekreftet. */
export function askConsent(opts) {
  const key = opts.subjectId;
  if (!pending.has(key)) pending.set(key, showConsent(opts).finally(() => pending.delete(key)));
  return pending.get(key);
}

async function showConsent({ subjectId, kind, name, code = lang() }) {
  await loadLang(code);
  const body = h('div', { class: 'stack', lang: code },
    name ? h('p', {}, h('strong', {}, tIn(code, 'pv.hello', { name }))) : null,
    h('p', {}, tIn(code, 'pv.lead')),
    privacyBody(code));
  const ok = await modal(tIn(code, 'pv.title'), body, [
    { label: tIn(code, 'pv.decline'), class: 'ghost', value: false },
    { label: tIn(code, 'pv.accept'), class: 'primary xl', value: true, icon: 'check', id: 'accept-privacy' },
  ], { wide: true, locked: true });
  if (ok) recordConsent(subjectId, kind, code);
  return !!ok;
}

export function view() {
  return {
    topbar: () => topbar(),
    render() {
      return h('main', { class: 'flow' }, h('div', { class: 'card stack' }, h('h1', {}, t('pv.title')), privacyBody(lang())));
    },
  };
}
