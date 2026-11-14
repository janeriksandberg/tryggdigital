// Enheter (nettbrett/mobiler) som er godkjent for kunden. Krever nett, fordi listen hentes fra Firestore.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, fmtAgo, empty } from '../../ui.js';
import { S, firebase, registerDevice, registerThisDevice } from '../../session.js';
import { scan } from '../../scanner.js';
import { pairCheck } from '../welcome.js';
import { pageHead } from './index.js';
import { go } from '../../app.js';

let unsub = null;
export function destroy() { unsub?.(); unsub = null; }

export function render(ctx) {
  destroy();
  const head = pageHead(t('nav.devices'), t('devices.text'),
    S.mode === 'admin' ? h('button', { class: 'btn light', 'data-act': 'this-device', onclick: () => thisDevice() }, icon('tablet', 18), t('devices.thisDevice')) : null,
    S.mode !== 'demo' ? h('button', { class: 'btn primary', 'data-act': 'add-device', onclick: () => addDevice() }, icon('plus', 18), t('devices.add')) : null);
  const how = h('div', { class: 'card stack' }, h('h3', {}, t('devices.howTitle')), h('ol', { class: 'steps' }, h('li', {}, t('devices.how1')), h('li', {}, t('devices.how2')), h('li', {}, t('devices.how3'))), h('p', { class: 'muted small' }, t('devices.security')));
  if (S.mode === 'demo') return h('div', { class: 'stack' }, head, h('div', { class: 'notice warn' }, icon('info'), h('p', {}, t('devices.demo'))), how);
  const body = h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), t('common.loading')));
  const { F, fb } = firebase();
  const db = fb('admin').db;
  unsub = F.onSnapshot(F.query(F.collection(db, 'devices'), F.where('tenantId', '==', S.tenantId)), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
    body.replaceChildren(list.length ? table(list) : empty('tablet', t('devices.none')));
  }, (e) => body.replaceChildren(h('div', { class: 'notice warn' }, icon('cloudOff'), h('p', {}, t('devices.needsNet'), ' (', e.code || e.message, ')'))));
  return h('div', { class: 'stack' }, head, body, how);
}

function table(list) {
  const { F, fb } = firebase();
  const db = fb('admin').db;
  const ref = (id) => F.doc(db, 'devices', id);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, t('devices.name')), h('th', {}, t('devices.status')), h('th', {}, t('devices.lastSeen')), h('th', { class: 'num' }, t('support.pending')), h('th', {}, t('support.version')), h('th', {}, ''))),
    h('tbody', {}, list.map((d) => {
      const seen = d.lastSeen?.toMillis?.() || 0;
      const recent = Date.now() - seen < 15 * 60 * 1000;
      return h('tr', { 'data-device': d.name },
        h('td', {}, h('strong', {}, d.name || '–'), h('div', { class: 'small muted mono' }, d.id.slice(0, 10) + '…', d.id === S.device?.uid ? ` · ${t('devices.thisOne')}` : '')),
        h('td', {}, d.status === 'active' ? h('span', { class: `tag ${recent ? 'ok' : ''}` }, recent ? t('devices.online') : t('devices.active')) : h('span', { class: 'tag bad' }, t('devices.revoked'))),
        h('td', {}, seen ? fmtAgo(seen) : '–'),
        h('td', { class: 'num' }, d.diag?.pending ?? '–'),
        h('td', {}, d.appVersion || '–'),
        h('td', { class: 'num' }, h('div', { class: 'row end' },
          h('button', { class: 'icon-btn', title: t('devices.details'), 'aria-label': t('devices.details'), onclick: () => details(d) }, icon('info', 18)),
          h('button', { class: 'icon-btn', title: t('devices.rename'), 'aria-label': t('devices.rename'), onclick: async () => { const n = await askName(d.name); if (n) await F.updateDoc(ref(d.id), { name: n }); } }, icon('edit', 18)),
          d.status === 'active'
            ? h('button', { class: 'btn small danger-light', 'data-act': 'revoke', onclick: async () => {
              if (d.diag?.pending > 0 && !(await confirmDialog(t('devices.pendingTitle'), t('devices.pendingText', { n: d.diag.pending }), t('devices.revokeAnyway')))) return;
              if (await confirmDialog(t('devices.revokeTitle'), t('devices.revokeText', { name: d.name }), t('devices.revoke'))) { await F.updateDoc(ref(d.id), { status: 'revoked' }); toast(t('devices.revokedToast')); }
            } }, t('devices.revoke'))
            : h('button', { class: 'btn small light', onclick: async () => { await F.updateDoc(ref(d.id), { status: 'active' }); } }, t('devices.reactivate')))));
    }))));
}

