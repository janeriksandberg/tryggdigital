// Sprøytejournal og sprøyteoppdrag for administrator.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty, fmtDate, fmtNum, download, toCsv, clear } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { cropName } from '../../core/crops.js';
import { compass, CREDIT } from '../../core/weather.js';
import { pageHead } from './index.js';
import { actor, dbAll } from '../shared.js';
import { sprayForm, deleteSpray } from '../sprayform.js';
import { printNodes } from '../print.js';

let year = new Date().getFullYear();
let editing = null; // null | 'new' | spray-objekt

export function destroy() { editing = null; }

export function render(ctx) {
  if (editing) return formPage(ctx);
  const db = dbAll();
  const years = [...new Set([new Date().getFullYear(), ...db.sprays.map((s) => Number(s.date?.slice(0, 4))).filter(Boolean)])].sort((a, b) => b - a);
  const list = db.sprays.filter((s) => s.date?.startsWith(String(year))).sort((a, b) => (a.date + (a.startTime || '') < b.date + (b.startTime || '') ? 1 : -1));
  const today = D.todayKey();
  const karens = db.fields.map((f) => ({ f, k: D.karensFor(db, f.id, today) })).filter((x) => x.k);
  return h('div', { class: 'stack' },
    pageHead(t('nav.journal'), t('spray.adminText'),
      h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': t('common.year'), onchange: (e) => { year = Number(e.target.value); ctx.redraw(); } }, years.map((y) => h('option', { value: y, selected: y === year }, String(y)))),
      h('button', { class: 'btn light', onclick: () => exportCsv(list) }, icon('download', 18), 'CSV'),
      h('button', { class: 'btn light', onclick: () => printJournal(list, year) }, icon('printer', 18), t('common.print')),
      h('button', { class: 'btn primary', 'data-act': 'new-spray', onclick: () => { editing = 'new'; ctx.redraw(); } }, icon('plus', 18), t('spray.new'))),
    karens.length ? h('div', { class: 'notice warn' }, icon('hourglass'), h('p', {}, h('strong', {}, t('spray.activeKarens'), ': '), karens.map(({ f, k }) => `${f.name} (${t('spray.karensUntil', { date: fmtDate(k.allowedFrom) })})`).join(' · '))) : null,
    tasksCard(db, ctx),
    h('div', { class: 'card' }, h('h3', {}, t('spray.journalYear', { year })),
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-journal': '' },
        h('thead', {}, h('tr', {}, ...[t('common.date'), t('spray.field'), t('spray.products'), t('spray.target'), t('spray.weather'), t('spray.operator'), t('spray.phiShort'), ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.map((s) => h('tr', {},
          h('td', {}, fmtDate(s.date), h('div', { class: 'small muted' }, [s.startTime, s.endTime].filter(Boolean).join('–'))),
          h('td', {}, h('strong', {}, s.fieldName || '–'), h('div', { class: 'small muted' }, `${cropName(s.crop)} · ${fmtNum(s.areaDaa, 1)} ${t('unit.daa')}`)),
          h('td', {}, (s.products || []).map((p) => h('div', {}, `${p.name} – ${fmtNum(p.dose, 3)} ${p.unit}`))),
          h('td', {}, s.target || '–'),
          h('td', { class: 'small' }, wxText(s.weather), s.weather && !s.weather.confirmed ? h('span', { class: 'tag warn' }, t('spray.unconfirmed')) : null),
          h('td', {}, s.operator || '–'),
          h('td', {}, `${D.sprayPhiDays(s, db.products)} ${t('unit.days')}`, h('div', { class: 'small muted' }, fmtDate(D.harvestAllowedFrom(s, db.products)))),
          h('td', { class: 'num' }, h('div', { class: 'row end' },
            h('button', { class: 'icon-btn', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => { editing = s; ctx.redraw(); } }, icon('edit', 18)),
            h('button', { class: 'icon-btn', title: t('common.delete'), 'aria-label': t('common.delete'), onclick: async () => {
              if (!(await confirmDialog(t('spray.deleteTitle'), t('spray.deleteText'), t('common.delete')))) return;
              deleteSpray(s.id, actor()); toast(t('common.deleted')); ctx.redraw();
            } }, icon('trash', 18)))))))))
        : empty('tractor', t('spray.none'))),
    h('p', { class: 'small muted' }, t('spray.legalNote')));
}

