// Rapporter: kasser per dekar, lønnskostnad per kasse, og sammenligning med samme periode i fjor, per jorde og sort.
import { t } from '../../i18n.js';
import { h, icon, field, input, empty, fmtNum, fmtKr2, fmtKr, download, toCsv } from '../../ui.js';
import * as D from '../../core/domain.js';
import { pageHead } from './index.js';
import { dbAll } from '../shared.js';

const season = () => { const y = new Date().getFullYear(); return [`${y}-01-01`, D.todayKey()]; };
let [from, to] = season();
let group = 'field'; // field | variety | both

export function render(ctx) {
  const db = dbAll();
  const cmp = D.kpiCompare(db, from, to);
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const vars = new Map(db.varieties.map((v) => [v.id, v]));
  const keyOf = (r) => (group === 'field' ? r.fieldId || '' : group === 'variety' ? r.varietyId || '' : `${r.fieldId}|${r.varietyId}`);
  const agg = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const o = m.get(k) || { key: k, fieldId: r.fieldId, varietyId: r.varietyId, crates: 0, kg: 0, laborCost: 0, area: new Map() };
      o.crates += r.crates; o.kg += r.kg; o.laborCost += r.laborCost; if (r.fieldId) o.area.set(r.fieldId, r.areaDaa);
      m.set(k, o);
    }
    for (const o of m.values()) { o.areaDaa = [...o.area.values()].reduce((a, b) => a + b, 0); o.cratesPerDaa = o.areaDaa ? o.crates / o.areaDaa : null; o.costPerCrate = o.crates ? o.laborCost / o.crates : null; }
    return m;
  };
  const cur = agg(cmp.rows), prev = agg(cmp.prevRows);
  const rows = [...cur.values()].sort((a, b) => b.crates - a.crates);
  const label = (r) => (group === 'field' ? fields.get(r.fieldId)?.name || t('foreman.noField') : group === 'variety' ? vars.get(r.varietyId)?.name || '–' : `${fields.get(r.fieldId)?.name || '–'} · ${vars.get(r.varietyId)?.name || '–'}`);
  const tot = rows.reduce((a, r) => ({ crates: a.crates + r.crates, cost: a.cost + r.laborCost, kg: a.kg + r.kg }), { crates: 0, cost: 0, kg: 0 });
  const ptot = [...prev.values()].reduce((a, r) => ({ crates: a.crates + r.crates, cost: a.cost + r.laborCost }), { crates: 0, cost: 0 });
  const delta = (a, b, inverse = false) => {
    if (a == null || b == null || !b) return h('span', { class: 'muted small' }, '–');
    const pct = ((a - b) / b) * 100;
    const good = inverse ? pct < 0 : pct > 0;
    return h('span', { class: `delta ${Math.abs(pct) < 0.5 ? '' : good ? 'up' : 'down'}` }, `${pct > 0 ? '+' : ''}${fmtNum(pct, 0)} %`);
  };
  const maxC = Math.max(1, ...rows.map((r) => r.crates));
  const csv = () => download(`rapport-${from}-${to}.csv`, toCsv(rows.map((r) => { const p = prev.get(r.key); return { [t('reports.group')]: label(r), [t('trace.crates')]: r.crates, kg: D.round(r.kg, 1), [t('fields.areaDaa')]: D.round(r.areaDaa, 1), [t('reports.cratesPerDaa')]: r.cratesPerDaa != null ? D.round(r.cratesPerDaa, 2) : '', [t('reports.laborCost')]: D.round(r.laborCost, 0), [t('reports.costPerCrate')]: r.costPerCrate != null ? D.round(r.costPerCrate, 2) : '', [t('reports.lastYearCrates')]: p?.crates ?? '', [t('reports.lastYearCostPerCrate')]: p?.costPerCrate != null ? D.round(p.costPerCrate, 2) : '' }; })), 'text/csv');
  return h('div', { class: 'stack' },
    pageHead(t('nav.reports'), t('reports.text'), h('button', { class: 'btn light', onclick: csv, disabled: !rows.length || null }, icon('download', 18), 'CSV')),
    h('div', { class: 'card row wrap', style: { alignItems: 'end' } },
      field(t('common.from'), input({ type: 'date', value: from, onchange: (e) => { from = e.target.value || from; ctx.redraw(); } })),
      field(t('common.to'), input({ type: 'date', value: to, onchange: (e) => { to = e.target.value || to; ctx.redraw(); } })),
      h('div', { class: 'seg', role: 'group', 'aria-label': t('reports.group') }, [['field', t('reports.byField')], ['variety', t('reports.byVariety')], ['both', t('reports.byBoth')]].map(([k, l]) => h('button', { type: 'button', class: group === k ? 'on' : '', onclick: () => { group = k; ctx.redraw(); } }, l)))),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtNum(tot.crates, 0)), h('div', { class: 'l' }, t('reports.totalCrates'), ' ', delta(tot.crates, ptot.crates))),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtKr(tot.cost)), h('div', { class: 'l' }, t('reports.laborCost'), ' ', delta(tot.cost, ptot.cost, true))),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, tot.crates ? fmtKr2(tot.cost / tot.crates) : '–'), h('div', { class: 'l' }, t('reports.costPerCrate'), ' ', delta(tot.crates ? tot.cost / tot.crates : null, ptot.crates ? ptot.cost / ptot.crates : null, true))),
      tot.kg ? h('div', { class: 'kpi' }, h('div', { class: 'v' }, `${fmtNum(tot.kg, 0)} kg`), h('div', { class: 'l' }, t('reports.weighed'))) : null),
    h('div', { class: 'card' }, h('h3', {}, t('reports.table')),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-report': '' },
        h('thead', {}, h('tr', {}, h('th', {}, t('reports.group')), h('th', { class: 'num' }, t('trace.crates')), h('th', { class: 'num' }, t('reports.cratesPerDaa')), h('th', { class: 'num' }, t('reports.laborCost')), h('th', { class: 'num' }, t('reports.costPerCrate')), h('th', { class: 'num' }, t('reports.vsLastYear')))),
        h('tbody', {}, rows.map((r) => {
          const p = prev.get(r.key);
          return h('tr', {},
            h('td', {}, h('strong', {}, label(r)), h('div', { class: 'bar', style: { marginTop: '6px', maxWidth: '220px' } }, h('i', { style: { width: `${(r.crates / maxC) * 100}%` } }))),
            h('td', { class: 'num' }, fmtNum(r.crates, 0)),
            h('td', { class: 'num' }, r.cratesPerDaa != null ? fmtNum(r.cratesPerDaa, 1) : '–', ' ', delta(r.cratesPerDaa, p?.cratesPerDaa)),
            h('td', { class: 'num' }, fmtKr(r.laborCost)),
            h('td', { class: 'num' }, r.costPerCrate != null ? fmtKr2(r.costPerCrate) : '–', ' ', delta(r.costPerCrate, p?.costPerCrate, true)),
            h('td', { class: 'num small' }, p ? t('reports.lastYearShort', { n: fmtNum(p.crates, 0) }) : '–'));
        })))) : empty('chart', t('reports.empty'))),
    cmp.unallocated ? h('p', { class: 'small muted' }, t('reports.unallocated', { amount: fmtKr(cmp.unallocated) })) : null,
    h('p', { class: 'small muted' }, t('reports.method')));
}
