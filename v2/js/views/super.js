// Superadministrator: alle kunder i én oversikt, alle enheter, administratorer per kunde,
// og sikkerhetskopi/gjenoppretting av hele løsningen. Krever nett (leser direkte fra Firestore).
import { t } from '../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty, fmtAgo, fmtDateTime, download, pickFile, clear } from '../ui.js';
import { S, firebase, refreshAdmin, chooseTenant } from '../session.js';
import { topbar, go } from '../app.js';
import { COLLECTION_NAMES } from '../core/schema.js';
import * as hlc from '../core/hlc.js';
import { FORMAT, seal, open as openBackup, summarize } from '../core/backup.js';
import { encode, decode } from '../net/fb.js';

const TABS = [['tenants', 'building', 'super.tenants'], ['devices', 'tablet', 'super.devices'], ['backup', 'backup', 'super.backup']];
let unsub = [];
const stop = () => { unsub.forEach((u) => u()); unsub = []; };

export function view() {
  return {
    topbar: () => topbar({ kind: 'admin', title: t('super.title'), subtitle: S.admin?.email || '' }),
    render(r) {
      stop();
      if (!S.admin?.isSuper) { setTimeout(() => go(S.admin?.mfa ? 'admin' : 'login'), 0); return h('div'); }
      if (!navigator.onLine) return h('main', { class: 'center-page' }, h('div', { class: 'notice warn' }, icon('cloudOff'), h('p', {}, t('super.needsNet'))));
      const tab = TABS.some((x) => x[0] === r.page) ? r.page : 'tenants';
      const content = h('div', { class: 'stack' });
      if (tab === 'tenants') tenantsTab(content);
      if (tab === 'devices') devicesTab(content);
      if (tab === 'backup') backupTab(content);
      return h('main', { class: 'super-main' },
        h('div', { class: 'row wrap', style: { marginBottom: '16px' } },
          h('div', { class: 'seg' }, TABS.map(([id, ic, key]) => h('a', { href: `#/super/${id}`, class: id === tab ? 'on' : '' }, icon(ic, 18), t(key)))),
          h('div', { class: 'grow' }),
          S.tenantId ? h('a', { class: 'btn light', href: '#/admin/overview' }, icon('chevLeft', 18), t('super.backToTenant')) : null),
        content);
    },
    destroy: stop,
  };
}

const db = () => firebase().fb('admin').db;
const F = () => firebase().F;