async function details(d) {
  const { F, fb } = firebase();
  const ref = F.doc(fb('admin').db, 'devices', d.id);
  const diag = d.diag || {};
  await modal(d.name || d.id, h('div', { class: 'stack' },
    h('dl', { class: 'diag' }, ...[['ID', d.id], [t('support.version'), d.appVersion], [t('support.pending'), diag.pending], [t('support.peers'), diag.peers], [t('support.lastContact'), diag.lastServer ? fmtAgo(diag.lastServer) : '–'], [t('support.storage'), diag.storageUsedMb != null ? diag.storageUsedMb + ' MB' : '–'], [t('support.offlineReady'), diag.swControlled ? t('common.yes') : t('common.no')], [t('support.error'), diag.syncError || '–'], ['UA', diag.ua], [t('devices.addedBy'), d.addedBy]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '–')])),
    diag.log?.length ? h('details', {}, h('summary', {}, t('support.log')), h('div', { class: 'log' }, diag.log.map((e) => `${e.ts?.slice(5, 19)} ${e.area} ${e.msg}${e.data ? ' ' + e.data : ''}`).join('\n'))) : null),
  [
    { label: t('devices.requestDiag'), class: 'light', onClick: async () => { await F.updateDoc(ref, { cmd: { ...(d.cmd || {}), diag: Date.now() } }); toast(t('devices.requested')); return false; } },
    { label: t('devices.requestResync'), class: 'light', onClick: async () => { await F.updateDoc(ref, { cmd: { ...(d.cmd || {}), resync: Date.now() } }); toast(t('devices.requested')); return false; } },
    { label: t('common.close'), class: 'primary', value: true },
  ], { wide: true });
}

async function askName(cur = '') {
  const name = input({ value: cur, required: true, maxlength: 60, name: 'devname', placeholder: t('devices.namePh') });
  return modal(t('devices.name'), field(t('devices.name'), name), [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.save'), class: 'primary', submit: true, onClick: () => name.value.trim() || (name.focus(), false) }]);
}

async function addDevice() {
  const raw = await scan({ title: t('devices.scanPair'), hint: t('devices.scanPairHint'), placeholder: 'TD2PAIR:…' });
  if (!raw) return;
  const uid = String(raw).trim().replace(/^TD2PAIR:/, '');
  if (!/^[A-Za-z0-9]{20,40}$/.test(uid)) return toast(t('devices.badCode'), 'error');
  const check = await pairCheck(uid);
  const name = input({ required: true, maxlength: 60, name: 'devname', placeholder: t('devices.namePh') });
  const r = await modal(t('devices.confirmTitle'), h('div', { class: 'stack' }, h('p', {}, t('devices.confirmText')), h('div', { class: 'pair-code', 'data-check': check }, check), field(t('devices.name'), name)),
    [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('devices.approve'), class: 'primary', submit: true, id: 'approve', onClick: () => name.value.trim() || (name.focus(), false) }]);
  if (!r) return;
  try { await registerDevice(uid, S.tenantId, r); toast(t('devices.approved')); } catch (e) { toast(t('devices.approveFailed') + ' ' + (e.code || e.message), 'error'); }
}

async function thisDevice() {
  const name = await askName('');
  if (!name) return;
  if (!(await confirmDialog(t('devices.thisDevice'), t('devices.thisDeviceText'), t('devices.approve'), false))) return;
  try { await registerThisDevice(S.tenantId, name); toast(t('devices.approved')); go(''); } catch (e) { toast(t('devices.approveFailed') + ' ' + (e.code || e.message), 'error'); }
}
