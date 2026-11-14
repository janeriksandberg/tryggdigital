// Gjødslingsjournal: hva som er spredt hvor og når, med sum nitrogen, fosfor og kalium per jorde.
// Gjødselslag huskes fra forrige gang, så innholdet (N-P-K) fylles inn av seg selv.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty, fmtDate, fmtNum, download, toCsv } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { cropName } from '../../core/crops.js';
import { pageHead } from './index.js';
import { actor, dbAll } from '../shared.js';
import { printNodes } from '../print.js';

let year = new Date().getFullYear();
export const KINDS = ['mineral', 'manure', 'organic', 'lime', 'other'];
export const UNITS = ['kg/daa', 'l/daa', 'tonn/daa', 'm3/daa'];
export const METHODS = ['spread', 'band', 'fertigation', 'foliar', 'incorporated'];
// Mineralgjødsel oppgis i prosent. Husdyrgjødsel og annen organisk gjødsel i kg per tonn eller m³.
const basisFor = (unit) => (unit === 'tonn/daa' || unit === 'm3/daa' ? 'perUnit' : 'pct');

export function render(ctx) {
  const db = dbAll();
  const years = [...new Set([new Date().getFullYear(), ...db.fertilizations.map((s) => Number(s.date?.slice(0, 4))).filter(Boolean)])].sort((a, b) => b - a);
  const list = db.fertilizations.filter((s) => s.date?.startsWith(String(year))).sort((a, b) => (a.date < b.date ? 1 : -1));
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const totals = D.nutrientTotals(db, `${year}-01-01`, `${year}-12-31`);
  return h('div', { class: 'stack' },
    pageHead(t('nav.fertilizer'), t('fert.text'),
      h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': t('common.year'), onchange: (e) => { year = Number(e.target.value); ctx.redraw(); } }, years.map((y) => h('option', { value: y, selected: y === year }, String(y)))),
      h('button', { class: 'btn light', disabled: !list.length || null, onclick: () => download(`gjodslingsjournal-${year}.csv`, toCsv(list.map((f) => csvRow(f, fields))), 'text/csv') }, icon('download', 18), 'CSV'),
      h('button', { class: 'btn light', disabled: !list.length || null, onclick: () => printJournal(list, fields, totals) }, icon('printer', 18), t('common.print')),
      h('button', { class: 'btn primary', 'data-act': 'new-fert', onclick: () => edit(null, ctx) }, icon('plus', 18), t('fert.new'))),
    Object.keys(totals).length ? h('div', { class: 'card' }, h('h3', {}, t('fert.totals', { year })),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-fert-totals': '' },
        h('thead', {}, h('tr', {}, h('th', {}, t('spray.field')), ...[t('fields.areaDaa'), 'N kg', 'P kg', 'K kg', 'N kg/daa', 'P kg/daa'].map((x) => h('th', { class: 'num' }, x)))),
        h('tbody', {}, Object.entries(totals).map(([id, o]) => { const f = fields.get(id); const a = D.num(f?.areaDaa); return h('tr', {},
          h('td', {}, h('strong', {}, f?.name || '–')), h('td', { class: 'num' }, a ? fmtNum(a, 1) : '–'),
          h('td', { class: 'num' }, fmtNum(o.n, 1)), h('td', { class: 'num' }, fmtNum(o.p, 1)), h('td', { class: 'num' }, fmtNum(o.k, 1)),
          h('td', { class: 'num' }, a ? fmtNum(o.n / a, 1) : '–'), h('td', { class: 'num' }, a ? fmtNum(o.p / a, 2) : '–')); }))))) : null,
    h('div', { class: 'card' }, h('h3', {}, t('fert.journalYear', { year })),
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-fert': '' },
        h('thead', {}, h('tr', {}, ...[t('common.date'), t('spray.field'), t('fert.product'), t('fert.amount'), 'N-P-K kg/daa', t('fert.method'), t('spray.operator'), ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.map((f) => h('tr', { 'data-fert-row': f.product },
          h('td', {}, fmtDate(f.date)),
          h('td', {}, h('strong', {}, fields.get(f.fieldId)?.name || f.fieldName || '–'), h('div', { class: 'small muted' }, `${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}`)),
          h('td', {}, f.product || '–', h('div', { class: 'small muted' }, t('fert.kind.' + (f.kind || 'other')))),
          h('td', {}, `${fmtNum(f.amount, 2)} ${f.unit || ''}`),
          h('td', {}, [f.nPerDaa, f.pPerDaa, f.kPerDaa].map((x) => fmtNum(x, 2)).join(' – ')),
          h('td', {}, f.method ? t('fert.m.' + f.method) : '–'), h('td', {}, f.operator || '–'),
          h('td', { class: 'num' }, h('button', { class: 'icon-btn', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => edit(f, ctx) }, icon('edit', 18)))))))) : empty('sprout', t('fert.none'))),
    h('p', { class: 'small muted' }, t('fert.legalNote')));
}

