// Plantevernmidler (kundens eget register) og lager: innkjøp, beholdning, forbruk (trekkes automatisk fra sprøytejournalen).
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty, fmtNum, fmtDate, download, toCsv, pickFile } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { pageHead } from './index.js';
import { actor, dbAll } from '../shared.js';
import { parseCsv } from '../../core/csv.js';

export function render(ctx) {
  const db = dbAll();
  const bal = D.stockBalance(db);
  const products = db.products.slice().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name, 'nb'));
  const moves = db.stock.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 60);
  const byId = new Map(db.products.map((p) => [p.id, p]));
  return h('div', { class: 'stack' },
    pageHead(t('nav.products'), t('products.text'),
      h('button', { class: 'btn light', onclick: () => importCsv(ctx) }, icon('upload', 18), t('products.import')),
      h('button', { class: 'btn light', onclick: () => download('plantevernmidler.csv', toCsv(products.map(csvRow)), 'text/csv') }, icon('download', 18), 'CSV'),
      h('button', { class: 'btn primary', 'data-act': 'add-product', onclick: () => editProduct(null, ctx) }, icon('plus', 18), t('products.add'))),
    h('div', { class: 'notice' }, icon('info'), h('p', {}, t('products.sourceNote'))),
    h('div', { class: 'card' }, h('h3', {}, t('products.register')),
      products.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-products': '' },
        h('thead', {}, h('tr', {}, ...[t('products.name'), t('products.regNo'), t('products.substance'), t('spray.phiShort'), t('products.defaultDose'), t('stock.balance'), ''].map((x, i) => h('th', { class: i === 5 ? 'num' : '' }, x)))),
        h('tbody', {}, products.map((p) => {
          const b = bal[p.id];
          const expired = p.validUntil && p.validUntil < D.todayKey();
          return h('tr', { 'data-product': p.name },
            h('td', {}, h('strong', {}, p.name), p.active === false ? h('span', { class: 'tag' }, t('products.inactive')) : null, expired ? h('span', { class: 'tag bad' }, t('products.expired')) : null),
            h('td', { class: 'mono' }, p.regNo || '–'), h('td', {}, p.substance || '–'), h('td', {}, `${p.phiDays ?? 0} ${t('unit.days')}`),
            h('td', {}, p.defaultDose ? `${fmtNum(p.defaultDose, 3)} ${p.defaultUnit || ''}` : '–'),
            h('td', { class: 'num' }, h('strong', { class: b?.balance < 0 ? 'neg' : '' }, `${fmtNum(b?.balance || 0, 2)} ${p.unit || ''}`)),
            h('td', { class: 'num' }, h('div', { class: 'row end' },
              h('button', { class: 'btn small light', 'data-act': 'purchase', onclick: () => stockMove(p, 'purchase', ctx) }, icon('plus', 16), t('stock.purchase')),
              h('button', { class: 'btn small ghost', onclick: () => stockMove(p, 'count', ctx) }, icon('scale', 16), t('stock.count')),
              h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), title: t('common.edit'), onclick: () => editProduct(p, ctx) }, icon('edit', 18)))));
        }))))
        : empty('flask', t('products.empty'))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('stock.moves')), h('button', { class: 'btn small light', onclick: () => download('lagerbevegelser.csv', toCsv(db.stock.map((m) => moveRow(m, byId))), 'text/csv') }, icon('download', 16), 'CSV')),
      moves.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ...[t('common.date'), t('products.name'), t('stock.type'), t('stock.qty'), t('stock.note'), ''].map((x, i) => h('th', { class: i === 3 ? 'num' : '' }, x)))),
        h('tbody', {}, moves.map((m) => h('tr', {},
          h('td', {}, fmtDate(m.ts)), h('td', {}, byId.get(m.productId)?.name || '–'), h('td', {}, h('span', { class: `tag ${m.type === 'purchase' ? 'ok' : m.type === 'use' ? 'blue' : ''}` }, t('stock.t.' + m.type))),
          h('td', { class: 'num' }, `${m.qty > 0 ? '+' : ''}${fmtNum(m.qty, 3)} ${m.unit || ''}`), h('td', {}, m.note || ''),
          h('td', { class: 'num' }, m.type !== 'use' ? h('button', { class: 'icon-btn', 'aria-label': t('common.delete'), title: t('common.delete'), onclick: async () => { if (await confirmDialog(t('stock.deleteTitle'), t('stock.deleteText'), t('common.delete'))) { store.remove('stock', m.id, actor()); ctx.redraw(); } } }, icon('trash', 16)) : h('span', { class: 'small muted' }, t('stock.fromJournal'))))))))
        : h('p', { class: 'muted' }, t('stock.noMoves'))));
}

