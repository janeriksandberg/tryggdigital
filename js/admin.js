// Administrator: oversikt, plukkere og QR-koder, registreringer, lønn, ytelse, jorder, innstillinger
import { t } from './i18n.js';
import { h, modal, confirmDialog, infoDialog, toast, qrSvg, fmtKr, fmtNum, fmtTime, fmtDay, fmtDuration, toLocalInput, download, toCsv } from './ui.js';
import { scan } from './scanner.js';
import { renderFieldsAdmin } from './map.js';
import { seedDemo } from './demo.js';
import * as S from './store.js';

const TABS = [
  { id: 'overview', icon: '◉', key: 'admin.overview' },
  { id: 'workers', icon: '👥', key: 'admin.workers' },
  { id: 'records', icon: '✎', key: 'admin.records' },
  { id: 'pay', icon: 'kr', key: 'admin.pay' },
  { id: 'performance', icon: '📈', key: 'admin.performance' },
  { id: 'fields', icon: '🗺', key: 'admin.fields' },
  { id: 'settings', icon: '⚙', key: 'admin.settings' },
];

export function renderAdmin(tab) {
  tab = TABS.some((x) => x.id === tab) ? tab : 'overview';
  const nav = h('nav', { class: 'admin-nav' }, TABS.map((x) =>
    h('a', { href: `#/admin/${x.id}`, class: x.id === tab ? 'on' : '' }, h('span', { class: 'nav-icon' }, x.icon), h('span', { class: 'nav-label' }, t(x.key)))));
  const content = h('section', { class: `admin-content tab-${tab}` });
  const views = { overview, workers, records, pay, performance, fields: () => renderFieldsAdmin(), settings };
  const draw = () => content.replaceChildren(h('h1', { class: 'page-title' }, t(TABS.find((x) => x.id === tab).key)), views[tab](draw));
  draw();
  return h('main', { class: 'admin' }, nav, content);
}

// ---------- Periode-velger ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function presets() {
  const now = new Date();
  const today = keyOf(now);
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const lm0 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lm1 = new Date(now.getFullYear(), now.getMonth(), 0);
  const y0 = new Date(now.getFullYear(), 0, 1);
  return [
    { key: 'period.today', from: today, to: today },
    { key: 'period.week', from: keyOf(monday), to: today },
    { key: 'period.month', from: keyOf(m0), to: today },
    { key: 'period.lastMonth', from: keyOf(lm0), to: keyOf(lm1) },
    { key: 'period.year', from: keyOf(y0), to: today },
  ];
}
let period = null;
function periodPicker(onChange) {
  period ??= presets()[2];
  const from = h('input', { type: 'date', class: 'input', value: period.from, onchange: () => { period = { from: from.value, to: to.value }; onChange(); } });
  const to = h('input', { type: 'date', class: 'input', value: period.to, onchange: () => { period = { from: from.value, to: to.value }; onChange(); } });
  return h('div', { class: 'period' },
    h('div', { class: 'chips' }, presets().map((p) => h('button', {
      class: `chip ${p.from === period.from && p.to === period.to ? 'on' : ''}`,
      onclick: () => { period = p; onChange(); },
    }, t(p.key)))),
    h('div', { class: 'period-dates' }, h('label', {}, t('period.from'), from), h('label', {}, t('period.to'), to)));
}

