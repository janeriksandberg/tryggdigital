// Oversikt: dagens tall, varsler, oppgaver og hurtigvalg.
import { t } from '../../i18n.js';
import { h, icon, fmtNum, fmtKr, fmtTime } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { S } from '../../session.js';
import { pageHead } from './index.js';
import { dbAll } from '../shared.js';

export function render() {
  const db = dbAll();
  const snap = D.foremanSnapshot(db);
  const today = D.todayKey();
  const pay = D.payReport(db, today, today);
  const blocked = db.fields.filter((f) => D.karensFor(db, f.id, today));
  const stock = Object.values(D.stockBalance(db)).filter((x) => x.product && x.balance < 0);
  const openTasks = db.tasks.filter((x) => x.status !== 'done');
  const alerts = db.alerts.filter((a) => !a.ack && D.dayKey(a.ts) === today);
  const setup = [
    [!db.settings.farmName, t('ov.setupFarm'), '#/admin/settings'],
    [!db.fields.length, t('ov.setupFields'), '#/admin/fields'],
    [!db.varieties.length, t('ov.setupCrops'), '#/admin/crops'],
    [!db.people.length, t('ov.setupPeople'), '#/admin/people'],
  ].filter((x) => x[0]);
  return h('div', { class: 'stack' },
    pageHead(t('ov.title', { farm: db.settings.farmName || S.tenantName || '' }), t('ov.subtitle')),
    setup.length ? h('div', { class: 'card stack' }, h('h3', {}, icon('list', 18), ' ', t('ov.setupTitle')), h('ol', { class: 'steps' }, setup.map(([, text, href]) => h('li', {}, h('a', { href }, text))))) : null,
    h('div', { class: 'kpis' },
      kpi(snap.working.length, t('kiosk.atWork')), kpi(fmtNum(snap.total, 0), t('kiosk.cratesToday')),
      kpi(fmtKr(pay.reduce((a, r) => a + r.pay, 0)), t('ov.payToday')), kpi(blocked.length, t('kiosk.karensFields'), blocked.length ? 'bad' : '')),
    alerts.length ? h('div', { class: 'notice bad' }, icon('alert'), h('div', {}, h('strong', {}, t('ov.alerts', { n: alerts.length })), h('p', {}, h('a', { href: '#/admin/today' }, t('ov.seeAlerts'))))) : null,
    stock.length ? h('div', { class: 'notice warn' }, icon('flask'), h('p', {}, t('ov.negativeStock', { names: stock.map((s) => s.product.name).join(', ') }))) : null,
    h('div', { class: 'grid two' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('ov.working')), h('a', { class: 'btn small light', href: '#/admin/today' }, t('ov.openBoard'))),
        snap.working.length ? h('div', { class: 'list' }, snap.working.slice(0, 8).map((w) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, h('strong', {}, w.person.name), h('div', { class: 'small muted' }, t('picker.since', { time: fmtTime(w.since) }), ' · ', db.fields.find((f) => f.id === w.fieldId)?.name || '–')), h('span', { class: 'tag ok' }, `${w.crates} ${t('crate.many')}`))))
          : h('p', { class: 'muted' }, t('ov.nobody'))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('ov.tasks')), h('a', { class: 'btn small light', href: '#/admin/spraying/tasks' }, t('ov.allTasks'))),
        openTasks.length ? h('div', { class: 'list' }, openTasks.slice(0, 6).map((k) => h('div', { class: 'list-item' }, icon('tractor', 18), h('span', { class: 'grow' }, h('strong', {}, db.fields.find((f) => f.id === k.fieldId)?.name || '–'), h('div', { class: 'small muted' }, k.plannedDate || '', ' · ', db.people.find((p) => p.id === k.assigneeId)?.name || t('ov.unassigned'))))))
          : h('p', { class: 'muted' }, t('ov.noTasks')))));
}
const kpi = (v, l, cls = '') => h('div', { class: 'kpi' }, h('div', { class: 'v', style: cls === 'bad' && v ? { color: 'var(--danger)' } : null }, String(v)), h('div', { class: 'l' }, l));
export const onData = (ev, ctx) => ctx.redraw();