// ---------- Kunder ----------
function tenantsTab(box) {
  const list = h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), t('common.loading')));
  let devices = [];
  let tenants = [];
  const draw = () => {
    const count = (id) => devices.filter((d) => d.tenantId === id && d.status === 'active');
    const recent = (id) => count(id).filter((d) => Date.now() - (d.lastSeen?.toMillis?.() || 0) < 15 * 60e3).length;
    const issues = (id) => count(id).filter((d) => d.diag?.syncError || (d.diag?.pending || 0) > 50).length;
    list.replaceChildren(tenants.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-tenants': '' },
      h('thead', {}, h('tr', {}, ...[t('super.name'), 'ID', t('super.status'), t('super.devicesCol'), t('super.onlineNow'), t('super.issues'), ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, tenants.map((tn) => h('tr', { 'data-tenant': tn.name },
        h('td', {}, h('strong', {}, tn.name), tn.contact ? h('div', { class: 'small muted' }, tn.contact) : null),
        h('td', { class: 'mono small' }, tn.id),
        h('td', {}, tn.status === 'closed' ? h('span', { class: 'tag bad' }, t('super.closed')) : h('span', { class: 'tag ok' }, t('super.active'))),
        h('td', {}, String(count(tn.id).length)), h('td', {}, String(recent(tn.id))),
        h('td', {}, issues(tn.id) ? h('span', { class: 'tag warn' }, String(issues(tn.id))) : '–'),
        h('td', { class: 'num' }, h('div', { class: 'row end' },
          h('button', { class: 'btn small primary', onclick: async () => { await refreshAdmin(); await chooseTenant(tn.id); go('admin/overview'); } }, t('super.open')),
          h('button', { class: 'icon-btn', title: t('super.admins'), 'aria-label': t('super.admins'), onclick: () => adminsDialog(tn) }, icon('users', 18)),
          h('button', { class: 'icon-btn', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => editTenant(tn) }, icon('edit', 18)))))))))
      : empty('building', t('super.noTenants')));
  };
  unsub.push(F().onSnapshot(F().collection(db(), 'tenants'), (snap) => { tenants = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb')); draw(); }, (e) => list.replaceChildren(errBox(e))));
  unsub.push(F().onSnapshot(F().collection(db(), 'devices'), (snap) => { devices = snap.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); }, () => {}));
  box.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, t('super.tenants')), h('p', {}, t('super.tenantsText'))),
    h('button', { class: 'btn primary', 'data-act': 'new-tenant', onclick: () => editTenant(null) }, icon('plus', 18), t('super.newTenant'))), list);
}
const errBox = (e) => h('div', { class: 'notice bad' }, icon('alert'), h('p', {}, t('super.loadError'), ' ', e.code || e.message));

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function editTenant(tn) {
  const name = input({ value: tn?.name || '', required: true, name: 'name', maxlength: 120 });
  const id = input({ value: tn?.id || '', name: 'id', disabled: !!tn || null, pattern: '[a-z0-9-]{3,40}' });
  if (!tn) name.addEventListener('input', () => { if (!id.dataset.touched) id.value = slugify(name.value); });
  id.addEventListener('input', () => { id.dataset.touched = '1'; });
  const contact = input({ value: tn?.contact || '', name: 'contact', maxlength: 120 });
  const status = select([['active', t('super.active')], ['closed', t('super.closed')]], tn?.status || 'active', { name: 'status' });
  const adminEmail = input({ type: 'email', name: 'adminEmail', placeholder: 'navn@gard.no' });
  const r = await modal(tn ? t('super.editTenant') : t('super.newTenant'), h('div', { class: 'form-grid' },
    field(t('super.name'), name), field('ID', id, tn ? null : t('super.idHint')), field(t('super.contact'), contact), field(t('super.status'), status),
    tn ? null : field(t('super.firstAdmin'), adminEmail, t('super.firstAdminHint'))),
  [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
    if (!name.value.trim()) return (name.focus(), false);
    if (!/^[a-z0-9-]{3,40}$/.test(id.value)) { toast(t('super.badId'), 'error'); return false; }
    return true;
  } }], { wide: true });
  if (!r) return;
  try {
    const ref = F().doc(db(), 'tenants', id.value);
    if (!tn && (await F().getDoc(ref)).exists()) return toast(t('super.idTaken'), 'error');
    await F().setDoc(ref, { name: name.value.trim(), contact: contact.value.trim(), status: status.value, ...(tn ? {} : { createdAt: F().serverTimestamp(), createdBy: S.admin.email }) }, { merge: true });
    const em = adminEmail.value.trim().toLowerCase();
    if (!tn && em) await F().setDoc(F().doc(db(), 'tenants', id.value, 'admins', em), { email: em, addedBy: S.admin.email, addedAt: F().serverTimestamp() });
    toast(t('common.saved'));
    await refreshAdmin();
  } catch (e) { toast(t('super.saveError') + ' ' + (e.code || e.message), 'error'); }
}