const csvRow = (p) => ({ name: p.name, regNo: p.regNo || '', substance: p.substance || '', unit: p.unit || '', phiDays: p.phiDays ?? '', defaultDose: p.defaultDose ?? '', defaultUnit: p.defaultUnit || '', maxDose: p.maxDose ?? '', maxTimes: p.maxTimes ?? '', validUntil: p.validUntil || '', notes: p.notes || '' });
const moveRow = (m, byId) => ({ date: m.ts?.slice(0, 10), product: byId.get(m.productId)?.name || '', type: m.type, qty: m.qty, unit: m.unit || '', note: m.note || '', sprayId: m.sprayId || '' });

async function editProduct(p, ctx) {
  const cur = p || { name: '', regNo: '', substance: '', unit: 'l', phiDays: '', defaultDose: '', defaultUnit: 'l/daa', active: true };
  const f = {
    name: input({ value: cur.name, required: true, name: 'name' }), regNo: input({ value: cur.regNo || '', name: 'regNo' }), substance: input({ value: cur.substance || '', name: 'substance' }),
    unit: select([['l', 'l'], ['kg', 'kg']], cur.unit, { name: 'unit' }), phiDays: input({ type: 'number', min: 0, step: 1, value: cur.phiDays ?? '', name: 'phiDays' }),
    defaultDose: input({ type: 'number', min: 0, step: 'any', value: cur.defaultDose ?? '', name: 'defaultDose' }), defaultUnit: select(D.DOSE_UNITS.map((u) => [u, u]), cur.defaultUnit, { name: 'defaultUnit' }),
    maxDose: input({ type: 'number', min: 0, step: 'any', value: cur.maxDose ?? '', name: 'maxDose' }), maxTimes: input({ type: 'number', min: 0, step: 1, value: cur.maxTimes ?? '', name: 'maxTimes' }),
    validUntil: input({ type: 'date', value: cur.validUntil || '', name: 'validUntil' }), notes: input({ value: cur.notes || '', name: 'notes' }),
  };
  const active = h('input', { type: 'checkbox', checked: cur.active !== false });
  const r = await modal(p ? t('products.edit') : t('products.add'), h('div', { class: 'form-grid' },
    field(t('products.name'), f.name), field(t('products.regNo'), f.regNo), field(t('products.substance'), f.substance), field(t('products.unit'), f.unit),
    field(t('products.phiDays'), f.phiDays, t('products.phiHint')), field(t('products.defaultDose'), f.defaultDose), field(t('spray.unit'), f.defaultUnit),
    field(t('products.maxDose'), f.maxDose), field(t('products.maxTimes'), f.maxTimes), field(t('products.validUntil'), f.validUntil), field(t('spray.notes'), f.notes),
    h('label', { class: 'check' }, active, t('products.activeLabel')),
    h('p', { class: 'small muted full' }, t('products.labelNote'))),
  [p ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null },
    { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
      if (!f.name.value.trim()) { f.name.focus(); return false; }
      const n = (x) => (x.value === '' ? null : D.num(x.value));
      return { name: f.name.value.trim(), regNo: f.regNo.value.trim(), substance: f.substance.value.trim(), unit: f.unit.value, phiDays: n(f.phiDays) ?? 0, defaultDose: n(f.defaultDose), defaultUnit: f.defaultUnit.value, maxDose: n(f.maxDose), maxTimes: n(f.maxTimes), validUntil: f.validUntil.value || null, notes: f.notes.value.trim(), active: active.checked };
    } }].filter(Boolean), { wide: true });
  if (!r) return;
  if (r === 'delete') {
    const used = store.all('sprays').some((s) => s.products?.some((x) => x.productId === p.id));
    if (used) { store.patch('products', p.id, { active: false }, actor()); toast(t('products.deactivated')); return ctx.redraw(); }
    if (!(await confirmDialog(t('products.deleteTitle'), t('products.deleteText', { name: p.name }), t('common.delete')))) return;
    store.remove('products', p.id, actor()); return ctx.redraw();
  }
  store.put('products', { ...cur, ...r }, actor());
  toast(t('common.saved'));
  ctx.redraw();
}

