// Sporbarhet: paller og kasseetiketter med QR (jorde, dato, plukker), oppslag fra etikett, og revisjonsgrunnlag.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, field, input, select, empty, fmtDate, fmtNum, fmtDateTime, qrSvg, download, toCsv } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { cropName } from '../../core/crops.js';
import { pageHead } from './index.js';
import { actor, dbAll } from '../shared.js';
import { printNodes, previewAndPrint } from '../print.js';
import { scan } from '../../scanner.js';
import { journalRows, wxText } from './spraying.js';
import { CREDIT } from '../../core/weather.js';
import { PALLET_PREFIX, crateCode, parseLabel, nextPalletNo } from '../../core/labels.js';

/** Kasser fra et jorde (og evt. sort) på en dag, gruppert per plukker. */
export function cratesFor(db, date, fieldId, varietyId) {
  const out = {};
  for (const c of db.crates) {
    if (D.dayKey(c.ts) !== date || c.fieldId !== fieldId || (varietyId && c.varietyId !== varietyId)) continue;
    const o = (out[c.personId] ??= { crates: 0, kg: 0 });
    o.crates += D.num(c.count); o.kg += D.num(c.weightKg);
  }
  return out;
}
/** Sprøytinger på jordet de siste `days` dagene før en dato (for sporbarhet bakover). */
export function spraysBefore(db, fieldId, date, days = 90) {
  const from = D.addDays(date, -days);
  return db.sprays.filter((s) => s.fieldId === fieldId && s.date <= date && s.date >= from).sort((a, b) => (a.date < b.date ? 1 : -1));
}

let from = D.addDays(D.todayKey(), -30), to = D.todayKey();

export function render(ctx) {
  const db = dbAll();
  const pallets = db.pallets.filter((p) => p.date >= from && p.date <= to).sort((a, b) => (a.no < b.no ? 1 : -1));
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const vars = new Map(db.varieties.map((v) => [v.id, v]));
  return h('div', { class: 'stack' },
    pageHead(t('nav.trace'), t('trace.text'),
      h('button', { class: 'btn light', 'data-act': 'lookup', onclick: () => lookup() }, icon('scan', 18), t('trace.lookup')),
      h('button', { class: 'btn light', onclick: () => crateLabels() }, icon('tag', 18), t('trace.crateLabels')),
      h('button', { class: 'btn primary', 'data-act': 'new-pallet', onclick: () => newPallet(ctx) }, icon('plus', 18), t('trace.newPallet'))),
    h('div', { class: 'card row wrap' },
      field(t('common.from'), input({ type: 'date', value: from, onchange: (e) => { from = e.target.value || from; ctx.redraw(); } })),
      field(t('common.to'), input({ type: 'date', value: to, onchange: (e) => { to = e.target.value || to; ctx.redraw(); } })),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn dark', 'data-act': 'audit', onclick: () => auditReport(from, to) }, icon('clipboard', 18), t('trace.audit')),
      h('button', { class: 'btn light', onclick: () => auditCsv(from, to) }, icon('download', 18), t('trace.auditCsv'))),
    h('div', { class: 'card' }, h('h3', {}, t('trace.pallets')),
      pallets.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-pallets': '' },
        h('thead', {}, h('tr', {}, ...[t('trace.no'), t('common.date'), t('spray.field'), t('crate.variety'), t('trace.crates'), t('trace.pickers'), ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, pallets.map((p) => h('tr', { 'data-pallet': p.no },
          h('td', { class: 'mono' }, h('strong', {}, p.no)), h('td', {}, fmtDate(p.date)), h('td', {}, fields.get(p.fieldId)?.name || p.fieldName || '–'), h('td', {}, vars.get(p.varietyId)?.name || '–'),
          h('td', {}, fmtNum(p.count, 0)), h('td', {}, String(Object.keys(p.pickers || {}).length)),
          h('td', { class: 'num' }, h('div', { class: 'row end' },
            h('button', { class: 'icon-btn', title: t('trace.details'), 'aria-label': t('trace.details'), onclick: () => showPallet(p) }, icon('eye', 18)),
            h('button', { class: 'icon-btn', title: t('trace.printLabel'), 'aria-label': t('trace.printLabel'), onclick: () => previewAndPrint(h('div', { class: 'labels-sheet' }, palletLabel(p, db)), p.no) }, icon('printer', 18)))))))))
        : empty('tag', t('trace.noPallets'))),
    h('p', { class: 'small muted' }, t('trace.auditNote')));
}