// ---------- Oversikt ----------
function kpi(label, value, sub, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), sub ? h('span', { class: 'kpi-sub' }, sub) : null);
}
function overview() {
  const today = S.todayKey();
  const rows = S.payReport(today, today);
  const active = S.db().shifts.filter((s) => !s.end);
  const crates = rows.reduce((a, r) => a + r.crates, 0);
  const hours = rows.reduce((a, r) => a + r.hours, 0);
  const pay = rows.reduce((a, r) => a + r.pay, 0);
  const st = S.db().settings;
  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi(t('ov.activeNow'), String(active.length), t('ov.ofWorkers', { n: S.db().workers.length }), 'green'),
      kpi(t('ov.cratesToday'), String(crates), crates && hours ? `${fmtNum(crates / hours, 1)} ${t('unit.cratesPerHour')}` : '', 'berry'),
      kpi(t('ov.hoursToday'), fmtNum(hours, 1), t('unit.hours')),
      kpi(t('ov.payToday'), fmtKr(pay), `${fmtKr(st.hourRate)}/${t('unit.h')} · ${fmtKr(st.crateRate)}/${t('unit.crate')}`)),
    h('div', { class: 'card' },
      h('h3', {}, t('ov.today')),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('col.name')), h('th', {}, t('col.status')), h('th', { class: 'num' }, t('col.crates')), h('th', { class: 'num hide-sm' }, t('col.hours')), h('th', { class: 'num' }, t('col.pay')))),
        h('tbody', {}, rows.map((r) => {
          const open = S.openShift(r.worker.id);
          return h('tr', {},
            h('td', {}, h('strong', {}, r.worker.name)),
            h('td', {}, open ? h('span', { class: 'pill green' }, '● ', t('ov.in'), ' ', fmtTime(open.start)) : h('span', { class: 'pill' }, t('ov.out'))),
            h('td', { class: 'num' }, String(r.crates)),
            h('td', { class: 'num hide-sm' }, fmtNum(r.hours, 1)),
            h('td', { class: 'num' }, fmtKr(r.pay)));
        }))))
        : h('div', { class: 'empty' }, h('span', {}, '🌤️'), h('p', {}, t('ov.noActivity')))),
    S.db().workers.length ? null : h('div', { class: 'card callout' },
      h('h3', {}, t('ov.getStarted')),
      h('ol', {}, h('li', {}, t('ov.step1')), h('li', {}, t('ov.step2')), h('li', {}, t('ov.step3')), h('li', {}, t('ov.step4'))),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: '#/admin/workers' }, t('ov.addWorkers')),
        h('a', { class: 'btn light', href: '#/admin/settings' }, t('ov.setRates')))));
}

// ---------- Plukkere ----------
async function workerDialog(w) {
  const name = h('input', { class: 'input', value: w?.name || '', required: true, placeholder: t('workers.namePh') });
  const code = h('input', { class: 'input mono', value: w?.code || S.newWorkerCode(), required: true });
  const scanBtn = h('button', { type: 'button', class: 'btn light', onclick: async () => { const c = await scan({ title: t('workers.scanExisting'), hint: t('workers.scanExistingHint') }); if (c) code.value = c; } }, '📷 ', t('workers.scanExisting'));
  return modal(w ? t('workers.edit') : t('workers.add'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, t('workers.name')), name),
      h('label', { class: 'field' }, h('span', {}, t('workers.code')), code, h('small', { class: 'muted' }, t('workers.codeHelp'))),
      scanBtn),
    [
      { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
        const n = name.value.trim(), c = code.value.trim();
        if (!n) { name.focus(); return false; }
        if (!c) { code.focus(); return false; }
        const clash = S.workerByCode(c);
        if (clash && clash.id !== w?.id) { toast(t('workers.codeTaken', { name: clash.name }), 'error'); return false; }
        return { name: n, code: c };
      } },
    ]);
}

function printCards(list) {
  const win = h('div', { class: 'print-area' },
    h('div', { class: 'qr-sheet' }, list.map((w) => h('div', { class: 'qr-card' },
      h('div', { class: 'qr-brand' }, '🍓 Tryggdigital'),
      h('div', { class: 'qr-img', html: qrSvg(w.code, 200) }),
      h('strong', {}, w.name),
      h('span', { class: 'mono' }, w.code)))));
  document.body.appendChild(win);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); win.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 100);
}

