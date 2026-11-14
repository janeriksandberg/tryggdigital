// Formannsvisning i sanntid: hvem er på jobb, hvor, kasser så langt i dag, karenstidsvarsler og tildeling til jorder.
import { t } from '../i18n.js';
import { h, icon, fmtTime, fmtNum, modal, select, field, toast, empty } from '../ui.js';
import * as store from '../core/store.js';
import * as D from '../core/domain.js';
import { dbAll } from './shared.js';
import { avatar } from './kiosk.js';

export function board({ by }) {
  const db = dbAll();
  const snap = D.foremanSnapshot(db);
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const maxC = Math.max(1, ...snap.working.map((w) => w.crates));
  const alerts = snap.alerts.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const people = new Map(db.people.map((p) => [p.id, p]));
  const fieldRows = Object.entries(snap.fields).sort((a, b) => b[1].crates - a[1].crates);
  return h('div', { class: 'stack', 'data-board': '' },
    h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'live-dot' }), h('span', { class: 'muted small' }, t('foreman.live'))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(snap.working.length)), h('div', { class: 'l' }, t('kiosk.atWork'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v', 'data-total': snap.total }, fmtNum(snap.total, 0)), h('div', { class: 'l' }, t('kiosk.cratesToday'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v', style: alerts.some((a) => !a.ack) ? { color: 'var(--danger)' } : null }, String(alerts.filter((a) => !a.ack).length)), h('div', { class: 'l' }, t('foreman.openAlerts')))),
    alerts.length ? h('div', { class: 'card stack', style: { borderColor: '#f3b9b9' } }, h('h3', {}, icon('alert', 18), ' ', t('foreman.karensAlerts')),
      alerts.map((a) => h('div', { class: `notice ${a.ack ? '' : 'bad'}`, 'data-alert': a.id }, icon('alert'), h('div', { class: 'grow' },
        h('p', {}, h('strong', {}, people.get(a.personId)?.name || '–'), ' · ', fields.get(a.fieldId)?.name || '–', ' · ', fmtTime(a.ts)),
        h('p', { class: 'small' }, t('foreman.alertText', { n: a.count || 1, date: a.allowedFrom }))),
        a.ack ? h('span', { class: 'tag ok' }, t('foreman.handled')) : h('button', { class: 'btn small light', onclick: () => store.patch('alerts', a.id, { ack: true, ackBy: by, ackAt: new Date().toISOString() }, by) }, t('foreman.markHandled'))))) : null,
    h('div', { class: 'board' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('foreman.working')), h('button', { class: 'btn small light', 'data-act': 'assign', onclick: () => assignDialog(by) }, icon('mapPin', 16), t('foreman.assign'))),
        snap.working.length ? snap.working.map((w) => h('div', { class: 'worker-row', 'data-worker': w.person.name }, avatar(w.person),
          h('div', { class: 'grow' }, h('strong', {}, w.person.name), h('div', { class: 'small muted' }, t('picker.since', { time: fmtTime(w.since) }), ' · ', fields.get(w.fieldId)?.name || t('foreman.noField'), w.assignedFieldId && w.assignedFieldId !== w.fieldId ? ` (${t('foreman.assignedTo')} ${fields.get(w.assignedFieldId)?.name || ''})` : ''),
            h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: `${(w.crates / maxC) * 100}%` } }))),
          h('span', { class: 'cnt' }, String(w.crates)))) : empty('users', t('ov.nobody'))),
      h('div', { class: 'card' }, h('h3', {}, t('foreman.perField')),
        fieldRows.length ? h('div', { class: 'list' }, fieldRows.map(([fid, v]) => h('div', { class: 'list-item' }, h('span', { class: 'dot', style: { background: fields.get(fid)?.color || '#999' } }),
          h('span', { class: 'grow' }, h('strong', {}, fields.get(fid)?.name || t('foreman.noField')), h('div', { class: 'small muted' }, t('foreman.pickers', { n: v.people.size }), v.kg ? ` · ${fmtNum(v.kg, 1)} kg` : '')),
          h('span', { class: 'cnt', style: { fontWeight: 800, fontSize: '1.3rem' } }, String(v.crates))))) : h('p', { class: 'muted' }, t('foreman.noCrates')))));
}

export async function assignDialog(by) {
  const db = dbAll();
  const today = D.todayKey();
  const pickers = db.people.filter((p) => p.active !== false && (p.roles || []).includes('picker'));
  const cur = new Map(db.assignments.filter((a) => a.date === today).map((a) => [a.personId, a]));
  const date = h('input', { class: 'input', type: 'date', value: today });
  const opts = [['', '–'], ...db.fields.filter((f) => f.active !== false).map((f) => [f.id, f.name])];
  const rows = pickers.map((p) => ({ p, sel: select(opts, cur.get(p.id)?.fieldId || '', { 'aria-label': p.name }) }));
  const ok = await modal(t('foreman.assignTitle'), h('div', { class: 'stack' }, field(t('common.date'), date),
    rows.length ? h('div', { class: 'stack tight' }, rows.map((r) => h('div', { class: 'row' }, h('span', { class: 'grow' }, r.p.name), h('div', { style: { width: '220px' } }, r.sel)))) : h('p', {}, t('people.empty'))),
  [{ label: t('common.cancel'), class: 'ghost', value: false }, { label: t('common.save'), class: 'primary', value: true }], { wide: true });
  if (!ok) return;
  const d = date.value || today;
  const existing = new Map(store.all('assignments').filter((a) => a.date === d).map((a) => [a.personId, a]));
  for (const r of rows) {
    const ex = existing.get(r.p.id);
    if (r.sel.value) store.put('assignments', { ...(ex || {}), id: ex?.id || `${d}_${r.p.id}`, date: d, personId: r.p.id, fieldId: r.sel.value }, by);
    else if (ex) store.remove('assignments', ex.id, by);
  }
  toast(t('common.saved'));
}