function palletLabel(p, db) {
  const f = db.fields.find((x) => x.id === p.fieldId);
  const v = db.varieties.find((x) => x.id === p.varietyId);
  const people = new Map(db.people.map((x) => [x.id, x]));
  const nums = Object.keys(p.pickers || {}).map((id) => people.get(id)?.number ? `#${people.get(id).number}` : '?').join(' ');
  const q = h('div', { class: 'qr' }); q.innerHTML = qrSvg(PALLET_PREFIX + p.id, 150, 'M');
  return h('div', { class: 'label' },
    h('div', {}, h('div', { class: 'lcode' }, p.no), h('dl', {},
      h('dt', {}, t('spray.field')), h('dd', {}, f?.name || p.fieldName || '–'),
      h('dt', {}, t('common.date')), h('dd', {}, p.date),
      h('dt', {}, t('crate.variety')), h('dd', {}, v?.name || '–'),
      h('dt', {}, t('trace.crates')), h('dd', {}, String(p.count)),
      h('dt', {}, t('trace.pickers')), h('dd', {}, nums || '–'),
      h('dt', {}, t('trace.farm')), h('dd', {}, store.settings().farmName || ''))),
    q);
}

async function newPallet(ctx) {
  const db = dbAll();
  const date = input({ type: 'date', value: D.todayKey(), name: 'date' });
  const fieldSel = select(db.fields.filter((f) => f.active !== false).map((f) => [f.id, f.name]), db.fields[0]?.id, { name: 'field' });
  const varSel = select([['', t('trace.allVarieties')], ...db.varieties.map((v) => [v.id, v.name])], '', { name: 'variety' });
  const count = input({ type: 'number', min: 1, step: 1, name: 'count' });
  const note = input({ name: 'note', maxlength: 120 });
  const info = h('div', { class: 'notice' });
  const refresh = () => {
    const by = cratesFor(db, date.value, fieldSel.value, varSel.value);
    const total = Object.values(by).reduce((a, x) => a + x.crates, 0);
    const already = db.pallets.filter((p) => p.date === date.value && p.fieldId === fieldSel.value && (!varSel.value || p.varietyId === varSel.value)).reduce((a, p) => a + D.num(p.count), 0);
    info.replaceChildren(icon('info'), h('p', {}, t('trace.foundCrates', { n: total, pickers: Object.keys(by).length, already })));
    if (!count.value || count.dataset.auto) { count.value = Math.max(0, total - already) || ''; count.dataset.auto = '1'; }
  };
  count.addEventListener('input', () => delete count.dataset.auto);
  [date, fieldSel, varSel].forEach((x) => x.addEventListener('change', refresh));
  refresh();
  const r = await modal(t('trace.newPallet'), h('div', { class: 'form-grid' }, field(t('common.date'), date), field(t('spray.field'), fieldSel), field(t('crate.variety'), varSel), field(t('trace.crates'), count), h('div', { class: 'full' }, info), h('div', { class: 'full' }, field(t('spray.notes'), note))),
    [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('trace.createAndPrint'), class: 'primary', submit: true, onClick: () => (D.num(count.value) > 0 && fieldSel.value ? true : (count.focus(), false)) }], { wide: true });
  if (!r) return;
  const f = db.fields.find((x) => x.id === fieldSel.value);
  const pickers = cratesFor(db, date.value, fieldSel.value, varSel.value);
  const p = store.put('pallets', { no: nextPalletNo(db.pallets, Number(date.value.slice(0, 4))), date: date.value, fieldId: f.id, fieldName: f.name, crop: f.crop, varietyId: varSel.value || f.defaultVarietyId || null, count: D.num(count.value), pickers, note: note.value.trim(), createdAt: new Date().toISOString() }, actor());
  toast(t('trace.created', { no: p.no }));
  ctx.redraw();
  previewAndPrint(h('div', { class: 'labels-sheet' }, palletLabel(p, dbAll())), p.no);
}