function workers(redraw) {
  const list = S.db().workers.slice().sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const add = async () => {
    const r = await workerDialog(null);
    if (!r) return;
    S.addWorker(r.name, r.code);
    toast(t('workers.added', { name: r.name }));
    redraw();
  };
  const quickAdd = h('form', { class: 'quick-add', onsubmit: (e) => {
    e.preventDefault();
    const n = input.value.trim();
    if (!n) return;
    S.addWorker(n);
    toast(t('workers.added', { name: n }));
    redraw();
  } });
  const input = h('input', { class: 'input big', placeholder: t('workers.quickPh') });
  quickAdd.append(input, h('button', { class: 'btn primary', type: 'submit' }, '＋ ', t('workers.addShort')));

  const bulk = async () => {
    const ta = h('textarea', { class: 'input', rows: 8, placeholder: 'Anna Nowak\nJonas Petrauskas\n…' });
    const r = await modal(t('workers.bulk'), h('div', { class: 'form-grid' }, h('p', { class: 'muted' }, t('workers.bulkHelp')), ta), [
      { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('workers.addShort'), class: 'primary', submit: true, onClick: () => ta.value },
    ]);
    if (!r) return;
    const names = r.split('\n').map((x) => x.trim()).filter(Boolean);
    names.forEach((n) => S.addWorker(n));
    toast(t('workers.addedMany', { n: names.length }));
    redraw();
  };

  const scanLink = async () => {
    const c = await scan({ title: t('workers.linkTitle'), hint: t('workers.scanExistingHint') });
    if (!c) return;
    const existing = S.workerByCode(c);
    if (existing) { toast(t('workers.codeTaken', { name: existing.name }), 'error'); return; }
    const name = h('input', { class: 'input big', required: true, placeholder: t('workers.namePh') });
    const r = await modal(t('workers.linkTitle'), h('div', { class: 'form-grid' }, h('p', {}, t('workers.code'), ': ', h('strong', { class: 'mono' }, c)), h('label', { class: 'field' }, h('span', {}, t('workers.name')), name)), [
      { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('common.save'), class: 'primary', submit: true, onClick: () => name.value.trim() || false },
    ]);
    if (!r) return;
    S.addWorker(r, c);
    toast(t('workers.added', { name: r }));
    redraw();
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('h3', {}, t('workers.addTitle')),
      quickAdd,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn light', onclick: scanLink }, '📷 ', t('workers.linkScan')),
        h('button', { class: 'btn light', onclick: bulk }, '☰ ', t('workers.bulk')),
        h('button', { class: 'btn light', onclick: add }, '⚙ ', t('workers.advanced')),
        list.length ? h('button', { class: 'btn light', onclick: () => printCards(list.filter((w) => w.active !== false)) }, '🖨 ', t('workers.printAll')) : null)),
    list.length
      ? h('div', { class: 'worker-grid' }, list.map((w) => {
        const open = S.openShift(w.id);
        return h('div', { class: `worker-card ${w.active === false ? 'inactive' : ''}` },
          h('div', { class: 'qr-thumb', html: qrSvg(w.code, 84) }),
          h('div', { class: 'w-info' },
            h('strong', {}, w.name),
            h('span', { class: 'mono muted' }, w.code),
            open ? h('span', { class: 'pill green' }, '● ', t('ov.in'), ' ', fmtTime(open.start)) : null,
            w.active === false ? h('span', { class: 'pill' }, t('workers.inactive')) : null),
          h('div', { class: 'w-actions' },
            h('button', { class: 'icon-btn', title: t('workers.print'), onclick: () => printCards([w]) }, '🖨'),
            h('button', { class: 'icon-btn', title: t('common.edit'), onclick: async () => {
              const r = await workerDialog(w);
              if (!r) return;
              S.updateWorker(w.id, r); toast(t('common.saved')); redraw();
            } }, '✎'),
            h('button', { class: 'icon-btn', title: w.active === false ? t('workers.activate') : t('workers.deactivate'), onclick: () => { S.updateWorker(w.id, { active: w.active === false }); redraw(); } }, w.active === false ? '↺' : '⏸'),
            h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: async () => {
              if (!(await confirmDialog(t('workers.deleteTitle'), t('workers.deleteText', { name: w.name }), t('common.delete')))) return;
              S.deleteWorker(w.id); toast(t('common.deleted')); redraw();
            } }, '🗑')));
      }))
      : h('div', { class: 'card empty' }, h('span', {}, '👥'), h('p', {}, t('workers.empty'))));
}