function formPage(ctx) {
  const host = h('div', { class: 'stack', 'data-form': 'spray' });
  const s = editing === 'new' ? null : editing;
  sprayForm(host, { spray: s, by: actor(), admin: true, onDone: (saved) => { editing = null; if (saved) toast(t('common.saved')); ctx.redraw(); } });
  return h('div', { class: 'stack' }, pageHead(s ? t('spray.editTitle') : t('spray.newTitle'), null), host);
}

export const wxText = (w) => (w ? [w.temp != null ? `${fmtNum(w.temp, 1)} °C` : null, w.wind != null ? `${fmtNum(w.wind, 1)} m/s${w.windDir != null ? ' ' + compass(w.windDir) : ''}` : null, w.gust != null ? `${t('spray.gustShort')} ${fmtNum(w.gust, 1)}` : null, w.humidity != null ? `${fmtNum(w.humidity, 0)} %` : null].filter(Boolean).join(', ') : '–');

function tasksCard(db, ctx) {
  const open = db.tasks.filter((x) => x.type === 'spray' && x.status !== 'done').sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || ''));
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const people = new Map(db.people.map((p) => [p.id, p]));
  return h('div', { class: 'card stack' },
    h('div', { class: 'card-head' }, h('h3', {}, icon('clipboard', 20), ' ', t('spray.tasks')), h('button', { class: 'btn small light', 'data-act': 'new-task', onclick: () => editTask(null, ctx) }, icon('plus', 16), t('spray.newTask'))),
    open.length ? h('div', { class: 'list' }, open.map((x) => h('div', { class: 'list-item', 'data-task': x.id },
      h('span', { class: 'dot', style: { background: fields.get(x.fieldId)?.color || '#999' } }),
      h('div', { class: 'grow' }, h('strong', {}, fields.get(x.fieldId)?.name || '–', ' · ', x.plannedDate ? fmtDate(x.plannedDate) : '–'),
        h('div', { class: 'small muted' }, people.get(x.assigneeId)?.name || t('spray.anySprayer'), x.productIds?.length ? ' · ' + x.productIds.map((id) => db.products.find((p) => p.id === id)?.name).filter(Boolean).join(', ') : '', x.note ? ` · ${x.note}` : '')),
      h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), title: t('common.edit'), onclick: () => editTask(x, ctx) }, icon('edit', 18))))) : h('p', { class: 'muted' }, t('spray.noTasks')));
}

async function editTask(x, ctx) {
  const db = dbAll();
  const cur = x || { type: 'spray', fieldId: '', plannedDate: D.addDays(D.todayKey(), 1), assigneeId: '', productIds: [], note: '', status: 'open' };
  const fieldSel = select([['', '–'], ...db.fields.filter((f) => f.active !== false).map((f) => [f.id, f.name])], cur.fieldId, { name: 'field' });
  const date = input({ type: 'date', value: cur.plannedDate, name: 'date' });
  const who = select([['', t('spray.anySprayer')], ...db.people.filter((p) => (p.roles || []).includes('sprayer') && p.active !== false).map((p) => [p.id, p.name])], cur.assigneeId, { name: 'who' });
  const boxes = db.products.filter((p) => p.active !== false).map((p) => { const cb = h('input', { type: 'checkbox', checked: cur.productIds?.includes(p.id), value: p.id }); return [cb, h('label', { class: 'check' }, cb, p.name)]; });
  const note = input({ value: cur.note || '', name: 'note', maxlength: 200 });
  const target = input({ value: cur.target || '', name: 'target', maxlength: 100 });
  const r = await modal(x ? t('spray.editTask') : t('spray.newTask'), h('div', { class: 'form-grid' },
    field(t('spray.field'), fieldSel), field(t('spray.planned'), date), field(t('spray.assignee'), who), field(t('spray.target'), target),
    h('div', { class: 'field full' }, h('span', { class: 'field-label' }, t('spray.products')), h('div', { class: 'stack tight' }, boxes.length ? boxes.map((b) => b[1]) : h('p', { class: 'muted small' }, t('spray.noProducts')))),
    h('div', { class: 'full' }, field(t('spray.notes'), note))),
  [
    x ? { label: t('spray.cancelTask'), class: 'danger-light', value: 'delete' } : null,
    { label: t('common.cancel'), class: 'ghost', value: null },
    { label: t('common.save'), class: 'primary', submit: true, onClick: () => (fieldSel.value ? { fieldId: fieldSel.value, plannedDate: date.value, assigneeId: who.value || null, productIds: boxes.filter((b) => b[0].checked).map((b) => b[0].value), note: note.value.trim(), target: target.value.trim() } : (fieldSel.focus(), false)) },
  ].filter(Boolean), { wide: true });
  if (!r) return;
  if (r === 'delete') store.remove('tasks', x.id, actor());
  else store.put('tasks', { ...cur, ...r }, actor());
  toast(t('common.saved'));
  ctx.redraw();
}