async function adminsDialog(tn) {
  const body = h('div', { class: 'stack' });
  const col = F().collection(db(), 'tenants', tn.id, 'admins');
  const email = input({ type: 'email', name: 'email', placeholder: 'navn@gard.no' });
  const draw = async () => {
    const snap = await F().getDocs(col);
    clear(body, 
      h('div', { class: 'list' }, snap.docs.length ? snap.docs.map((d) => h('div', { class: 'list-item' }, icon('user', 18), h('span', { class: 'grow' }, d.id),
        h('button', { class: 'btn small danger-light', type: 'button', onclick: async () => { if (await confirmDialog(t('super.removeAdmin'), t('super.removeAdminText', { email: d.id }), t('common.delete'))) { await F().deleteDoc(d.ref); draw(); } } }, t('common.delete')))) : h('p', { class: 'muted' }, t('super.noAdmins'))),
      h('div', { class: 'row' }, email, h('button', { class: 'btn light', type: 'button', onclick: async () => {
        const em = email.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast(t('super.badEmail'), 'error');
        await F().setDoc(F().doc(col, em), { email: em, addedBy: S.admin.email, addedAt: F().serverTimestamp() });
        email.value = ''; draw();
      } }, icon('plus', 16), t('super.addAdmin'))),
      h('p', { class: 'small muted' }, t('super.adminsHint')));
  };
  draw().catch((e) => body.replaceChildren(errBox(e)));
  await modal(t('super.adminsFor', { name: tn.name }), body, [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
}

// ---------- Alle enheter ----------
function devicesTab(box) {
  const list = h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), t('common.loading')));
  let tenants = [];
  F().getDocs(F().collection(db(), 'tenants')).then((s) => { tenants = s.docs.map((d) => ({ id: d.id, name: d.data().name })); }).catch(() => {});
  unsub.push(F().onSnapshot(F().collection(db(), 'devices'), (snap) => {
    const ds = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.tenantId || '').localeCompare(b.tenantId || '') || (a.name || '').localeCompare(b.name || ''));
    list.replaceChildren(ds.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-all-devices': '' },
      h('thead', {}, h('tr', {}, ...[t('devices.name'), t('super.tenant'), t('devices.status'), t('devices.lastSeen'), t('support.pending'), t('support.version'), t('support.error'), ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, ds.map((d) => h('tr', {},
        h('td', {}, h('strong', {}, d.name || '–'), h('div', { class: 'mono small muted' }, d.id.slice(0, 10) + '…')),
        h('td', {}, tenants.find((x) => x.id === d.tenantId)?.name || d.tenantId),
        h('td', {}, d.status === 'active' ? h('span', { class: 'tag ok' }, t('devices.active')) : h('span', { class: 'tag bad' }, t('devices.revoked'))),
        h('td', {}, d.lastSeen?.toMillis ? fmtAgo(d.lastSeen.toMillis()) : '–'), h('td', {}, String(d.diag?.pending ?? '–')), h('td', {}, d.appVersion || '–'),
        h('td', { class: 'small' }, d.diag?.syncError || '–'),
        h('td', { class: 'num' }, h('div', { class: 'row end' },
          h('button', { class: 'btn small light', onclick: () => moveDevice(d, tenants) }, t('super.move')),
          h('button', { class: 'btn small light', onclick: async () => { await F().updateDoc(F().doc(db(), 'devices', d.id), { cmd: { ...(d.cmd || {}), resync: Date.now() } }); toast(t('devices.requested')); } }, t('super.resync')),
          d.status === 'active' ? h('button', { class: 'btn small danger-light', onclick: async () => { if (await confirmDialog(t('devices.revokeTitle'), t('devices.revokeText', { name: d.name }), t('devices.revoke'))) await F().updateDoc(F().doc(db(), 'devices', d.id), { status: 'revoked' }); } }, t('devices.revoke'))
            : h('button', { class: 'btn small danger-light', onclick: async () => { if (await confirmDialog(t('super.deleteDevice'), t('super.deleteDeviceText'), t('common.delete'))) await F().deleteDoc(F().doc(db(), 'devices', d.id)); } }, t('common.delete')))))))))
      : empty('tablet', t('devices.none')));
  }, (e) => list.replaceChildren(errBox(e))));
  box.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, t('super.devices')), h('p', {}, t('super.devicesText')))), list);
}
async function moveDevice(d, tenants) {
  const sel = select(tenants.map((x) => [x.id, x.name]), d.tenantId);
  const r = await modal(t('super.moveTitle', { name: d.name }), h('div', { class: 'stack' }, field(t('super.tenant'), sel), h('div', { class: 'notice warn' }, icon('alert'), h('p', {}, t('super.moveWarn')))),
    [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('super.move'), class: 'primary', value: true }]);
  if (!r || sel.value === d.tenantId) return;
  await F().updateDoc(F().doc(db(), 'devices', d.id), { tenantId: sel.value, status: 'active' });
  toast(t('super.moved'));
}