// ---------- Registreringer ----------
let recDay = null;
function records(redraw) {
  recDay ??= S.todayKey();
  const dayInput = h('input', { type: 'date', class: 'input', value: recDay, onchange: () => { recDay = dayInput.value || S.todayKey(); redraw(); } });
  const shiftDay = (delta) => { const d = new Date(recDay + 'T12:00'); d.setDate(d.getDate() + delta); recDay = keyOf(d); redraw(); };
  const stats = S.dailyStats(recDay, recDay);
  const dayOf = (w) => stats[w.id]?.[recDay];
  const active = S.db().workers.filter((w) => dayOf(w));
  const others = S.db().workers.filter((w) => !dayOf(w));

  const workerBlock = (w) => {
    const shifts = S.db().shifts.filter((s) => s.workerId === w.id && S.dayKey(s.start) === recDay).sort((a, b) => a.start.localeCompare(b.start));
    const crates = S.db().crates.filter((c) => c.workerId === w.id && S.dayKey(c.ts) === recDay).sort((a, b) => a.ts.localeCompare(b.ts));
    const d = dayOf(w) || { hours: 0, crates: 0 };
    const p = S.dayPay(d.hours, d.crates);
    return h('div', { class: 'card rec-card' },
      h('div', { class: 'rec-head' },
        h('div', {}, h('h3', {}, w.name), h('span', { class: 'muted mono' }, w.code)),
        h('div', { class: 'rec-sum' },
          h('span', {}, h('strong', {}, String(d.crates)), ' ', t('unit.crates')),
          h('span', {}, h('strong', {}, fmtNum(d.hours, 2)), ' ', t('unit.h')),
          h('span', { class: 'pill ' + (p.basis === 'crate' ? 'berry' : 'slate') }, fmtKr(p.pay), ' · ', p.basis === 'crate' ? t('pay.byCrate') : t('pay.byHour')))),
      h('div', { class: 'rec-cols' },
        h('div', {},
          h('h4', {}, '⏱ ', t('rec.shifts')),
          shifts.map((s) => h('div', { class: 'rec-row' },
            h('span', {}, fmtTime(s.start), ' – ', s.end ? fmtTime(s.end) : h('em', { class: 'pill green' }, t('ov.in'))),
            h('span', { class: 'muted' }, fmtDuration(S.shiftHours(s))),
            h('span', { class: 'row-actions' },
              h('button', { class: 'icon-btn', title: t('common.edit'), onclick: () => editShift(s) }, '✎'),
              h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: async () => {
                if (await confirmDialog(t('rec.deleteShift'), t('rec.deleteShiftText'), t('common.delete'))) { S.deleteShift(s.id); toast(t('common.deleted')); redraw(); }
              } }, '🗑')))),
          h('button', { class: 'btn small light', onclick: () => editShift({ workerId: w.id, start: recDay + 'T07:00', end: recDay + 'T15:00', isNew: true }) }, '＋ ', t('rec.addShift'))),
        h('div', {},
          h('h4', {}, '🍓 ', t('rec.crates')),
          h('div', { class: 'crate-adjust' },
            h('button', { class: 'step-btn small', onclick: () => {
              const last = crates[crates.length - 1];
              if (!last) return;
              if (last.count > 1) S.updateCrate(last.id, { count: last.count - 1 }); else S.deleteCrate(last.id);
              toast(t('rec.crateRemoved')); redraw();
            }, disabled: !crates.length, 'aria-label': '-1' }, '−'),
            h('strong', { class: 'crate-total' }, String(d.crates)),
            h('button', { class: 'step-btn small', onclick: () => {
              const at = recDay === S.todayKey() ? new Date() : new Date(recDay + 'T12:00');
              S.addCrates(w.id, 1, at); toast(t('rec.crateAdded')); redraw();
            }, 'aria-label': '+1' }, '+')),
          h('details', { class: 'crate-log' },
            h('summary', {}, t('rec.crateLog', { n: crates.length })),
            crates.map((c) => h('div', { class: 'rec-row' },
              h('span', {}, fmtTime(c.ts)),
              h('span', {}, `${c.count} ${t('unit.crates')}`),
              h('span', { class: 'row-actions' },
                h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: () => { S.deleteCrate(c.id); toast(t('rec.crateRemoved')); redraw(); } }, '🗑'))))))));
  };

  const editShift = async (s) => {
    const start = h('input', { type: 'datetime-local', class: 'input', value: s.isNew ? s.start : toLocalInput(s.start), required: true });
    const end = h('input', { type: 'datetime-local', class: 'input', value: s.isNew ? s.end : s.end ? toLocalInput(s.end) : '' });
    const r = await modal(s.isNew ? t('rec.addShift') : t('rec.editShift'), h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, t('rec.start')), start),
      h('label', { class: 'field' }, h('span', {}, t('rec.end')), end, h('small', { class: 'muted' }, t('rec.endHelp')))), [
      { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
        if (!start.value) return false;
        if (end.value && end.value <= start.value) { toast(t('rec.endBeforeStart'), 'error'); return false; }
        return { start: new Date(start.value).toISOString(), end: end.value ? new Date(end.value).toISOString() : null };
      } },
    ]);
    if (!r) return;
    if (s.isNew) { S.db().shifts.push({ id: S.uid(), workerId: s.workerId, ...r }); S.save(); }
    else S.updateShift(s.id, r);
    toast(t('common.saved'));
    redraw();
  };

  const addFor = h('select', { class: 'input', onchange: () => {
    if (!addFor.value) return;
    editShift({ workerId: addFor.value, start: recDay + 'T07:00', end: recDay + 'T15:00', isNew: true });
  } }, h('option', { value: '' }, t('rec.addFor')), others.map((w) => h('option', { value: w.id }, w.name)));

  return h('div', { class: 'stack' },
    h('div', { class: 'card day-bar' },
      h('button', { class: 'btn light', onclick: () => shiftDay(-1), 'aria-label': t('rec.prev') }, '‹'),
      h('div', { class: 'day-mid' }, h('strong', {}, fmtDay(recDay)), dayInput),
      h('button', { class: 'btn light', onclick: () => shiftDay(1), 'aria-label': t('rec.next') }, '›')),
    active.length ? active.map(workerBlock) : h('div', { class: 'card empty' }, h('span', {}, '📭'), h('p', {}, t('rec.none'))),
    others.length ? h('div', { class: 'card' }, h('h3', {}, t('rec.addOther')), addFor) : null);
}