const csvRow = (f, fields) => ({ dato: f.date, jorde: fields.get(f.fieldId)?.name || f.fieldName || '', kultur: cropName(fields.get(f.fieldId)?.crop), areal_daa: D.round(D.num(f.areaDaa), 2), gjodsel: f.product || '', type: f.kind || '', mengde: f.amount ?? '', enhet: f.unit || '', N_kg_per_daa: f.nPerDaa ?? '', P_kg_per_daa: f.pPerDaa ?? '', K_kg_per_daa: f.kPerDaa ?? '', metode: f.method || '', utfort_av: f.operator || '', merknad: f.notes || '' });

async function edit(f, ctx) {
  const db = dbAll();
  const fieldsActive = db.fields.filter((x) => x.active !== false || x.id === f?.fieldId);
  if (!fieldsActive.length) return toast(t('crate.noFieldsText'), 'error');
  const known = new Map();
  for (const x of db.fertilizations.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) if (x.product) known.set(x.product.toLowerCase(), x);
  const cur = f || { date: D.todayKey(), fieldId: fieldsActive[0].id, kind: 'mineral', unit: 'kg/daa', method: 'spread', operator: '' };
  const c = {
    date: input({ type: 'date', value: cur.date, name: 'date', required: true }),
    fieldId: select(fieldsActive.map((x) => [x.id, x.name]), cur.fieldId, { name: 'field' }),
    areaDaa: input({ type: 'number', step: '0.1', min: 0, name: 'area', value: cur.areaDaa ?? '' }),
    product: input({ name: 'product', value: cur.product || '', required: true, list: 'fert-known', autocomplete: 'off' }),
    kind: select(KINDS.map((k) => [k, t('fert.kind.' + k)]), cur.kind, { name: 'kind' }),
    amount: input({ type: 'number', step: 'any', min: 0, name: 'amount', value: cur.amount ?? '', required: true, inputmode: 'decimal' }),
    unit: select(UNITS.map((u) => [u, u.replace('m3', 'm³')]), cur.unit, { name: 'unit' }),
    nC: input({ type: 'number', step: 'any', min: 0, name: 'nContent', value: cur.nContent ?? '', inputmode: 'decimal' }),
    pC: input({ type: 'number', step: 'any', min: 0, name: 'pContent', value: cur.pContent ?? '', inputmode: 'decimal' }),
    kC: input({ type: 'number', step: 'any', min: 0, name: 'kContent', value: cur.kContent ?? '', inputmode: 'decimal' }),
    method: select(METHODS.map((m) => [m, t('fert.m.' + m)]), cur.method, { name: 'method' }),
    operator: input({ name: 'operator', value: cur.operator || '' }),
    notes: input({ name: 'notes', value: cur.notes || '', maxlength: 200 }),
  };
  const result = h('p', { class: 'full', 'data-fert-result': '' });
  const contentLabel = h('small', { class: 'hint full' });
  const calc = () => {
    const b = basisFor(c.unit.value);
    return { n: D.nutrientPerDaa(c.amount.value, c.nC.value, b), p: D.nutrientPerDaa(c.amount.value, c.pC.value, b), k: D.nutrientPerDaa(c.amount.value, c.kC.value, b) };
  };
  const refresh = () => {
    const r = calc(); const a = D.num(c.areaDaa.value);
    contentLabel.textContent = basisFor(c.unit.value) === 'pct' ? t('fert.contentPct') : t('fert.contentPerUnit');
    result.replaceChildren(h('strong', {}, t('fert.gives', { n: fmtNum(r.n, 2), p: fmtNum(r.p, 2), k: fmtNum(r.k, 2) })), a ? ` ${t('fert.total', { amount: fmtNum(D.num(c.amount.value) * a, 1), unit: c.unit.value.split('/')[0].replace('m3', 'm³') })}` : '');
  };
  const setArea = () => { const fl = db.fields.find((x) => x.id === c.fieldId.value); c.areaDaa.value = fl?.areaDaa ? Math.round(fl.areaDaa * 10) / 10 : ''; };
  if (!f) setArea();
  c.fieldId.addEventListener('change', () => { setArea(); refresh(); });
  c.product.addEventListener('change', () => {
    const k = known.get(c.product.value.trim().toLowerCase());
    if (!k) return;
    c.kind.value = k.kind || c.kind.value; c.unit.value = k.unit || c.unit.value; c.method.value = k.method || c.method.value;
    c.nC.value = k.nContent ?? ''; c.pC.value = k.pContent ?? ''; c.kC.value = k.kContent ?? '';
    if (!c.amount.value) c.amount.value = k.amount ?? '';
    refresh();
  });
  for (const x of [c.amount, c.unit, c.nC, c.pC, c.kC, c.areaDaa]) x.addEventListener('input', refresh);
  refresh();
  const r = await modal(f ? t('fert.edit') : t('fert.new'), h('div', { class: 'form-grid' },
    h('datalist', { id: 'fert-known' }, [...new Set([...known.values()].map((x) => x.product))].map((n) => h('option', { value: n }))),
    field(t('common.date'), c.date), field(t('spray.field'), c.fieldId), field(t('fields.areaDaa'), c.areaDaa, t('fert.areaHint')),
    field(t('fert.product'), c.product, known.size ? t('fert.productHint') : null), field(t('fert.kindLabel'), c.kind), field(t('fert.method'), c.method),
    field(t('fert.amount'), c.amount), field(t('spray.unit'), c.unit), field(t('spray.operator'), c.operator),
    field('N', c.nC), field('P', c.pC), field('K', c.kC), contentLabel,
    result,
    h('div', { class: 'full' }, field(t('spray.notes'), c.notes))),
  [f ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null },
    { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
      if (!c.date.value) { c.date.focus(); return false; }
      if (!c.product.value.trim()) { c.product.focus(); return false; }
      if (!(D.num(c.amount.value) > 0)) { c.amount.focus(); return false; }
      return true;
    } }].filter(Boolean), { wide: true });
  if (!r) return;
  if (r === 'delete') {
    if (!(await confirmDialog(t('fert.deleteTitle'), t('fert.deleteText'), t('common.delete')))) return;
    store.remove('fertilizations', f.id, actor()); toast(t('common.deleted')); return ctx.redraw();
  }
  const n = calc();
  const fl = db.fields.find((x) => x.id === c.fieldId.value);
  const val = (x) => (x.value === '' ? null : D.num(x.value));
  store.put('fertilizations', { ...cur, date: c.date.value, fieldId: c.fieldId.value, fieldName: fl?.name || '', crop: fl?.crop || '', areaDaa: D.num(c.areaDaa.value), product: c.product.value.trim(), kind: c.kind.value,
    amount: D.num(c.amount.value), unit: c.unit.value, nContent: val(c.nC), pContent: val(c.pC), kContent: val(c.kC), nPerDaa: n.n, pPerDaa: n.p, kPerDaa: n.k,
    method: c.method.value, operator: c.operator.value.trim(), notes: c.notes.value.trim() }, actor());
  toast(t('common.saved'));
  ctx.redraw();
}

