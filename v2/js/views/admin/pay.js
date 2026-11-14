// Lønn: per person for en periode. Dagslønn er det høyeste av timelønn og kasselønn (samme regel som v1).
import { t } from '../../i18n.js';
import { h, icon, modal, field, input, empty, fmtNum, fmtKr, fmtKr2, fmtDuration, fmtDay, download, toCsv } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { pageHead } from './index.js';
import { dbAll } from '../shared.js';
import { printNodes } from '../print.js';

const monthStart = () => `${D.todayKey().slice(0, 7)}-01`;
let from = monthStart(), to = D.todayKey();

export function render(ctx) {
  const db = dbAll();
  const rows = D.payReport(db, from, to);
  const sum = rows.reduce((a, r) => ({ hours: a.hours + r.hours, crates: a.crates + r.crates, pay: a.pay + r.pay }), { hours: 0, crates: 0, pay: 0 });
  const minRate = D.num(db.settings.minHourRate);
  const below = minRate ? db.people.filter((p) => p.active !== false && D.hourRateFor(db, p) < minRate) : [];
  const presets = [[t('pay.thisMonth'), monthStart(), D.todayKey()], [t('pay.lastMonth'), ...lastMonth()], [t('pay.thisWeek'), weekStart(), D.todayKey()]];
  return h('div', { class: 'stack' },
    pageHead(t('nav.pay'), t('pay.text'),
      h('button', { class: 'btn light', onclick: () => csv(rows) , disabled: !rows.length || null }, icon('download', 18), 'CSV'),
      h('button', { class: 'btn light', onclick: () => printPay(rows), disabled: !rows.length || null }, icon('printer', 18), t('common.print')),
      h('button', { class: 'btn light', disabled: true, title: t('pay.tripletexSoon') }, icon('send', 18), t('pay.tripletex'))),
    h('div', { class: 'card row wrap', style: { alignItems: 'end' } },
      field(t('common.from'), input({ type: 'date', value: from, onchange: (e) => { from = e.target.value || from; ctx.redraw(); } })),
      field(t('common.to'), input({ type: 'date', value: to, onchange: (e) => { to = e.target.value || to; ctx.redraw(); } })),
      h('div', { class: 'seg' }, presets.map(([l, f, tt]) => h('button', { type: 'button', class: from === f && to === tt ? 'on' : '', onclick: () => { from = f; to = tt; ctx.redraw(); } }, l)))),
    below.length ? h('div', { class: 'notice warn', 'data-below-min': below.length }, icon('alert'), h('p', {}, t('pay.belowMin', { rate: fmtKr2(minRate), names: below.map((p) => p.name).join(', ') }))) : null,
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtKr(sum.pay)), h('div', { class: 'l' }, t('pay.total'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtNum(sum.hours, 1)), h('div', { class: 'l' }, t('reg.hours'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtNum(sum.crates, 0)), h('div', { class: 'l' }, t('trace.crates')))),
    h('div', { class: 'card' }, rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-pay': '' },
      h('thead', {}, h('tr', {}, h('th', {}, t('people.name')), ...[t('pay.days'), t('reg.hours'), t('trace.crates'), t('pay.byHour'), t('pay.byCrate'), t('pay.pay')].map((x) => h('th', { class: 'num' }, x)), h('th', {}, ''))),
      h('tbody', {}, rows.map((r) => h('tr', { 'data-pay-row': r.person.name },
        h('td', {}, h('strong', {}, r.person.name), r.open ? h('span', { class: 'tag warn' }, t('pay.openShift')) : null),
        h('td', { class: 'num' }, String(r.days)), h('td', { class: 'num' }, fmtNum(r.hours, 1)), h('td', { class: 'num' }, fmtNum(r.crates, 0)),
        h('td', { class: 'num' }, fmtKr(r.byHour)), h('td', { class: 'num' }, fmtKr(r.byCrate)), h('td', { class: 'num' }, h('strong', {}, fmtKr2(r.pay))),
        h('td', { class: 'num' }, h('button', { class: 'icon-btn', 'aria-label': t('pay.details'), title: t('pay.details'), onclick: () => details(r) }, icon('eye', 18))))))))
      : empty('banknote', t('pay.empty'))),
    h('p', { class: 'small muted' }, t('pay.rule', { rate: fmtKr2(D.num(store.settings().hourRate)) })),
    h('p', { class: 'small muted' }, t('pay.legalNote')));
}

function lastMonth() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const s = D.dayKey(d); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [s, D.dayKey(e)]; }
function weekStart() { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return D.dayKey(d); }

function dayRows(r) {
  return Object.entries(r.daily).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, d]) => ({ k, d, p: D.dayPay(d.hours, d.crateValue, r.hourRate) }));
}
async function details(r) {
  await modal(`${r.person.name} · ${from} – ${to}`, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, t('common.date')), ...[t('reg.hours'), t('trace.crates'), t('pay.byHour'), t('pay.byCrate'), t('pay.pay')].map((x) => h('th', { class: 'num' }, x)))),
    h('tbody', {}, dayRows(r).map(({ k, d, p }) => h('tr', {}, h('td', {}, fmtDay(k)), h('td', { class: 'num' }, fmtDuration(d.hours)), h('td', { class: 'num' }, fmtNum(d.crates, 0)),
      h('td', { class: 'num' }, fmtKr2(p.byHour)), h('td', { class: 'num' }, fmtKr2(p.byCrate)), h('td', { class: 'num' }, h('strong', {}, fmtKr2(p.pay)), ' ', h('span', { class: 'tag' }, p.basis === 'crate' ? t('pay.basisCrate') : t('pay.basisHour')))))))),
  [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
}
function csv(rows) {
  const out = [];
  for (const r of rows) for (const { k, d, p } of dayRows(r)) out.push({ [t('people.name')]: r.person.name, [t('people.number')]: r.person.number || '', [t('common.date')]: k, [t('reg.hours')]: D.round(d.hours, 2), [t('trace.crates')]: d.crates, [t('pay.hourRate')]: r.hourRate, [t('pay.byHour')]: D.round(p.byHour, 2), [t('pay.byCrate')]: D.round(p.byCrate, 2), [t('pay.pay')]: D.round(p.pay, 2), [t('pay.basis')]: p.basis });
  download(`lønn-${from}-${to}.csv`, toCsv(out), 'text/csv');
}
function printPay(rows) {
  const st = store.settings();
  printNodes(rows.map((r) => h('div', { class: 'print-doc page-break' },
    h('h1', {}, t('pay.slipTitle')), h('p', {}, `${st.farmName || ''} · ${from} – ${to}`), h('h2', {}, r.person.name, r.person.number ? ` (#${r.person.number})` : ''),
    h('table', { class: 'print-table' }, h('thead', {}, h('tr', {}, [t('common.date'), t('reg.hours'), t('trace.crates'), t('pay.byHour'), t('pay.byCrate'), t('pay.pay')].map((c) => h('th', {}, c)))),
      h('tbody', {}, dayRows(r).map(({ k, d, p }) => h('tr', {}, [k, fmtNum(d.hours, 2), fmtNum(d.crates, 0), fmtKr2(p.byHour), fmtKr2(p.byCrate), fmtKr2(p.pay)].map((c) => h('td', {}, c))))),
      h('tfoot', {}, h('tr', {}, [t('pay.total'), fmtNum(r.hours, 2), fmtNum(r.crates, 0), fmtKr2(r.byHour), fmtKr2(r.byCrate), fmtKr2(r.pay)].map((c) => h('th', {}, c))))),
    h('p', { class: 'small' }, t('pay.slipNote')))), t('pay.slipTitle'));
}