// ---------- Lønn ----------
function pay(redraw) {
  const rows = S.payReport(period?.from || presets()[2].from, period?.to || presets()[2].to);
  const p = period || presets()[2];
  const st = S.db().settings;
  const tot = rows.reduce((a, r) => ({ crates: a.crates + r.crates, hours: a.hours + r.hours, pay: a.pay + r.pay }), { crates: 0, hours: 0, pay: 0 });

  const csv = () => {
    const data = [[t('col.code'), t('col.name'), t('col.days'), t('col.crates'), t('col.hours'), t('pay.byHourSum'), t('pay.byCrateSum'), t('col.pay')]];
    rows.forEach((r) => data.push([r.worker.code, r.worker.name, r.days, r.crates, r.hours.toFixed(2).replace('.', ','), Math.round(r.byHour), Math.round(r.byCrate), Math.round(r.pay)]));
    data.push(['', t('pay.total'), '', tot.crates, tot.hours.toFixed(2).replace('.', ','), '', '', Math.round(tot.pay)]);
    download(`lonn_${p.from}_${p.to}.csv`, toCsv(data), 'text/csv;charset=utf-8');
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, periodPicker(redraw),
      h('p', { class: 'muted small' }, t('pay.rule', { hour: fmtKr(st.hourRate), crate: fmtKr(st.crateRate) }))),
    h('div', { class: 'kpis' },
      kpi(t('col.crates'), String(tot.crates), '', 'berry'),
      kpi(t('col.hours'), fmtNum(tot.hours, 1)),
      kpi(t('pay.total'), fmtKr(tot.pay), '', 'green')),
    h('div', { class: 'card printable' },
      h('div', { class: 'card-head' },
        h('h3', {}, t('pay.list'), ' ', h('span', { class: 'muted' }, `${fmtDay(p.from)} – ${fmtDay(p.to)}`)),
        h('div', { class: 'row wrap no-print' },
          h('button', { class: 'btn light', onclick: csv, disabled: !rows.length }, '⬇ CSV'),
          h('button', { class: 'btn light', onclick: () => window.print(), disabled: !rows.length }, '🖨 ', t('common.print')),
          h('button', { class: 'btn tripletex', onclick: () => infoDialog(t('pay.tripletexBtn'), t('pay.tripletexMsg')) }, '⇪ ', t('pay.tripletexBtn')))),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table pay-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'QR'), h('th', {}, t('col.name')), h('th', { class: 'num' }, t('col.days')), h('th', { class: 'num' }, t('col.crates')), h('th', { class: 'num' }, t('col.hours')),
          h('th', { class: 'num hide-sm' }, t('pay.byHourSum')), h('th', { class: 'num hide-sm' }, t('pay.byCrateSum')), h('th', { class: 'num' }, t('col.pay')))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, h('div', { class: 'qr-mini', html: qrSvg(r.worker.code, 44) })),
          h('td', {}, h('strong', {}, r.worker.name), h('br'), h('span', { class: 'mono muted small' }, r.worker.code), r.open ? h('span', { class: 'pill green tiny' }, t('ov.in')) : null),
          h('td', { class: 'num' }, String(r.days)),
          h('td', { class: 'num' }, String(r.crates)),
          h('td', { class: 'num' }, fmtNum(r.hours, 1)),
          h('td', { class: 'num hide-sm' }, fmtKr(r.byHour)),
          h('td', { class: 'num hide-sm' }, fmtKr(r.byCrate)),
          h('td', { class: 'num' }, h('strong', {}, fmtKr(r.pay)), h('br'), h('span', { class: 'muted small' }, t('pay.crateDays', { n: r.crateDays, d: r.days })))))),
        h('tfoot', {}, h('tr', {},
          h('td', {}), h('td', {}, h('strong', {}, t('pay.total'))), h('td', {}), h('td', { class: 'num' }, h('strong', {}, String(tot.crates))), h('td', { class: 'num' }, h('strong', {}, fmtNum(tot.hours, 1))),
          h('td', { class: 'hide-sm' }), h('td', { class: 'hide-sm' }), h('td', { class: 'num' }, h('strong', {}, fmtKr(tot.pay)))))))
        : h('div', { class: 'empty' }, h('span', {}, '📄'), h('p', {}, t('pay.none')))));
}

