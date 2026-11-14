// Tryggdigital v2 – oppstart, ruting og felles topplinje.
import { t, LANGS, lang, setLang, initLang, onLang, langInfo } from './i18n.js';
import { h, icon, modal, toast, fmtAgo, clear } from './ui.js';
import { S, init, onSession, dismissNotice } from './session.js';
import * as store from './core/store.js';
import { log } from './core/log.js';
import { openSupport } from './views/support.js';

const app = document.getElementById('app');
let current = null;

export function route() {
  const [area = '', page = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { area, page, sub };
}
export function go(path) {
  const target = '#/' + path;
  if (location.hash !== target) location.hash = target; else render();
}

// ---------- Topplinje ----------
export function netBadge() {
  const n = S.net;
  let cls, ic, label;
  if (S.mode === 'demo') { cls = 'local'; ic = 'database'; label = t('net.demo'); }
  else if (!S.tenantId) { cls = navigator.onLine ? 'online' : 'offline'; ic = navigator.onLine ? 'wifi' : 'offline'; label = navigator.onLine ? t('net.online') : t('net.offline'); }
  else if (!n.connected || !navigator.onLine) { cls = 'offline'; ic = 'cloudOff'; label = t('net.offline'); }
  else if (n.pending > 0) { cls = 'syncing'; ic = 'sync'; label = t('net.sending', { n: n.pending }); }
  else { cls = 'online'; ic = 'cloud'; label = t('net.online'); }
  const title = cls === 'offline' ? t('net.offlineHelp', { n: n.pending }) : t('net.lastContact', { ago: fmtAgo(n.lastServer) });
  return h('button', { class: `net ${cls}`, type: 'button', title, 'aria-label': `${label}. ${title}`, 'data-net': cls, onclick: () => openSupport() },
    icon(ic, 20), h('span', { class: `net-label ${cls === 'offline' ? '' : 'hide-sm'}` }, label),
    n.peers > 0 ? h('span', { class: 'lan', title: t('net.peers', { n: n.peers }) }, icon('lan', 16), String(n.peers)) : null);
}

export function langButton(light = true) {
  const cur = langInfo();
  return h('button', { class: light ? 'top-btn' : 'btn light', type: 'button', onclick: openLang, 'aria-label': t('lang.choose') }, icon('languages', 20), h('span', {}, cur.code.toUpperCase()));
}
export function openLang(onPick) {
  const grid = h('div', { class: 'lang-grid' }, LANGS.map((l) => h('button', {
    type: 'button', class: `lang-option ${l.code === lang() ? 'on' : ''}`, lang: l.code, dir: l.dir || 'ltr',
    onclick: async () => { await setLang(l.code); document.querySelector('.modal-wrap')?.remove(); if (typeof onPick === 'function') onPick(l.code); else render(); },
  }, h('strong', {}, l.name), h('small', {}, l.en, l.scope === 'worker' ? ` · ${t('lang.workerOnly')}` : ''))));
  modal(t('lang.choose'), h('div', { class: 'stack' }, grid, h('p', { class: 'small muted' }, t('lang.note'))), [], { wide: true });
}

export function topbar({ kind = 'kiosk', title, subtitle, actions = [] } = {}) {
  const sub = subtitle ?? (S.tenantName || '');
  return h('header', { class: `topbar ${S.mode === 'demo' ? 'demo' : kind}` },
    h('a', { class: 'brand', href: '#/', 'aria-label': t('nav.home') },
      h('img', { src: 'icons/icon.svg', alt: '', width: 38, height: 38 }),
      h('span', { class: 'brand-text' }, h('strong', {}, title || 'Tryggdigital'), sub ? h('small', {}, sub) : null)),
    h('div', { class: 'top-actions' }, actions, netBadge(), langButton()));
}

function banners() {
  const out = [];
  if (S.mode === 'demo') out.push(h('div', { class: 'banner demo', role: 'status' }, icon('info', 18), t('demo.banner')));
  else if (S.tenantId && (!navigator.onLine || !S.net.connected) && S.ready) out.push(h('div', { class: 'banner offline', role: 'status', 'data-banner': 'offline' }, icon('cloudOff', 18), t('net.offlineBanner', { n: S.net.pending })));
  if (S.notice) out.push(h('div', { class: 'banner warn', role: 'alert' }, icon('alert', 18), t(S.notice), h('button', { class: 'btn small light', onclick: dismissNotice }, t('common.ok'))));
  if (updateReady) out.push(h('div', { class: 'banner demo' }, icon('download', 18), t('app.updateReady'), h('button', { class: 'btn small primary', onclick: applyUpdate }, t('app.update'))));
  return out;
}

// ---------- Rendering ----------
let rendering = false, again = false;
export async function render() {
  if (rendering) { again = true; return; }
  rendering = true;
  try {
    if (!S.ready) { clear(app, h('div', { class: 'boot' }, 'Tryggdigital …')); return; }
    const r = route();
    const view = await pickView(r);
    current?.destroy?.();
    current = view;
    const body = await view.render(r);
    clear(app, ...[].concat(view.topbar ? view.topbar() : topbar()), ...banners(), body);
    document.body.dataset.area = r.area || 'home';
  } catch (e) {
    log('error', 'Visning feilet', { msg: e.message, stack: String(e.stack).slice(0, 300) });
    clear(app, topbar(), h('div', { class: 'center-page' }, h('div', { class: 'card auth-card' }, h('h2', {}, t('app.error')), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn primary', href: '#/' }, t('nav.home')))));
  } finally {
    rendering = false;
    if (again) { again = false; render(); }
  }
}
/** Oppdaterer bare topplinjen (statusmerke) uten å tegne siden på nytt, så skjemaer ikke mister innhold. */
function refreshChrome() {
  const old = app.querySelector('.net');
  if (old) old.replaceWith(netBadge());
  const oldBanners = [...app.querySelectorAll(':scope > .banner')];
  const fresh = banners();
  if (oldBanners.length !== fresh.length || oldBanners.some((b, i) => b.textContent !== fresh[i].textContent)) {
    oldBanners.forEach((b) => b.remove());
    app.querySelector('.topbar')?.after(...fresh);
  }
}

async function pickView({ area }) {
  const needsAdmin = area === 'admin' || area === 'super';
  if (area === 'login') return (await import('./views/login.js')).view();
  if (area === 'privacy') return (await import('./views/privacy.js')).view();
  if (needsAdmin) {
    if (!S.tenantId && area === 'admin' && S.admin?.mfa) return (await import('./views/tenants.js')).view();
    if (area === 'super') return (await import('./views/super.js')).view();
    return (await import('./views/admin/index.js')).view();
  }
  if (area === 'work') return (await import('./views/work.js')).view();
  if (S.mode === 'device' || S.mode === 'demo') return (await import('./views/kiosk.js')).view();
  if (S.mode === 'admin') return S.tenantId ? (await import('./views/admin/index.js')).view() : (await import('./views/tenants.js')).view();
  return (await import('./views/welcome.js')).view();
}

// ---------- Oppdateringer av appen ----------
let updateReady = false, waitingWorker = null;
function applyUpdate() { waitingWorker?.postMessage('skipWaiting'); }
// Ny versjon tas i bruk automatisk når ingen holder på med noe (ingen dialog, skanner, skjema eller registrering),
// slik at en vanlig omlasting ikke blir stående på gammel versjon. Ellers vises knappen «Oppdater nå».
function idleForUpdate() {
  if (document.querySelector('.modal-wrap, .scanner, [data-flow], [data-form], .big-result, .work-main')) return false;
  const a = document.activeElement;
  return !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
let autoTimer = null;
function autoApply() {
  if (autoTimer) return;
  const tryNow = () => { if (waitingWorker && idleForUpdate()) { clearInterval(autoTimer); applyUpdate(); } };
  autoTimer = setInterval(tryNow, 15000);
  tryNow();
}
async function registerSw() {
  if (!('serviceWorker' in navigator) || !['https:'].includes(location.protocol) && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    const onWaiting = (w) => { waitingWorker = w; updateReady = true; refreshChrome(); autoApply(); };
    if (reg.waiting && navigator.serviceWorker.controller) onWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) onWaiting(nw); });
    });
    // Last siden på nytt bare når en NY versjon tar over (ikke første gang appen installeres),
    // og vent til alle lokale skrivinger er lagret først, så ingenting går tapt.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      try { await (await import('./core/store.js')).flushWrites(); } catch { /* */ }
      location.reload();
    });
    // Se etter ny versjon hvert 10. minutt og når appen kommer fram på skjermen igjen.
    setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch (e) { log('app', 'Service worker ble ikke registrert', { msg: e.message }); }
}

// ---------- Oppstart ----------
(async () => {
  // Mot «clickjacking»: GitHub Pages kan ikke sende frame-ancestors-header, så appen nekter å kjøre inne i en ramme.
  if (window.top !== window.self) { document.getElementById('app').textContent = 'Tryggdigital kan ikke vises inne i en annen side.'; return; }
  await initLang();
  onLang(() => render());
  window.addEventListener('hashchange', render);
  let lastKey = '';
  onSession(() => {
    const key = [S.ready, S.mode, S.tenantId, !!S.admin, S.admin?.mfa, S.admin?.tenants?.length, !!S.pairing, S.notice].join('|');
    if (key !== lastKey) { lastKey = key; render(); } else refreshChrome();
  });
  store.subscribe((ev) => { if (ev.type === 'reset') render(); else current?.onData?.(ev); });
  window.addEventListener('online', refreshChrome);
  window.addEventListener('offline', refreshChrome);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  registerSw();
  render();
  try { await init(); } catch (e) { log('error', 'Oppstart feilet', { msg: e.message }); S.ready = true; render(); toast(e.message, 'error'); }
})();
