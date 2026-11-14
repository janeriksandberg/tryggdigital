// Første skjerm på en enhet som ikke er satt opp: gjør enheten til fast enhet, logg inn som administrator, eller prøv demo.
import { t } from '../i18n.js';
import { h, icon, qrEl, toast, confirmDialog } from '../ui.js';
import { S, startPairing, cancelPairing, enterDemo } from '../session.js';
import { IS_CONFIGURED } from '../config.js';
import { sha256Hex } from '../core/crypt.js';
import { go } from '../app.js';

export const pairPayload = (uid) => `TD2PAIR:${uid}`;
export async function pairCheck(uid) { return (await sha256Hex('pair:' + uid)).slice(0, 6).toUpperCase(); }

export function view() {
  return {
    async render() {
      if (S.pairing) return pairingScreen();
      const choice = (ic, title, text, onclick, act) => h('button', { class: 'choice', type: 'button', onclick, 'data-act': act }, h('span', { class: 'tile-ico' }, icon(ic, 28)), h('span', {}, h('strong', {}, title), h('span', {}, text)));
      return h('main', { class: 'center-page' }, h('div', { class: 'welcome-grid' },
        h('div', { class: 'hero' }, h('h1', {}, t('welcome.title')), h('p', {}, t('welcome.subtitle'))),
        IS_CONFIGURED ? choice('tablet', t('welcome.device'), t('welcome.deviceText'), startSetup, 'pair') : null,
        IS_CONFIGURED ? choice('shield', t('welcome.admin'), t('welcome.adminText'), () => go('login'), 'login') : null,
        choice('play', t('welcome.demo'), t('welcome.demoText'), async () => { await enterDemo(true); go(''); }, 'demo'),
        IS_CONFIGURED ? null : h('div', { class: 'notice warn' }, icon('info'), h('p', {}, t('welcome.notConfigured')))));
    },
  };
}

async function startSetup() {
  if (!navigator.onLine) { toast(t('pair.needsNet'), 'error'); return; }
  try { await startPairing(); } catch (e) { toast(t('pair.failed') + ' ' + (e.code || e.message), 'error'); }
}

async function pairingScreen() {
  const uid = S.pairing.uid;
  const check = await pairCheck(uid);
  return h('main', { class: 'center-page' }, h('div', { class: 'card auth-card', style: { width: 'min(620px, 100%)' } },
    h('div', { class: 'stack' },
      h('h1', {}, t('pair.title')),
      h('ol', { class: 'steps' }, h('li', {}, t('pair.step1')), h('li', {}, t('pair.step2')), h('li', {}, t('pair.step3'))),
      h('div', { class: 'row wrap', style: { justifyContent: 'center', gap: '24px' } },
        qrEl(pairPayload(uid), 220),
        h('div', { class: 'stack tight', style: { minWidth: '220px' } },
          h('span', { class: 'muted' }, t('pair.checkLabel')), h('div', { class: 'pair-code', 'data-pair-check': check }, check),
          h('span', { class: 'muted small' }, t('pair.idLabel')), h('code', { class: 'mono small', 'data-pair-uid': uid, style: { wordBreak: 'break-all' } }, uid))),
      h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('span', { class: 'muted' }, t('pair.waiting'))),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog(t('pair.cancelTitle'), t('pair.cancelText'), t('pair.cancel'))) { await cancelPairing(); } } }, t('pair.cancel'))))));
}