// ---------- Ytelse ----------
function barChart(series, valueFmt = (v) => String(v)) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return h('div', { class: 'bars' }, series.map((s) => h('div', { class: 'bar-col', title: `${s.label}: ${valueFmt(s.value)}` },
    h('span', { class: 'bar-val' }, valueFmt(s.value)),
    h('div', { class: 'bar', style: { height: `${(s.value / max) * 100}%` } }),
    h('span', { class: 'bar-label' }, s.short || s.label))));
}
function performance(redraw) {
  const p = period || presets()[2];
  const rows = S.payReport(p.from, p.to);
  const byDay = {};
  for (const r of rows) for (const [k, d] of Object.entries(r.daily)) byDay[k] = (byDay[k] || 0) + d.crates;
  const days = Object.keys(byDay).sort();
  const ranked = rows.map((r) => ({ ...r, rate: r.hours ? r.crates / r.hours : 0, perDay: r.days ? r.crates / r.days : 0 })).sort((a, b) => b.rate - a.rate);
  const tot = rows.reduce((a, r) => ({ c: a.c + r.crates, h: a.h + r.hours, p: a.p + r.pay }), { c: 0, h: 0, p: 0 });
  const maxRate = Math.max(0.01, ...ranked.map((r) => r.rate));

  const csv = () => {
    const data = [[t('col.code'), t('col.name'), t('col.days'), t('col.crates'), t('col.hours'), t('perf.rate'), t('perf.perDay'), t('perf.costPerCrate')]];
    ranked.forEach((r) => data.push([r.worker.code, r.worker.name, r.days, r.crates, r.hours.toFixed(2).replace('.', ','), r.rate.toFixed(2).replace('.', ','), r.perDay.toFixed(1).replace('.', ','), r.crates ? Math.round(r.pay / r.crates) : '']));
    download(`ytelse_${p.from}_${p.to}.csv`, toCsv(data), 'text/csv;charset=utf-8');
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, periodPicker(redraw)),
    h('div', { class: 'kpis' },
      kpi(t('col.crates'), String(tot.c), '', 'berry'),
      kpi(t('perf.rate'), fmtNum(tot.h ? tot.c / tot.h : 0, 2), t('unit.cratesPerHour'), 'green'),
      kpi(t('perf.costPerCrate'), tot.c ? fmtKr(tot.p / tot.c) : '–'),
      kpi(t('perf.pickers'), String(rows.length))),
    h('div', { class: 'card printable' },
      h('div', { class: 'card-head' }, h('h3', {}, t('perf.perDayChart')),
        h('div', { class: 'row no-print' }, h('button', { class: 'btn light', onclick: csv, disabled: !rows.length }, '⬇ CSV'), h('button', { class: 'btn light', onclick: () => window.print(), disabled: !rows.length }, '🖨 ', t('common.print')))),
      days.length ? barChart(days.slice(-31).map((k) => ({ label: fmtDay(k), short: k.slice(8) + '.' + k.slice(5, 7), value: byDay[k] }))) : h('div', { class: 'empty' }, h('p', {}, t('pay.none'))),
      ranked.length ? h('div', { class: 'perf-list' },
        h('h3', {}, t('perf.ranking')),
        ranked.map((r, i) => h('div', { class: 'perf-row' },
          h('span', { class: 'rank' }, String(i + 1)),
          h('div', { class: 'perf-main' },
            h('div', { class: 'perf-top' }, h('strong', {}, r.worker.name), h('span', {}, `${fmtNum(r.rate, 2)} ${t('unit.cratesPerHour')}`)),
            h('div', { class: 'meter' }, h('div', { style: { width: `${(r.rate / maxRate) * 100}%` } })),
            h('div', { class: 'perf-sub muted small' }, `${r.crates} ${t('unit.crates')} · ${fmtNum(r.hours, 1)} ${t('unit.h')} · ${fmtNum(r.perDay, 1)} ${t('perf.perDayShort')} · ${r.crates ? fmtKr(r.pay / r.crates) : '–'}/${t('unit.crate')}`))))) : null));
}