/** Viser alt som er kjent om en palle: plukkere, sprøytinger på jordet før høsting og karenstid. */
async function showPallet(p) {
  const db = dbAll();
  const people = new Map(db.people.map((x) => [x.id, x]));
  const sprays = spraysBefore(db, p.fieldId, p.date);
  const k = D.karensFor(db, p.fieldId, p.date);
  await modal(`${p.no} · ${p.fieldName || ''}`, traceBody(db, { date: p.date, fieldId: p.fieldId, pickers: p.pickers || {}, people, sprays, karens: k, note: p.note }), [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
}
function traceBody(db, { date, fieldId, pickers, people, sprays, karens, note }) {
  const f = db.fields.find((x) => x.id === fieldId);
  return h('div', { class: 'stack' },
    h('p', {}, h('strong', {}, f?.name || '–'), ` · ${cropName(f?.crop)} · ${fmtDate(date)}`, note ? ` · ${note}` : ''),
    karens ? h('div', { class: 'notice bad' }, icon('alert'), h('p', {}, t('trace.inKarens', { date: fmtDate(karens.allowedFrom) }))) : h('div', { class: 'notice ok' }, icon('checkCircle'), h('p', {}, t('trace.noKarens'))),
    h('h3', {}, t('trace.pickers')),
    Object.keys(pickers).length ? h('ul', {}, Object.entries(pickers).map(([id, v]) => h('li', {}, `${people.get(id)?.name || '?'}${people.get(id)?.number ? ` (#${people.get(id).number})` : ''}: ${fmtNum(v.crates, 0)} ${t('trace.crates').toLowerCase()}`))) : h('p', { class: 'muted' }, '–'),
    h('h3', {}, t('trace.spraysBefore')),
    sprays.length ? h('ul', {}, sprays.map((s) => h('li', {}, `${fmtDate(s.date)}: ${(s.products || []).map((x) => `${x.name} ${fmtNum(x.dose, 3)} ${x.unit}`).join(', ')} – ${t('spray.harvestFrom')} ${fmtDate(D.harvestAllowedFrom(s, db.products))} (${s.operator || ''})`))) : h('p', { class: 'muted' }, t('trace.noSprays')));
}

async function lookup() {
  const raw = await scan({ title: t('trace.lookup'), hint: t('trace.lookupHint'), placeholder: 'TD2P:… / P2026-0001' });
  if (!raw) return;
  const db = dbAll();
  const l = parseLabel(raw);
  if (!l) return toast(t('trace.unknownLabel'), 'error');
  if (l.kind === 'pallet' || l.kind === 'palletNo') {
    const norm = (s) => s.replace(/^P-?(\d{4})-?(\d+)$/i, (_, y, n) => `P${y}-${n.padStart(4, '0')}`);
    const p = l.kind === 'pallet' ? db.pallets.find((x) => x.id === l.id) : db.pallets.find((x) => x.no === norm(l.no));
    return p ? showPallet(p) : toast(t('trace.notFound'), 'error');
  }
  const people = new Map(db.people.map((x) => [x.id, x]));
  const by = cratesFor(db, l.date, l.fieldId);
  await modal(t('trace.crateLabel'), traceBody(db, { date: l.date, fieldId: l.fieldId, pickers: by[l.personId] ? { [l.personId]: by[l.personId] } : { [l.personId]: { crates: 0 } }, people, sprays: spraysBefore(db, l.fieldId, l.date), karens: D.karensFor(db, l.fieldId, l.date) }), [{ label: t('common.close'), class: 'primary', value: true }], { wide: true });
}

async function crateLabels() {
  const db = dbAll();
  const date = input({ type: 'date', value: D.todayKey() });
  const fieldSel = select(db.fields.filter((f) => f.active !== false).map((f) => [f.id, f.name]), db.fields[0]?.id);
  const pickers = db.people.filter((p) => p.active !== false && (p.roles || []).includes('picker'));
  const who = select([['*', t('trace.allPickersToday')], ...pickers.map((p) => [p.id, `${p.name}${p.number ? ' #' + p.number : ''}`])], '*');
  const per = input({ type: 'number', min: 1, max: 40, value: 4 });
  const r = await modal(t('trace.crateLabels'), h('div', { class: 'form-grid' }, field(t('common.date'), date), field(t('spray.field'), fieldSel), field(t('trace.picker'), who), field(t('trace.perPicker'), per), h('p', { class: 'small muted full' }, t('trace.crateLabelsHint'))),
    [{ label: t('common.cancel'), class: 'ghost', value: null }, { label: t('trace.makeLabels'), class: 'primary', value: true }], { wide: true });
  if (!r) return;
  const f = db.fields.find((x) => x.id === fieldSel.value);
  if (!f) return;
  const list = who.value === '*' ? pickers.filter((p) => db.shifts.some((s) => s.personId === p.id && D.dayKey(s.start) === date.value) || db.assignments.some((a) => a.personId === p.id && a.date === date.value)) : pickers.filter((p) => p.id === who.value);
  if (!list.length) return toast(t('trace.noPickersDay'), 'error');
  const n = Math.min(40, Math.max(1, D.num(per.value) || 1));
  const labels = list.flatMap((p) => Array.from({ length: n }, () => {
    const q = h('div', { class: 'qr' }); q.innerHTML = qrSvg(crateCode(date.value, f.id, p.id), 150, 'M');
    return h('div', { class: 'label small-label' }, h('div', {}, h('div', { class: 'lcode' }, p.number ? `#${p.number}` : p.name.split(' ')[0]),
      h('dl', {}, h('dt', {}, t('spray.field')), h('dd', {}, f.name), h('dt', {}, t('common.date')), h('dd', {}, date.value), h('dt', {}, t('trace.picker')), h('dd', {}, p.number ? `#${p.number}` : p.name), h('dt', {}, t('trace.farm')), h('dd', {}, store.settings().farmName || ''))), q);
  }));
  previewAndPrint(h('div', { class: 'labels-sheet' }, labels), t('trace.crateLabels'));
}

// ---------- Revisjonsgrunnlag ----------
function auditData(fromK, toK) {
  const db = dbAll();
  const inR = (k) => k >= fromK && k <= toK;
  return {
    db,
    sprays: db.sprays.filter((s) => inR(s.date)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    pallets: db.pallets.filter((p) => inR(p.date)).sort((a, b) => (a.no < b.no ? -1 : 1)),
    stock: db.stock.filter((m) => inR(String(m.ts).slice(0, 10))).sort((a, b) => (a.ts < b.ts ? -1 : 1)),
    sprayers: db.people.filter((p) => (p.roles || []).includes('sprayer')),
    alerts: db.alerts.filter((a) => inR(String(a.ts).slice(0, 10))),
  };
}
function auditReport(fromK, toK) {
  const { db, sprays, pallets, stock, sprayers, alerts } = auditData(fromK, toK);
  const st = db.settings;
  const prod = new Map(db.products.map((p) => [p.id, p]));
  const table = (cols, rows) => h('table', { class: 'print-table' }, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, String(c ?? '')))))));
  const bal = D.stockBalance(db);
  printNodes([h('div', { class: 'print-doc' },
    h('h1', {}, t('trace.auditTitle')),
    h('p', {}, `${st.farmName || ''}${st.orgNo ? ` · ${t('settings.orgNo')} ${st.orgNo}` : ''} · ${st.address || ''}`),
    h('p', {}, t('trace.period', { from: fmtDate(fromK), to: fmtDate(toK) }), ' · ', t('trace.generated', { at: fmtDateTime(new Date()) })),
    h('p', { class: 'small' }, t('trace.auditDisclaimer')),
    h('h2', {}, t('trace.secFields')), table([t('spray.field'), t('fields.crop'), t('fields.areaDaa')], db.fields.map((f) => [f.name, cropName(f.crop), fmtNum(f.areaDaa, 1)])),
    h('h2', {}, t('trace.secProducts')), table([t('products.name'), t('products.regNo'), t('products.substance'), t('spray.phiShort'), t('products.validUntil'), t('stock.balance')], db.products.map((p) => [p.name, p.regNo, p.substance, p.phiDays, p.validUntil || '', `${fmtNum(bal[p.id]?.balance || 0, 2)} ${p.unit || ''}`])),
    h('h2', {}, t('trace.secSprayers')), table([t('people.name'), t('people.certNo'), t('people.certUntil')], sprayers.map((p) => [p.name, p.certNo || '–', p.certUntil || '–'])),
    h('h2', {}, t('trace.secJournal')), table([t('common.date'), t('spray.field'), t('spray.products'), t('spray.target'), t('spray.weather'), t('spray.operator'), t('spray.harvestFrom')],
      sprays.map((s) => [`${s.date} ${s.startTime || ''}`, s.fieldName, (s.products || []).map((x) => `${x.name} (${x.regNo || '–'}) ${x.dose} ${x.unit}`).join('; '), s.target, wxText(s.weather) + (s.weather?.confirmed ? ' ✓' : ''), s.operator, D.harvestAllowedFrom(s, db.products)])),
    h('h2', {}, t('trace.secStock')), table([t('common.date'), t('products.name'), t('stock.type'), t('stock.qty'), t('stock.note')], stock.map((m) => [String(m.ts).slice(0, 10), prod.get(m.productId)?.name, t('stock.t.' + m.type), `${m.qty} ${m.unit || ''}`, m.note])),
    h('h2', {}, t('trace.secPallets')), table([t('trace.no'), t('common.date'), t('spray.field'), t('trace.crates'), t('trace.pickers'), t('trace.lastSpray')],
      pallets.map((p) => { const last = spraysBefore(db, p.fieldId, p.date)[0]; return [p.no, p.date, p.fieldName, p.count, Object.keys(p.pickers || {}).length, last ? `${last.date} (${t('spray.harvestFrom')} ${D.harvestAllowedFrom(last, db.products)})` : '–']; })),
    h('h2', {}, t('trace.secAlerts')), alerts.length ? table([t('common.date'), t('spray.field'), t('trace.picker'), t('foreman.handled')], alerts.map((a) => [fmtDateTime(a.ts), db.fields.find((f) => f.id === a.fieldId)?.name, db.people.find((p) => p.id === a.personId)?.name, a.ack ? `${t('common.yes')} (${a.ackBy || ''})` : t('common.no')])) : h('p', {}, t('trace.noAlerts')),
    h('p', { class: 'small' }, t('spray.wxCredit'), ' ', CREDIT))], t('trace.auditTitle'));
}
function auditCsv(fromK, toK) {
  const { db, sprays, pallets } = auditData(fromK, toK);
  const people = new Map(db.people.map((p) => [p.id, p]));
  const rows = [];
  for (const p of pallets) for (const [pid, v] of Object.entries(p.pickers || {})) rows.push({ pallet: p.no, date: p.date, field: p.fieldName, picker: people.get(pid)?.name || pid, pickerNo: people.get(pid)?.number || '', crates: v.crates, palletCrates: p.count });
  download(`sporbarhet-${fromK}-${toK}.csv`, toCsv(rows.length ? rows : [{ pallet: '' }]), 'text/csv');
  setTimeout(() => download(`sprøytejournal-${fromK}-${toK}.csv`, toCsv(journalRows(sprays).length ? journalRows(sprays) : [{ '': '' }]), 'text/csv'), 400);
}