// ---------- Sikkerhetskopi av hele løsningen ----------
function backupTab(box) {
  const status = h('div', { class: 'stack' });
  box.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, t('super.backup')), h('p', {}, t('super.backupText')))),
    h('div', { class: 'card stack' },
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', 'data-act': 'full-backup', onclick: () => fullBackup(status) }, icon('download', 18), t('super.fullBackup')),
        h('button', { class: 'btn light', onclick: () => fullRestore(status) }, icon('upload', 18), t('super.fullRestore'))),
      h('p', { class: 'small muted' }, t('super.backupNote')), status));
}

export async function fetchAll(progress = () => {}) {
  const out = { format: FORMAT, version: 2, kind: 'all', createdAt: new Date().toISOString(), meta: { by: S.admin?.email }, tenants: {}, devices: [] };
  const ts = await F().getDocs(F().collection(db(), 'tenants'));
  for (const tdoc of ts.docs) {
    progress(tdoc.data().name || tdoc.id);
    const entry = { doc: decode(tdoc.data()), admins: [], collections: {} };
    entry.admins = (await F().getDocs(F().collection(db(), 'tenants', tdoc.id, 'admins'))).docs.map((d) => decode(d.data()));
    for (const c of COLLECTION_NAMES) entry.collections[c] = (await F().getDocs(F().collection(db(), 'tenants', tdoc.id, c))).docs.map((d) => ({ id: d.id, ...decode(d.data()) }));
    out.tenants[tdoc.id] = entry;
  }
  out.devices = (await F().getDocs(F().collection(db(), 'devices'))).docs.map((d) => ({ id: d.id, ...decode(d.data()) }));
  return out;
}

async function askPw(title, text, confirm) {
  const pw = input({ type: 'password', name: 'pw', autocomplete: 'new-password' });
  const pw2 = input({ type: 'password', name: 'pw2', autocomplete: 'new-password' });
  return modal(title, h('div', { class: 'stack' }, h('p', { class: 'muted' }, text), field(t('settings.backupPw'), pw), confirm ? field(t('login.password2'), pw2) : null),
    [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.ok'), class: 'primary', submit: true, onClick: () => {
      if (confirm && pw.value.length < 10) { toast(t('settings.backupPwShort'), 'error'); return false; }
      if (confirm && pw.value !== pw2.value) { toast(t('login.pwMismatch'), 'error'); return false; }
      return { pw: pw.value };
    } }]);
}