async function stockMove(p, kind, ctx) {
  const b = D.stockBalance(dbAll())[p.id];
  const qty = input({ type: 'number', step: 'any', min: 0, required: true, name: 'qty' });
  const date = input({ type: 'date', value: D.todayKey(), name: 'date' });
  const note = input({ name: 'note', placeholder: kind === 'purchase' ? t('stock.supplierPh') : '' });
  const r = await modal(kind === 'purchase' ? t('stock.purchaseTitle', { name: p.name }) : t('stock.countTitle', { name: p.name }), h('div', { class: 'form-grid' },
    kind === 'count' ? h('p', { class: 'full' }, t('stock.countText', { qty: fmtNum(b?.balance || 0, 3), unit: p.unit || '' })) : null,
    field(`${kind === 'purchase' ? t('stock.qty') : t('stock.counted')} (${p.unit || ''})`, qty), field(t('common.date'), date), field(t('stock.note'), note)),
  [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.save'), class: 'primary', submit: true, onClick: () => (qty.value === '' ? (qty.focus(), false) : D.num(qty.value)) }]);
  if (r === null || r === undefined) return;
  const ts = `${date.value || D.todayKey()}T12:00:00`;
  if (kind === 'purchase') store.put('stock', { productId: p.id, ts, type: 'purchase', qty: r, unit: p.unit || '', note: note.value.trim() }, actor());
  else {
    const diff = D.round(r - (b?.balance || 0), 4);
    if (!diff) return toast(t('stock.noDiff'), 'info');
    store.put('stock', { productId: p.id, ts, type: 'count', qty: diff, unit: p.unit || '', note: note.value.trim() || t('stock.countNote', { qty: r }) }, actor());
  }
  toast(t('common.saved'));
  ctx.redraw();
}

async function importCsv(ctx) {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  const rows = parseCsv(await file.text()).filter((r) => r.name);
  if (!rows.length) return toast(t('products.importNone'), 'error');
  const existing = new Map(store.all('products').map((p) => [(p.regNo || p.name).toLowerCase(), p]));
  const ok = await modal(t('products.importTitle', { n: rows.length }), h('div', { class: 'stack' }, h('p', {}, t('products.importText')),
    h('ul', {}, rows.slice(0, 15).map((r) => h('li', {}, r.name, r.regNo ? ` (${r.regNo})` : '', existing.has((r.regNo || r.name).toLowerCase()) ? ` – ${t('products.willUpdate')}` : ''))), rows.length > 15 ? h('p', { class: 'muted' }, '…') : null),
  [{ label: t('common.cancel'), class: 'ghost', value: false }, { label: t('fields.importBtn'), class: 'primary', value: true }]);
  if (!ok) return;
  const n = (v) => (v === undefined || v === '' ? null : D.num(v));
  for (const r of rows) {
    const ex = existing.get((r.regNo || r.name).toLowerCase());
    store.put('products', { ...(ex || { active: true }), name: r.name, regNo: r.regNo || '', substance: r.substance || '', unit: r.unit === 'kg' ? 'kg' : 'l', phiDays: n(r.phiDays) ?? 0, defaultDose: n(r.defaultDose), defaultUnit: D.DOSE_UNITS.includes(r.defaultUnit) ? r.defaultUnit : (r.unit === 'kg' ? 'kg/daa' : 'l/daa'), maxDose: n(r.maxDose), maxTimes: n(r.maxTimes), validUntil: r.validUntil || null, notes: r.notes || '' }, actor());
  }
  toast(t('products.imported', { n: rows.length }));
  ctx.redraw();
}
