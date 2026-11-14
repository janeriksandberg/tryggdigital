// Registreringer: arbeidstid (inn/ut) og kasser per dag. Administrator kan rette glemt utstempling og feilregistreringer.
// Alle endringer lagres med hvem som endret (_by) og versjon, så det er sporbart i ettertid.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty, fmtTime, fmtNum, fmtDuration, fmtDay, toLocalInput, download, toCsv } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { pageHead } from './index.js';
import { actor, dbAll } from '../shared.js';

let day = D.todayKey();
let tab = 'shifts';

export function render(ctx) {
  const db = dbAll();
  const people = new Map(db.people.map((p) => [p.id, p]));
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const vars = new Map(db.varieties.map((v) => [v.id, v]));
  const cts = new Map(db.crateTypes.map((c) => [c.id, c]));
  const shifts = db.shifts.filter((s) => D.dayKey(s.start) === day).sort((a, b) => (people.get(a.personId)?.name || '').localeCompare(people.get(b.personId)?.name || '', 'nb'));
  const crates = db.crates.filter((c) => D.dayKey(c.ts) === day).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const openOld = db.shifts.filter((s) => !s.end && D.dayKey(s.start) < D.todayKey());
  const nav = (n) => { day = D.addDays(day, n); ctx.redraw(); };
  return h('div', { class: 'stack' },
    pageHead(t('nav.registrations'), t('reg.text'),
      h('button', { class: 'btn light', onclick: () => exportHours() }, icon('download', 18), t('reg.exportHours')),
      h('button', { class: 'btn primary', onclick: () => (tab === 'shifts' ? editShift(null, ctx) : editCrate(null, ctx)) }, icon('plus', 18), tab === 'shifts' ? t('reg.addShift') : t('reg.addCrate'))),
    openOld.length ? h('div', { class: 'notice warn', 'data-open-old': openOld.length }, icon('alert'), h('div', { class: 'grow' }, h('p', {}, t('reg.openOld', { n: openOld.length })),
      h('div', { class: 'row wrap' }, openOld.slice(0, 8).map((s) => h('button', { class: 'btn small light', onclick: () => editShift(s, ctx) }, `${people.get(s.personId)?.name || '?'} · ${fmtDay(D.dayKey(s.start))}`))))) : null,
    h('div', { class: 'row wrap' },
      h('button', { class: 'icon-btn', 'aria-label': t('reg.prevDay'), onclick: () => nav(-1) }, icon('chevLeft')),
      input({ type: 'date', value: day, style: { width: 'auto' }, onchange: (e) => { day = e.target.value || day; ctx.redraw(); } }),
      h('button', { class: 'icon-btn', 'aria-label': t('reg.nextDay'), onclick: () => nav(1) }, icon('chevRight')),
      h('strong', {}, fmtDay(day)),
      h('div', { class: 'grow' }),
      h('div', { class: 'seg' }, [['shifts', t('reg.shifts'), shifts.length], ['crates', t('reg.crates'), crates.reduce((a, c) => a + D.num(c.count), 0)]].map(([k, l, n]) => h('button', { type: 'button', class: tab === k ? 'on' : '', onclick: () => { tab = k; ctx.redraw(); } }, `${l} (${n})`)))),
    tab === 'shifts'
      ? h('div', { class: 'card' }, shifts.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-shifts': '' },
        h('thead', {}, h('tr', {}, ...[t('people.name'), t('reg.in'), t('reg.out'), t('reg.hours'), t('reg.changedBy'), ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, shifts.map((s) => h('tr', {},
          h('td', {}, h('strong', {}, people.get(s.personId)?.name || '?')),
          h('td', {}, fmtTime(s.start)), h('td', {}, s.end ? fmtTime(s.end) : h('span', { class: 'tag ok' }, t('reg.atWork'))),
          h('td', {}, fmtDuration(D.shiftHours(s))), h('td', { class: 'small muted' }, s._by && !people.has(s._by) ? s._by : ''),
          h('td', { class: 'num' }, h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), title: t('common.edit'), onclick: () => editShift(s, ctx) }, icon('edit', 18)))))))) : empty('clock', t('reg.noShifts')))
      : h('div', { class: 'card' }, crates.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-crates': '' },
        h('thead', {}, h('tr', {}, ...[t('reg.time'), t('people.name'), t('spray.field'), t('crate.variety'), t('crate.type'), t('reg.count'), 'kg', t('crate.quality'), ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, crates.map((c) => h('tr', {},
          h('td', {}, fmtTime(c.ts)), h('td', {}, people.get(c.personId)?.name || '?'), h('td', {}, fields.get(c.fieldId)?.name || '–', c.karensOverride ? h('span', { class: 'tag bad' }, t('reg.inKarens')) : null),
          h('td', {}, vars.get(c.varietyId)?.name || '–'), h('td', {}, cts.get(c.crateTypeId)?.name || '–'), h('td', {}, fmtNum(c.count, 0)), h('td', {}, c.weightKg ? fmtNum(c.weightKg, 1) : ''), h('td', {}, c.quality || ''),
          h('td', { class: 'num' }, h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), title: t('common.edit'), onclick: () => editCrate(c, ctx) }, icon('edit', 18)))))))) : empty('box', t('reg.noCrates'))),
    h('p', { class: 'small muted' }, t('reg.legalNote')));
}

const pickers = () => store.all('people').filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'nb'));