// ---------- Innstillinger ----------
function settings(redraw) {
  const st = S.db().settings;
  const num = (k, step = 1) => h('input', { type: 'number', inputmode: 'decimal', min: 0, step, class: 'input big', value: st[k], onchange: (e) => { S.setSettings({ [k]: Number(e.target.value) || 0 }); toast(t('common.saved')); redraw(); } });
  const text = (k, ph, pattern) => h('input', { class: 'input', value: st[k] || '', placeholder: ph || '', pattern, onchange: (e) => { S.setSettings({ [k]: e.target.value.trim() }); toast(t('common.saved')); } });
  const example = S.dayPay(7.5, 40);
  const fileIn = h('input', { type: 'file', accept: 'application/json', hidden: '', onchange: async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.workers || !data.settings) throw new Error('format');
      if (!(await confirmDialog(t('set.importTitle'), t('set.importText'), t('set.import')))) return;
      S.replaceAll(data); toast(t('set.imported')); redraw();
    } catch { toast(t('set.importError'), 'error'); }
  } });
  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('h3', {}, t('set.rates')),
      h('div', { class: 'form-2' },
        h('label', { class: 'field' }, h('span', {}, t('set.hourRate')), h('div', { class: 'input-unit' }, num('hourRate'), h('em', {}, `kr/${t('unit.h')}`)), h('small', { class: 'muted' }, t('set.hourRateHelp'))),
        h('label', { class: 'field' }, h('span', {}, t('set.crateRate')), h('div', { class: 'input-unit' }, num('crateRate'), h('em', {}, `kr/${t('unit.crate')}`)), h('small', { class: 'muted' }, t('set.crateRateHelp')))),
      h('div', { class: 'example' }, '💡 ', t('set.example', { hours: '7,5', crates: 40, byHour: fmtKr(example.byHour), byCrate: fmtKr(example.byCrate), pay: fmtKr(example.pay) }))),
    h('div', { class: 'card' },
      h('h3', {}, t('set.farm')),
      h('div', { class: 'form-2' },
        h('label', { class: 'field' }, h('span', {}, t('set.farmName')), text('farmName')),
        h('label', { class: 'field' }, h('span', {}, t('set.orgOwner')), text('orgOwner', '123456789', '\\d{9}')),
        h('label', { class: 'field' }, h('span', {}, t('set.orgSprayer')), text('orgSprayer', '123456789', '\\d{9}')),
        h('label', { class: 'field' }, h('span', {}, t('set.operator')), text('operatorName')),
        h('label', { class: 'field' }, h('span', {}, t('set.authNo')), text('authNo')),
        h('label', { class: 'field' }, h('span', {}, t('set.equipment')), text('equipment'))),
      h('p', { class: 'muted small' }, t('set.farmHelp'))),
    h('div', { class: 'card' },
      h('h3', {}, t('set.data')),
      h('p', { class: 'muted' }, t('set.dataHelp')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn light', onclick: () => download(`tryggdigital_backup_${S.todayKey()}.json`, JSON.stringify(S.db(), null, 2), 'application/json') }, '⬇ ', t('set.export')),
        h('button', { class: 'btn light', onclick: () => fileIn.click() }, '⬆ ', t('set.import')), fileIn,
        h('button', { class: 'btn light', onclick: async () => {
          if (!(await confirmDialog(t('set.demoTitle'), t('set.demoText'), t('set.demo'), false))) return;
          seedDemo(); toast(t('set.demoDone')); redraw();
        } }, '🧪 ', t('set.demo')),
        h('button', { class: 'btn danger-light', onclick: async () => {
          if (!(await confirmDialog(t('set.resetTitle'), t('set.resetText'), t('set.reset')))) return;
          S.resetAll(); toast(t('set.resetDone')); redraw();
        } }, '⚠ ', t('set.reset')))));
}
