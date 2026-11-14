// Support-panel: åpnes fra statusmerket øverst. Viser alt support trenger for å hjelpe over telefon,
// og lar brukeren koble nettbrett direkte sammen uten internett.
import { t } from '../i18n.js';
import { h, icon, modal, toast, fmtAgo, qrEl, download, versionText } from '../ui.js';
import { S, syncNow, sendDiag, diagnostics, lanSync } from '../session.js';
import { recent } from '../core/log.js';
import { scan } from '../scanner.js';
import * as store from '../core/store.js';

export const supportCode = () => (S.installId || '').slice(0, 6).toUpperCase();

export async function openSupport() {
  const d = await diagnostics();
  const n = S.net;
  const statusText = S.mode === 'demo' ? t('net.demo') : (!n.connected || !navigator.onLine) ? t('net.offline') : n.pending ? t('net.sending', { n: n.pending }) : t('net.online');
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v ?? '–')];
  const lan = lanSync();
  const body = h('div', { class: 'stack' },
    h('div', { class: 'notice' }, icon('support'), h('div', {}, h('p', {}, t('support.callText')), h('div', { class: 'support-code', 'data-support-code': '' }, supportCode()))),
    h('dl', { class: 'diag' },
      ...row(t('support.status'), statusText),
      ...row(t('support.pending'), String(n.pending)),
      ...row(t('support.lastContact'), fmtAgo(n.lastServer)),
      ...row(t('support.peers'), String(n.peers || 0)),
      ...row(t('support.customer'), S.tenantName || S.tenantId || '–'),
      ...row(t('support.device'), S.device ? `${S.device.name || ''} (${S.device.uid.slice(0, 8)}…)` : S.mode === 'admin' ? t('support.adminPc') : '–'),
      ...row(t('support.version'), versionText()),
      ...row(t('support.storage'), d.storageUsedMb != null ? `${d.storageUsedMb} MB${d.persisted ? ' · ' + t('support.persisted') : ''}` : '–'),
      ...row(t('support.offlineReady'), d.swControlled ? t('common.yes') : t('common.no')),
      n.error ? row(t('support.error'), n.error) : null),
    h('div', { class: 'row wrap' },
      S.mode !== 'demo' ? h('button', { class: 'btn light', type: 'button', onclick: () => { syncNow(); toast(t('support.syncStarted')); } }, icon('sync', 18), t('support.syncNow')) : null,
      S.mode === 'device' ? h('button', { class: 'btn light', type: 'button', onclick: async () => toast((await sendDiag()) ? t('support.diagSent') : t('support.diagNotSent'), 'info') }, icon('send', 18), t('support.sendDiag')) : null,
      h('button', { class: 'btn light', type: 'button', onclick: async () => download(`tryggdigital-diagnose-${supportCode()}.json`, JSON.stringify(await diagnostics(), null, 2), 'application/json') }, icon('download', 18), t('support.downloadDiag'))),
    lan && S.mode !== 'demo' ? h('div', { class: 'card flat stack' },
      h('h3', {}, icon('lan', 18), ' ', t('lan.title')),
      h('p', { class: 'muted small' }, t('lan.explain')),
      lan.peerList().length ? h('ul', {}, lan.peerList().map((p) => h('li', {}, `${p.id.slice(0, 6)} · ${p.authed ? t('lan.connected') : p.state} · ${p.via === 'qr' ? 'QR' : 'auto'}`))) : h('p', { class: 'small' }, t('lan.none')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn light', type: 'button', 'data-act': 'lan-offer', onclick: () => lanOffer(lan) }, icon('qr', 18), t('lan.show')),
        h('button', { class: 'btn light', type: 'button', 'data-act': 'lan-scan', onclick: () => lanAccept(lan) }, icon('scan', 18), t('lan.scan')))) : null,
    h('details', {}, h('summary', {}, t('support.log')), h('div', { class: 'log' }, recent(40).map((e) => `${e.ts.slice(11, 19)} ${e.area} ${e.msg}${e.data ? ' ' + e.data : ''}`).join('\n') || '–')));
  modal(t('support.title'), body, [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
}

async function lanOffer(lan) {
  if (!store.settings().lanKey) return toast(t('lan.noKey'), 'error');
  const code = await lan.createOfferCode();
  const res = await modal(t('lan.step1Title'), h('div', { class: 'stack', style: { alignItems: 'center' } },
    h('p', {}, t('lan.step1Text')), qrEl(code, 300, 'L'), h('textarea', { class: 'input mono small', readonly: true, rows: 3, 'data-lan-offer': '' }, code)),
  [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('lan.scanAnswer'), class: 'primary', value: 'scan', icon: 'scan' }], { wide: true });
  if (res !== 'scan') return;
  const ans = await scan({ title: t('lan.scanAnswer'), hint: t('lan.scanAnswerHint'), placeholder: 'TD2L2…' });
  if (!ans) return;
  try { await lan.acceptAnswerCode(ans.trim()); toast(t('lan.connecting')); } catch (e) { toast(t('lan.failed') + ' ' + e.message, 'error'); }
}
async function lanAccept(lan) {
  if (!store.settings().lanKey) return toast(t('lan.noKey'), 'error');
  const offer = await scan({ title: t('lan.scan'), hint: t('lan.scanOfferHint'), placeholder: 'TD2L1…' });
  if (!offer) return;
  try {
    const answer = await lan.acceptOfferCode(offer.trim());
    await modal(t('lan.step2Title'), h('div', { class: 'stack', style: { alignItems: 'center' } }, h('p', {}, t('lan.step2Text')), qrEl(answer, 300, 'L'), h('textarea', { class: 'input mono small', readonly: true, rows: 3, 'data-lan-answer': '' }, answer)), [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
  } catch (e) { toast(t('lan.failed') + ' ' + e.message, 'error'); }
}
