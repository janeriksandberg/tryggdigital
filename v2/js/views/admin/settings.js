// Innstillinger: gårdsopplysninger, satser, karenstid, personvern, administratorer og sikkerhetskopi.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, download, pickFile, fmtDateTime } from '../../ui.js';
import * as store from '../../core/store.js';
import { S, firebase } from '../../session.js';
import { tenantBackup, seal, open as openBackup, summarize, restoreTenant } from '../../core/backup.js';
import { randomBytes, toHex } from '../../core/crypt.js';
import { pageHead } from './index.js';
import { actor } from '../shared.js';
import { privacyKey } from '../privacy.js';

export function render(ctx) {
  const st = store.settings();
  const save = (patch, bumpPrivacy = false) => {
    const cur = store.settings();
    const next = { ...cur, ...patch, id: 'main' };
    if (bumpPrivacy) next.privacyRev = (cur.privacyRev || 0) + 1;
    if (!next.lanKey) next.lanKey = toHex(randomBytes(32));
    store.put('settings', next, actor());
    toast(bumpPrivacy ? t('settings.savedPrivacy') : t('common.saved'));
  };
  const txt = (k, attrs = {}, privacy = false) => input({ value: st[k] ?? '', name: k, ...attrs, onchange: (e) => save({ [k]: e.target.value.trim() }, privacy) });
  const num = (k, attrs = {}) => input({ type: 'number', step: '0.01', min: 0, value: st[k] ?? '', name: k, ...attrs, onchange: (e) => save({ [k]: e.target.value === '' ? null : Number(e.target.value) }) });

  return h('div', { class: 'stack' },
    pageHead(t('nav.settings'), t('settings.text')),
    h('div', { class: 'card' }, h('h3', {}, t('settings.farm')), h('div', { class: 'form-grid' },
      field(t('settings.farmName'), txt('farmName', {}, true)), field(t('settings.orgNo'), txt('orgNo', { inputmode: 'numeric', pattern: '[0-9]{9}' }, true), t('settings.orgNoHint')),
      field(t('settings.address'), txt('address')), field(t('settings.contactEmail'), txt('contactEmail', { type: 'email' }, true)), field(t('settings.contactPhone'), txt('contactPhone', { type: 'tel' }, true)),
      field(t('settings.orgSprayer'), txt('orgSprayer', { inputmode: 'numeric' }), t('settings.orgSprayerHint')))),
    h('div', { class: 'card' }, h('h3', {}, t('settings.pay')), h('div', { class: 'form-grid' },
      field(t('settings.hourRate'), num('hourRate'), t('settings.hourRateHint')), field(t('settings.crateRate'), num('crateRate'), t('settings.crateRateHint'))),
      h('p', { class: 'muted small' }, t('settings.payRule'))),
    h('div', { class: 'card' }, h('h3', {}, t('settings.karens')), h('div', { class: 'form-grid' },
      field(t('settings.karensMode'), select([['block', t('settings.karensBlock')], ['warn', t('settings.karensWarn')]], st.karensMode || 'block', { onchange: (e) => save({ karensMode: e.target.value }) }))),
      h('p', { class: 'muted small' }, t('settings.karensHint'))),
    h('div', { class: 'card stack' }, h('h3', {}, t('settings.privacy')),
      h('p', { class: 'muted' }, t('settings.privacyText', { version: privacyKey() })),
      field(t('settings.privacyExtra'), h('textarea', { class: 'input', rows: 3, name: 'privacyExtra', onchange: (e) => save({ privacyExtra: e.target.value.trim() }, true) }, st.privacyExtra || ''), t('settings.privacyExtraHint')),
      h('div', { class: 'row wrap' }, h('a', { class: 'btn light', href: '#/privacy' }, icon('eye', 18), t('settings.showPrivacy')),
        h('button', { class: 'btn light', onclick: () => consentsReport() }, icon('list', 18), t('settings.consents')))),
    admins(),
    h('div', { class: 'card stack' }, h('h3', {}, icon('backup', 20), ' ', t('settings.backup')),
      h('p', { class: 'muted' }, t('settings.backupText')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', 'data-act': 'backup', onclick: () => doBackup() }, icon('download', 18), t('settings.backupBtn')),
        h('button', { class: 'btn light', 'data-act': 'restore', onclick: () => doRestore(ctx) }, icon('upload', 18), t('settings.restoreBtn')))),
    h('div', { class: 'card stack' }, h('h3', {}, t('settings.dataRights')), h('p', { class: 'muted' }, t('settings.dataRightsText')),
      h('button', { class: 'btn light', onclick: () => exportPerson() }, icon('user', 18), t('settings.exportPerson'))));
}

function admins() {
  const box = h('div', { class: 'card stack' }, h('h3', {}, t('settings.admins')), h('p', { class: 'muted' }, t('settings.adminsText')));
  if (S.mode === 'demo') { box.append(h('p', { class: 'small' }, t('devices.demo'))); return box; }
  const listEl = h('div', { class: 'list' }, h('span', { class: 'spinner' }));
  const { F, fb } = firebase();
  const db = fb('admin').db;
  const col = F.collection(db, 'tenants', S.tenantId, 'admins');
  const load = async () => {
    try {
      const snap = await F.getDocs(col);
      listEl.replaceChildren(...snap.docs.map((d) => h('div', { class: 'list-item' }, icon('user', 18), h('span', { class: 'grow' }, d.id), d.id === S.admin.email ? h('span', { class: 'tag' }, t('settings.you')) : h('button', { class: 'btn small danger-light', onclick: async () => { if (await confirmDialog(t('settings.removeAdmin'), d.id, t('common.delete'))) { await F.deleteDoc(d.ref); load(); } } }, t('common.delete')))));
    } catch (e) { listEl.replaceChildren(h('p', { class: 'small' }, t('devices.needsNet'))); }
  };
  load();
  const email = input({ type: 'email', placeholder: 'navn@epost.no', name: 'newadmin' });
  box.append(listEl, h('form', { class: 'row wrap', onsubmit: async (e) => {
    e.preventDefault();
    const v = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast(t('auth.err.email'), 'error');
    try { await F.setDoc(F.doc(col, v), { email: v, addedBy: S.admin.email, addedAt: F.serverTimestamp() }); email.value = ''; toast(t('settings.adminAdded')); load(); } catch (ex) { toast(ex.code || ex.message, 'error'); }
  } }, h('div', { class: 'grow' }, email), h('button', { class: 'btn light', type: 'submit' }, icon('userPlus', 18), t('settings.addAdmin'))),
  h('p', { class: 'small muted' }, t('settings.adminHow')));
  return box;
}