function printJournal(list, fields, totals) {
  const st = store.settings();
  const th = (x) => h('th', {}, x), td = (x) => h('td', {}, x);
  printNodes([h('div', { class: 'print-doc' },
    h('h1', {}, t('fert.printTitle', { year })), h('p', {}, st.farmName || '', st.orgNo ? ` · ${t('settings.orgNo')} ${st.orgNo}` : ''),
    h('table', { class: 'print-table' }, h('thead', {}, h('tr', {}, ...[t('common.date'), t('spray.field'), t('fields.areaDaa'), t('fert.product'), t('fert.amount'), 'N kg/daa', 'P kg/daa', 'K kg/daa', t('fert.method'), t('spray.operator')].map(th))),
      h('tbody', {}, list.slice().reverse().map((f) => h('tr', {}, td(f.date), td(fields.get(f.fieldId)?.name || f.fieldName || ''), td(fmtNum(f.areaDaa, 1)), td(`${f.product} (${t('fert.kind.' + (f.kind || 'other'))})`), td(`${fmtNum(f.amount, 2)} ${f.unit}`), td(fmtNum(f.nPerDaa, 2)), td(fmtNum(f.pPerDaa, 2)), td(fmtNum(f.kPerDaa, 2)), td(f.method ? t('fert.m.' + f.method) : ''), td(f.operator || ''))))),
    h('h2', {}, t('fert.totals', { year })),
    h('table', { class: 'print-table' }, h('thead', {}, h('tr', {}, ...[t('spray.field'), 'N kg', 'P kg', 'K kg'].map(th))),
      h('tbody', {}, Object.entries(totals).map(([id, o]) => h('tr', {}, td(fields.get(id)?.name || '–'), td(fmtNum(o.n, 1)), td(fmtNum(o.p, 1)), td(fmtNum(o.k, 1)))))),
    h('p', { class: 'small' }, t('fert.legalNote')))], t('fert.printTitle', { year }));
}