async function editShift(s, ctx) {
  const cur = s || { personId: '', start: `${day}T07:00`, end: `${day}T15:00` };
  const who = select(pickers().map((p) => [p.id, p.name]), cur.personId, { name: 'person', disabled: !!s || null });
  const start = input({ type: 'datetime-local', value: toLocalInput(cur.start), name: 'start', required: true });
  const end = input({ type: 'datetime-local', value: cur.end ? toLocalInput(cur.end) : '', name: 'end' });
  const r = await modal(s ? t('reg.editShift') : t('reg.addShift'), h('div', { class: 'form-grid' }, field(t('people.name'), who), h('span'), field(t('reg.in'), start), field(t('reg.out'), end, t('reg.outHint'))),
    [s ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
        if (!start.value || !who.value) return false;
        if (end.value && end.value <= start.value) { toast(t('reg.endBeforeStart'), 'error'); return false; }
        if (end.value && (new Date(end.value) - new Date(start.value)) > 16 * 3600e3) { toast(t('reg.tooLong'), 'error'); return false; }
        return { personId: who.value, start: new Date(start.value).toISOString(), end: end.value ? new Date(end.value).toISOString() : null };
      } }].filter(Boolean));
  if (!r) return;
  if (r === 'delete') { if (await confirmDialog(t('reg.deleteShift'), t('reg.deleteShiftText'), t('common.delete'))) { store.remove('shifts', s.id, actor()); toast(t('common.deleted')); ctx.redraw(); } return; }
  store.put('shifts', { ...cur, ...r }, actor());
  toast(t('common.saved'));
  ctx.redraw();
}

async function editCrate(c, ctx) {
  const db = dbAll();
  const cur = c || { personId: '', ts: `${day}T12:00`, count: 1, ...D.crateDefaults(db, db.fields[0]?.id) };
  const who = select(pickers().map((p) => [p.id, p.name]), cur.personId, { name: 'person' });
  const ts = input({ type: 'datetime-local', value: toLocalInput(cur.ts), name: 'ts' });
  const fieldSel = select(db.fields.map((f) => [f.id, f.name]), cur.fieldId, { name: 'field' });
  const vSel = select([['', '–'], ...db.varieties.map((v) => [v.id, v.name])], cur.varietyId, { name: 'variety' });
  const cSel = select([['', '–'], ...db.crateTypes.map((x) => [x.id, x.name])], cur.crateTypeId, { name: 'crateType' });
  const count = input({ type: 'number', min: 1, step: 1, value: cur.count, name: 'count' });
  const kg = input({ type: 'number', min: 0, step: 'any', value: cur.weightKg ?? '', name: 'kg' });
  const q = select([['', '–'], ['A', 'A'], ['B', 'B'], ['C', 'C']], cur.quality, { name: 'quality' });
  const r = await modal(c ? t('reg.editCrate') : t('reg.addCrate'), h('div', { class: 'form-grid' },
    field(t('people.name'), who), field(t('reg.time'), ts), field(t('spray.field'), fieldSel), field(t('crate.variety'), vSel), field(t('crate.type'), cSel), field(t('reg.count'), count), field(t('crate.weight'), kg), field(t('crate.quality'), q),
    c ? h('p', { class: 'small muted full' }, t('reg.rateKept', { rate: fmtNum(c.rate, 2) })) : null),
  [c ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null },
    { label: t('common.save'), class: 'primary', submit: true, onClick: () => (who.value && D.num(count.value) > 0 ? true : false) }].filter(Boolean), { wide: true });
  if (!r) return;
  if (r === 'delete') { if (await confirmDialog(t('reg.deleteCrate'), t('reg.deleteCrateText'), t('common.delete'))) { store.remove('crates', c.id, actor()); toast(t('common.deleted')); ctx.redraw(); } return; }
  const data = { ...cur, personId: who.value, ts: new Date(ts.value).toISOString(), fieldId: fieldSel.value, varietyId: vSel.value || null, crateTypeId: cSel.value || null, count: D.num(count.value), weightKg: kg.value === '' ? null : D.num(kg.value), quality: q.value || null };
  // Satsen beholdes for eksisterende kasser (den gjaldt da kassen ble levert), men settes på nytt hvis sort/kassetype endres
  if (!c || c.varietyId !== data.varietyId || c.crateTypeId !== data.crateTypeId) data.rate = D.crateRate(db, data);
  store.put('crates', data, actor());
  toast(t('common.saved'));
  ctx.redraw();
}

/** Arbeidstidsoversikt for hele året så langt (aml. § 10-7): hvem, dato, inn, ut, timer. */
function exportHours() {
  const people = new Map(store.all('people').map((p) => [p.id, p]));
  const y = day.slice(0, 4);
  const rows = store.all('shifts').filter((s) => String(s.start).startsWith(y)).sort((a, b) => (a.start < b.start ? -1 : 1)).map((s) => ({
    [t('people.name')]: people.get(s.personId)?.name || s.personId, [t('people.number')]: people.get(s.personId)?.number || '', [t('common.date')]: D.dayKey(s.start),
    [t('reg.in')]: fmtTime(s.start), [t('reg.out')]: s.end ? fmtTime(s.end) : '', [t('reg.hours')]: D.round(D.shiftHours(s), 2),
  }));
  if (!rows.length) return toast(t('reg.noShifts'), 'info');
  download(`arbeidstid-${y}.csv`, toCsv(rows), 'text/csv');
}