async function fullBackup(status) {
  const r = await askPw(t('super.fullBackup'), t('super.fullBackupPw'), true);
  if (!r) return;
  status.replaceChildren(h('p', { class: 'row' }, h('span', { class: 'spinner' }), t('super.fetching')));
  try {
    const all = await fetchAll((name) => { status.replaceChildren(h('p', { class: 'row' }, h('span', { class: 'spinner' }), t('super.fetchingTenant', { name }))); });
    const sealed = await seal(all, r.pw);
    download(`tryggdigital-alle-kunder-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(sealed), 'application/json');
    const n = summarize(all);
    status.replaceChildren(h('div', { class: 'notice ok' }, icon('checkCircle'), h('p', {}, t('super.backupDone', { tenants: Object.keys(all.tenants).length, docs: Object.values(n).reduce((a, b) => a + b, 0) }))));
  } catch (e) { status.replaceChildren(errBox(e)); }
}

/** Skriver en kundes dokumenter tilbake med nye versjoner (så de vinner over nyere endringer), og merker resten som slettet. */
async function restoreTenantRemote(tid, entry, by) {
  const now = () => hlc.now();
  const ops = [];
  await F().setDoc(F().doc(db(), 'tenants', tid), encode({ ...entry.doc, name: entry.doc?.name || tid }), { merge: false });
  for (const a of entry.admins || []) if (a.email) ops.push([F().doc(db(), 'tenants', tid, 'admins', a.email), { email: a.email, addedBy: a.addedBy || by, addedAt: F().serverTimestamp() }]);
  let written = 0, removed = 0;
  for (const c of COLLECTION_NAMES) {
    const existing = (await F().getDocs(F().collection(db(), 'tenants', tid, c))).docs;
    for (const d of existing) hlc.observe(d.data()._v);
    const keep = new Set();
    for (const d of entry.collections?.[c] || []) {
      if (!d?.id) continue;
      keep.add(d.id);
      const { _v, _dev, _srv, ...data } = d;
      ops.push([F().doc(db(), 'tenants', tid, c, d.id), encode({ ...data, _v: now(), _dev: S.installId, _by: by, _srv: F().serverTimestamp() })]);
      written++;
    }
    for (const d of existing) if (!keep.has(d.id) && !d.data()._del) { ops.push([d.ref, { ...d.data(), _del: true, _v: now(), _dev: S.installId, _by: by, _srv: F().serverTimestamp() }]); removed++; }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const b = F().writeBatch(db());
    for (const [ref, data] of ops.slice(i, i + 400)) b.set(ref, data);
    await b.commit();
  }
  return { written, removed };
}

async function fullRestore(status) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  const text = await file.text();
  let b;
  try { b = await openBackup(text); } catch (e) {
    if (e.message !== 'needs-password') return toast(t('settings.restoreErr.' + e.message), 'error');
    const r = await askPw(t('super.fullRestore'), t('settings.restorePwText'), false);
    if (!r) return;
    try { b = await openBackup(text, r.pw); } catch (e2) { return toast(t('settings.restoreErr.' + e2.message), 'error'); }
  }
  if (b.kind !== 'all') return toast(t('super.notFull'), 'error');
  const ids = Object.keys(b.tenants || {});
  const boxes = ids.map((id) => { const cb = h('input', { type: 'checkbox', checked: true, value: id }); return [cb, h('label', { class: 'check' }, cb, `${b.tenants[id].doc?.name || id} (${id})`)]; });
  const devCb = h('input', { type: 'checkbox' });
  const ok = await modal(t('super.fullRestore'), h('div', { class: 'stack' },
    h('p', {}, t('settings.restoreFrom', { date: fmtDateTime(b.createdAt), farm: t('super.allTenants') })),
    h('div', { class: 'stack tight' }, boxes.map((x) => x[1])),
    h('label', { class: 'check' }, devCb, t('super.restoreDevices')),
    h('div', { class: 'notice bad' }, icon('alert'), h('p', {}, t('super.restoreWarn')))),
  [{ label: t('common.cancel'), class: 'ghost', value: false }, { label: t('settings.restoreDo'), class: 'danger', value: true }], { wide: true });
  if (!ok) return;
  const chosen = boxes.filter((x) => x[0].checked).map((x) => x[0].value);
  try {
    status.replaceChildren(h('p', { class: 'row' }, h('span', { class: 'spinner' }), t('super.safetyBackup')));
    const before = await fetchAll();
    download(`tryggdigital-for-gjenoppretting-${Date.now()}.json`, JSON.stringify(before), 'application/json');
    const res = [];
    for (const id of chosen) {
      status.replaceChildren(h('p', { class: 'row' }, h('span', { class: 'spinner' }), t('super.restoring', { name: b.tenants[id].doc?.name || id })));
      res.push([id, await restoreTenantRemote(id, b.tenants[id], S.admin.email)]);
    }
    if (devCb.checked) for (const d of b.devices || []) {
      if (!chosen.includes(d.tenantId) || d.status !== 'active') continue; // stengte enheter gjenopprettes ikke
      const { id, lastSeen, addedAt, diag, cmd, appVersion, ...rest } = d;
      await F().setDoc(F().doc(db(), 'devices', id), { tenantId: rest.tenantId, name: String(rest.name || '').slice(0, 60), status: 'active', addedBy: rest.addedBy || S.admin.email, addedAt: F().serverTimestamp() });
    }
    status.replaceChildren(h('div', { class: 'notice ok' }, icon('checkCircle'), h('div', {}, res.map(([id, r]) => h('p', {}, `${b.tenants[id].doc?.name || id}: ${t('settings.restored', { n: r.written, m: r.removed })}`)))));
  } catch (e) { status.replaceChildren(errBox(e)); }
}