async function askPassword(title, text, confirm = false) {
  const pw = input({ type: 'password', name: 'bpw', autocomplete: 'new-password' });
  const pw2 = input({ type: 'password', name: 'bpw2', autocomplete: 'new-password' });
  return modal(title, h('div', { class: 'stack' }, h('p', { class: 'muted' }, text), field(t('settings.backupPw'), pw), confirm ? field(t('login.password2'), pw2) : null),
    [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.ok'), class: 'primary', submit: true, onClick: () => {
      if (confirm && pw.value !== pw2.value) { toast(t('login.pwMismatch'), 'error'); return false; }
      if (confirm && pw.value && pw.value.length < 10) { toast(t('settings.backupPwShort'), 'error'); return false; }
      return { pw: pw.value };
    } }]);
}

export async function doBackup() {
  const r = await askPassword(t('settings.backupBtn'), t('settings.backupPwText'), true);
  if (!r) return;
  const data = tenantBackup({ farm: store.settings().farmName, by: actor() });
  const out = await seal(data, r.pw || null);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  download(`tryggdigital-${(store.settings().farmName || store.tenantId()).replace(/[^\w-]+/g, '_')}-${stamp}${r.pw ? '.kryptert' : ''}.json`, JSON.stringify(out), 'application/json');
  toast(t('settings.backupDone'));
}

async function doRestore(ctx) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  const text = await file.text();
  let b;
  try { b = await openBackup(text); } catch (e) {
    if (e.message === 'needs-password') {
      const r = await askPassword(t('settings.restoreBtn'), t('settings.restorePwText'));
      if (!r) return;
      try { b = await openBackup(text, r.pw); } catch (e2) { return toast(t('settings.restoreErr.' + e2.message), 'error'); }
    } else return toast(t('settings.restoreErr.' + e.message), 'error');
  }
  if (b.kind !== 'tenant') return toast(t('settings.restoreErr.kind'), 'error');
  const counts = summarize(b);
  const other = b.tenantId !== store.tenantId();
  const ok = await modal(t('settings.restoreConfirm'), h('div', { class: 'stack' },
    h('p', {}, t('settings.restoreFrom', { date: fmtDateTime(b.createdAt), farm: b.meta?.farm || b.tenantId })),
    other ? h('div', { class: 'notice warn' }, icon('alert'), h('p', {}, t('settings.restoreOther'))) : null,
    h('ul', {}, Object.entries(counts).filter(([, n]) => n).map(([k, n]) => h('li', {}, `${k}: ${n}`))),
    h('div', { class: 'notice bad' }, icon('alert'), h('p', {}, t('settings.restoreWarn')))),
  [{ label: t('common.cancel'), class: 'ghost', value: false }, { label: t('settings.restoreDo'), class: 'danger', value: true, id: 'do-restore' }]);
  if (!ok) return;
  // Automatisk sikkerhetskopi av nåværende data før gjenoppretting
  download(`tryggdigital-for-gjenoppretting-${Date.now()}.json`, JSON.stringify(tenantBackup({ farm: store.settings().farmName, auto: true })), 'application/json');
  const res = restoreTenant(b, actor());
  toast(t('settings.restored', { n: res.written, m: res.removed }));
  ctx.redraw();
}

async function consentsReport() {
  const people = new Map(store.all('people').map((p) => [p.id, p.name]));
  const rows = store.all('consents').sort((a, b) => (a.ts < b.ts ? 1 : -1));
  await modal(t('settings.consents'), h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, t('people.name')), h('th', {}, t('pv.version')), h('th', {}, t('people.lang')), h('th', {}, t('common.time')))),
    h('tbody', {}, rows.map((c) => h('tr', {}, h('td', {}, people.get(c.subjectId) || c.subjectId), h('td', {}, c.version, c.version === privacyKey() ? '' : ' ⟲'), h('td', {}, c.lang), h('td', {}, fmtDateTime(c.ts))))))),
  [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
}

async function exportPerson() {
  const people = store.all('people');
  const sel = select(people.map((p) => [p.id, p.name]), people[0]?.id);
  const id = await modal(t('settings.exportPerson'), field(t('people.name'), sel), [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.download'), class: 'primary', submit: true, onClick: () => sel.value }]);
  if (!id) return;
  const p = store.get('people', id);
  const mine = (c, key = 'personId') => store.all(c).filter((x) => x[key] === id);
  const data = { person: { ...p, cards: (p.cards || []).map((c) => ({ created: c.created, revoked: !!c.revoked })) }, shifts: mine('shifts'), crates: mine('crates'), sprays: store.all('sprays').filter((s) => s.operatorId === id), consents: mine('consents', 'subjectId'), assignments: mine('assignments') };
  download(`innsyn-${p.name.replace(/\s+/g, '_')}.json`, JSON.stringify(data, null, 2), 'application/json');
}
