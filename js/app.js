import { t, LANGS, lang, setLang } from './i18n.js';
import { h, modal } from './ui.js';
import { renderPicker } from './picker.js';
import { renderAdmin } from './admin.js';
import { renderSprayer } from './sprayer.js';

const app = document.getElementById('app');

function parseRoute() {
  const [role = '', tab = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { role, tab };
}

export function go(path) {
  if (location.hash !== '#/' + path) location.hash = '#/' + path;
  else render();
}

function langButton() {
  const cur = LANGS.find((l) => l.code === lang());
  return h('button', { class: 'lang-btn', onclick: openLang, 'aria-label': t('lang.choose') },
    h('span', { class: 'flag' }, cur.flag), h('span', { class: 'lang-name' }, cur.code.toUpperCase()));
}

export function openLang() {
  const grid = h('div', { class: 'lang-grid' },
    LANGS.map((l) => h('button', {
      type: 'button',
      class: `lang-option ${l.code === lang() ? 'active' : ''}`,
      onclick: () => { setLang(l.code); document.querySelector('.modal-wrap')?.remove(); render(); },
    }, h('span', { class: 'flag big' }, l.flag), h('span', {}, l.name))));
  modal('🌐 ' + t('lang.choose'), grid);
}

function header(role) {
  const roleLabel = { picker: t('role.picker'), admin: t('role.admin'), sprayer: t('role.sprayer') }[role];
  return h('header', { class: `topbar role-${role || 'home'}` },
    h('a', { class: 'brand', href: '#/' },
      h('img', { src: 'icons/icon.svg', alt: '', width: 36, height: 36 }),
      h('span', { class: 'brand-text' }, h('strong', {}, 'Tryggdigital'), roleLabel ? h('small', {}, roleLabel) : null)),
    h('div', { class: 'top-actions' },
      role ? h('a', { class: 'home-btn', href: '#/', 'aria-label': t('nav.home') }, '⌂') : null,
      langButton()));
}

function home() {
  const card = (role, icon, title, text, cls) =>
    h('a', { class: `role-card ${cls}`, href: `#/${role}` },
      h('div', { class: 'role-icon' }, icon),
      h('div', {}, h('h2', {}, title), h('p', {}, text)),
      h('span', { class: 'role-arrow' }, '→'));
  return h('main', { class: 'home' },
    h('section', { class: 'hero' },
      h('h1', {}, t('home.title')),
      h('p', {}, t('home.subtitle'))),
    h('div', { class: 'role-grid' },
      card('picker', '🍓', t('role.picker'), t('home.pickerText'), 'berry'),
      card('sprayer', '🚜', t('role.sprayer'), t('home.sprayerText'), 'leaf'),
      card('admin', '📊', t('role.admin'), t('home.adminText'), 'slate')),
    h('p', { class: 'home-note' }, t('home.localNote')));
}

export function render() {
  const { role, tab } = parseRoute();
  document.body.dataset.role = role || 'home';
  let main;
  if (role === 'picker') main = renderPicker();
  else if (role === 'admin') main = renderAdmin(tab);
  else if (role === 'sprayer') main = renderSprayer(tab);
  else main = home();
  app.replaceChildren(header(role), main);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();

// Be nettleseren om varig lagring, slik at data ikke slettes automatisk
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