export function journalRows(list) {
  return list.flatMap((s) => (s.products?.length ? s.products : [{}]).map((p) => ({
    [t('common.date')]: s.date, [t('spray.start')]: s.startTime || '', [t('spray.end')]: s.endTime || '', [t('spray.field')]: s.fieldName || '', [t('fields.crop')]: cropName(s.crop), [t('fields.areaDaa')]: s.areaDaa ?? '',
    [t('spray.product')]: p.name || '', [t('products.regNo')]: p.regNo || '', [t('spray.dose')]: p.dose ?? '', [t('spray.unit')]: p.unit || '', [t('spray.totalCol')]: p.dose ? D.totalAmount(p.dose, p.unit, s.areaDaa).qty + ' ' + D.totalAmount(p.dose, p.unit, s.areaDaa).unit : '',
    [t('spray.target')]: s.target || '', [t('spray.phiShort')]: p.phiDays ?? '', [t('spray.harvestFrom')]: D.harvestAllowedFrom(s, store.all('products')),
    [t('spray.temp')]: s.weather?.temp ?? '', [t('spray.wind')]: s.weather?.wind ?? '', [t('spray.windDir')]: s.weather?.windDir != null ? compass(s.weather.windDir) : '', [t('spray.humidity')]: s.weather?.humidity ?? '',
    [t('spray.wxSource')]: s.weather ? (s.weather.forecast ? `${t('spray.forecast')} (MET)` : t('spray.manual')) + (s.weather.confirmed ? ` – ${t('spray.confirmed')}` : '') : '',
    [t('spray.water')]: s.waterLPerDaa ?? '', [t('spray.equipment')]: s.equipment || '', [t('spray.operator')]: s.operator || '', [t('people.certNo')]: s.certNo || '', [t('spray.notes')]: s.notes || '',
  })));
}
function exportCsv(list) {
  download(`sprøytejournal-${year}.csv`, toCsv(journalRows(list)), 'text/csv');
}
function printJournal(list, y) {
  const st = store.settings();
  const rows = journalRows(list.slice().reverse());
  const cols = [t('common.date'), t('spray.field'), t('spray.product'), t('products.regNo'), t('spray.dose'), t('spray.unit'), t('spray.totalCol'), t('spray.target'), t('spray.temp'), t('spray.wind'), t('spray.operator'), t('spray.harvestFrom')];
  printNodes([h('div', { class: 'print-doc' },
    h('h1', {}, t('spray.printTitle', { year: y })), h('p', {}, st.farmName || '', st.orgNo ? ` · ${t('settings.orgNo')} ${st.orgNo}` : ''),
    h('table', { class: 'print-table' }, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))), h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', {}, String(r[c] ?? ''))))))),
    h('p', { class: 'small' }, t('spray.wxCredit'), ' ', CREDIT))], t('spray.printTitle', { year: y }));
}
