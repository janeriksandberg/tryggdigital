// Nettbrett-/mobilforside for en godkjent enhet. Alle vanlige brukere identifiseres med QR-kort.
// Store knapper, få valg, standardverdier fra jordet, lyd og vibrasjon: laget for hansker og dårlig dekning.
import { t, lang, setLang, resetToDeviceLang } from '../i18n.js';
import { h, icon, toast, bigResult, feedback, fmtTime, fmtDuration, fmtDate, fmtNum, fmtKr, modal, clear, versionTag } from '../ui.js';
import * as store from '../core/store.js';
import * as D from '../core/domain.js';
import { findPerson } from '../core/qrauth.js';
import { CARD_MASK } from '../core/codemask.js';
import { scan } from '../scanner.js';
import { S, isAdminHere } from '../session.js';
import { hasAccepted, askConsent } from './privacy.js';
import { go, topbar } from '../app.js';
import { cropName } from '../core/crops.js';
import { rankFields } from '../core/geo.js';

// Pågående arbeidsøkt for sprøyter/formann (bare i minnet; forsvinner ved omstart eller etter inaktivitet)
export const work = { person: null, role: null, until: 0 };
const WORK_IDLE = 15 * 60 * 1000;
export function touchWork() { if (work.person) work.until = Date.now() + WORK_IDLE; }
export function endWork() { work.person = null; work.role = null; work.until = 0; resetToDeviceLang(); }
export const workActive = (role) => work.person && work.role === role && Date.now() < work.until;
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, touchWork, { passive: true });

const dbView = () => ({
  settings: store.settings(), people: store.all('people'), fields: store.all('fields'), varieties: store.all('varieties'), crateTypes: store.all('crateTypes'),
  shifts: store.all('shifts'), crates: store.all('crates'), sprays: store.all('sprays'), products: store.all('products'), assignments: store.all('assignments'), alerts: store.all('alerts'),
});
export const openShift = (pid) => store.all('shifts').find((s) => s.personId === pid && !s.end);
const initials = (name) => name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
export const avatar = (p) => h('span', { class: 'avatar', style: { background: colorFor(p.id) } }, initials(p.name || '?'));
function colorFor(id) { const c = ['#157a52', '#1d4ed8', '#b45309', '#7c3aed', '#be185d', '#0e7490', '#4d7c0f']; let x = 0; for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return c[x % c.length]; }

let flowEl = null; // når en plukker er midt i en registrering

export function view() {
  return {
    topbar: () => topbar({ kind: 'kiosk', subtitle: S.tenantName || store.settings().farmName || '' }),
    render() {
      flowEl = null;
      return home();
    },
    onData() {
      if (flowEl) return; // ikke forstyrr en pågående registrering
      const strip = document.querySelector('[data-today]');
      if (strip) strip.replaceWith(todayStrip());
    },
    destroy() { flowEl = null; },
  };
}

function todayStrip() {
  const snap = D.foremanSnapshot(dbView());
  const today = D.todayKey();
  const blocked = store.all('fields').filter((f) => D.karensFor(dbView(), f.id, today));
  return h('div', { class: 'today-strip', 'data-today': '' },
    h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(snap.working.length)), h('div', { class: 'l' }, t('kiosk.atWork'))),
    h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtNum(snap.total, 0)), h('div', { class: 'l' }, t('kiosk.cratesToday'))),
    blocked.length ? h('div', { class: 'kpi', style: { borderColor: '#f3b9b9', background: 'var(--danger-soft)' } }, h('div', { class: 'v', style: { color: 'var(--danger)' } }, String(blocked.length)), h('div', { class: 'l' }, t('kiosk.karensFields'), ': ', blocked.map((f) => f.name).join(', '))) : null);
}

function home() {
  const tile = (cls, ic, title, desc, onclick, act) => h('button', { class: `tile ${cls}`, type: 'button', onclick, 'data-act': act }, h('span', { class: 'tile-ico' }, icon(ic, 28)), h('strong', {}, title), h('span', { class: 'd' }, desc));
  const noPeople = !store.all('people').length;
  return h('main', { class: 'kiosk-main' },
    h('div', { class: 'hero' }, h('h1', {}, t('kiosk.hello')), h('p', {}, t('kiosk.lead'))),
    noPeople ? h('div', { class: 'notice warn' }, icon('info'), h('p', {}, t('kiosk.noPeople'))) : null,
    h('button', { class: 'scan-hero', type: 'button', 'data-act': 'scan', onclick: () => identify('any') }, icon('scan', 56), h('span', {}, t('kiosk.scan'), h('small', {}, t('kiosk.scanSub')))),
    h('div', { class: 'tiles' },
      tile('start', 'play', t('picker.start'), t('picker.startHint'), () => identify('start'), 'start'),
      tile('crate', 'box', t('picker.crate'), t('picker.crateHint'), () => identify('crate'), 'crate'),
      tile('end', 'stop', t('picker.end'), t('picker.endHint'), () => identify('end'), 'end'),
      tile('spray', 'tractor', t('role.sprayer'), t('kiosk.sprayerText'), () => identify('sprayer'), 'sprayer'),
      tile('foreman', 'users', t('role.foreman'), t('kiosk.foremanText'), () => identify('foreman'), 'foreman'),
      tile('admin', 'shield', t('role.admin'), t('kiosk.adminText'), () => go(S.mode === 'demo' || isAdminHere() ? 'admin' : 'login'), 'admin')),
    todayStrip(),
    h('div', { class: 'foot-links' },
      h('a', { class: 'btn ghost small', href: '#/privacy' }, icon('shield', 16), t('pv.title')), versionTag()));
}

// ---------- Identifisering med QR ----------
export async function identify(context) {
  const titles = { start: t('picker.start'), end: t('picker.end'), crate: t('picker.crate'), sprayer: t('role.sprayer'), foreman: t('role.foreman'), any: t('kiosk.scan') };
  const raw = await scan({ title: titles[context], hint: t('scan.hintCard'), color: 'green', mask: CARD_MASK });
  if (!raw) return;
  const r = await findPerson(store.tenantId(), store.all('people'), raw);
  if (r.error) {
    const msg = { revoked: t('scan.revoked'), inactive: t('scan.inactive'), format: t('scan.badFormat'), unknown: t('scan.unknown') }[r.error];
    await bigResult({ type: 'error', title: t('scan.notAccepted'), lines: [msg], duration: 6000 });
    return;
  }
  const p = r.person;
  if (p.lang && p.lang !== lang()) await setLang(p.lang, { persist: false, silent: true });
  try {
    if (!hasAccepted(p.id)) {
      const ok = await askConsent({ subjectId: p.id, kind: 'person', name: p.name, code: p.lang || lang() });
      if (!ok) { await bigResult({ type: 'error', title: t('pv.declinedTitle'), lines: [t('pv.declinedText')], duration: 8000 }); return resetToDeviceLang(); }
    }
    const roles = p.roles || ['picker'];
    if (context === 'sprayer' || context === 'foreman') {
      if (!roles.includes(context)) { await bigResult({ type: 'error', title: t('scan.noRole'), lines: [t('scan.noRoleText', { role: t('role.' + context) })], duration: 6000 }); return resetToDeviceLang(); }
      return startWork(p, context);
    }
    if (context === 'any') {
      const others = roles.filter((x) => x !== 'picker');
      if (!roles.includes('picker')) return others.length === 1 ? startWork(p, others[0]) : chooseRole(p, others);
      if (others.length) { const pick = await chooseRole(p, roles, true); if (pick !== 'picker') return; }
      return openShift(p.id) ? crateFlow(p) : startDay(p);
    }
    if (!roles.includes('picker')) { await bigResult({ type: 'error', title: t('scan.noRole'), lines: [t('scan.noRoleText', { role: t('role.picker') })], duration: 6000 }); return resetToDeviceLang(); }
    if (context === 'start') return startDay(p);
    if (context === 'end') return endDay(p);
    if (context === 'crate') return crateFlow(p);
  } catch (e) {
    toast(e.message, 'error');
    resetToDeviceLang();
  }
}

async function chooseRole(p, roles, returnOnly = false) {
  const pick = await modal(t('kiosk.chooseRole', { name: p.name }), h('div', { class: 'stack' }, roles.map((r) =>
    h('button', { class: 'btn light xl block', type: 'button', 'data-role': r, onclick: () => { document.querySelector('.modal-wrap form')?.dispatchEvent(new CustomEvent('pick', { detail: r })); } }, icon({ picker: 'grape', sprayer: 'tractor', foreman: 'users' }[r]), t('role.' + r)))), [], {
    onOpen: ({ close, form }) => form.addEventListener('pick', (e) => close(e.detail)),
  });
  if (!pick) { resetToDeviceLang(); return null; }
  if (returnOnly && pick === 'picker') return pick;
  if (pick === 'picker') return openShift(p.id) ? crateFlow(p) : startDay(p);
  startWork(p, pick);
  return pick;
}

function startWork(p, role) {
  work.person = p; work.role = role; work.until = Date.now() + WORK_IDLE;
  go(`work/${role}`);
}

// ---------- Plukker ----------
async function startDay(p) {
  const open = openShift(p.id);
  if (open) {
    await bigResult({ type: 'success', title: t('picker.alreadyIn', { name: firstName(p) }), lines: [t('picker.since', { time: fmtTime(open.start) })], duration: 3500 });
    return crateFlow(p);
  }
  store.put('shifts', { personId: p.id, start: new Date().toISOString(), end: null }, p.id);
  const assigned = store.all('assignments').find((a) => a.personId === p.id && a.date === D.todayKey());
  const f = assigned && store.get('fields', assigned.fieldId);
  await bigResult({ type: 'success', title: t('picker.welcome', { name: firstName(p) }), lines: [t('picker.clockedIn'), f ? t('picker.assignedTo', { field: f.name }) : t('picker.goodLuck')], duration: 4500 });
  resetToDeviceLang();
}

async function endDay(p) {
  const open = openShift(p.id);
  if (!open) { await bigResult({ type: 'error', title: t('picker.notIn', { name: firstName(p) }), lines: [t('picker.notInHelp')], duration: 5000 }); return resetToDeviceLang(); }
  const end = new Date();
  const brk = D.endBreakPatch(open, end) || {};
  delete brk.lastBreakMin;
  store.patch('shifts', open.id, { ...brk, end: end.toISOString() }, p.id);
  const sum = D.personSummary(dbView(), p.id);
  await bigResult({
    type: 'success', title: t('picker.goodbye', { name: firstName(p) }),
    lines: [t('picker.shiftInfo', { from: fmtTime(open.start), to: fmtTime(end), dur: fmtDuration(D.shiftHours({ ...open, ...brk, end: end.toISOString() }, end, !!store.settings().paidBreaks)) }), t('picker.cratesTodayN', { n: sum.todayCrates })],
    duration: 6000,
  });
  resetToDeviceLang();
}

async function startBreak(p) {
  const open = openShift(p.id);
  if (open && !open.breakStart) store.patch('shifts', open.id, { breakStart: new Date().toISOString() }, p.id);
  await bigResult({ type: 'success', title: t('picker.breakStarted', { name: firstName(p) }), lines: [t('picker.breakHelp')], duration: 4500 });
  resetToDeviceLang();
}

const firstName = (p) => String(p.name || '').split(' ')[0];

/** Kasseregistrering: jorde, sort og kassetype er forhåndsvalgt fra jordet og kan endres med ett trykk. */
export async function crateFlow(p, { onDone } = {}) {
  // Kom tilbake fra pause: pausen avsluttes av seg selv når kortet skannes igjen
  const onBreak = openShift(p.id);
  if (onBreak?.breakStart) {
    const patch = D.endBreakPatch(onBreak);
    const min = patch.lastBreakMin; delete patch.lastBreakMin;
    store.patch('shifts', onBreak.id, patch, p.id);
    await bigResult({ type: 'success', title: t('picker.breakOver', { name: firstName(p) }), lines: [t('picker.breakLasted', { min })], duration: 3000 });
  }
  const db = dbView();
  const today = D.todayKey();
  const fields = db.fields.filter((f) => f.active !== false);
  if (!fields.length) { await bigResult({ type: 'error', title: t('crate.noFields'), lines: [t('crate.noFieldsText')], duration: 6000 }); return resetToDeviceLang(); }
  // Foretrukket jorde: tildelt i dag > siste levering i dag > nærmeste med GPS > første
  const assigned = db.assignments.find((a) => a.personId === p.id && a.date === today)?.fieldId;
  const lastToday = db.crates.filter((c) => c.personId === p.id && D.dayKey(c.ts) === today).sort((a, b) => (a.ts < b.ts ? 1 : -1))[0]?.fieldId;
  const st = { ...D.crateDefaults(db, assigned || lastToday || fields[0].id), count: 1, weightKg: '', quality: '' };
  st.quality = '';

  const main = h('main', { class: 'flow', 'data-flow': 'crate' });
  flowEl = main;
  const app = document.getElementById('app');
  const prev = [...app.childNodes];
  app.replaceChildren(app.querySelector('.topbar') || '', main);

  const finish = () => { flowEl = null; app.replaceChildren(...prev); resetToDeviceLang(); onDone?.(); window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const draw = () => {
    const open = openShift(p.id);
    const karens = st.fieldId ? D.karensFor(db, st.fieldId, today) : null;
    const blockMode = (db.settings.karensMode || 'block') === 'block';
    const ft = db.fields.find((f) => f.id === st.fieldId);
    const vs = db.varieties;
    const cts = db.crateTypes;
    const rate = D.crateRate(db, st);
    const chipRow = (items, key, label, sub) => h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, label),
      h('div', { class: 'pick-row' }, items.map((it) => h('button', { type: 'button', class: `chip ${st[key] === it.id ? 'on' : ''}`, 'data-pick': `${key}:${it.name}`, onclick: () => {
        st[key] = it.id;
        if (key === 'fieldId') Object.assign(st, D.crateDefaults(db, it.id), { count: st.count, weightKg: st.weightKg, quality: st.quality });
        feedback('tap'); draw();
      } }, it.color ? h('span', { class: 'dot', style: { background: it.color } }) : null, h('span', {}, it.name, sub ? h('small', {}, sub(it)) : null)))));
    clear(main, 
      h('div', { class: 'who' }, avatar(p), h('div', { class: 'grow' }, h('h1', {}, p.name), h('span', { class: 'muted' }, open ? t('picker.since', { time: fmtTime(open.start) }) : t('picker.crateNotIn')))),
      !open ? h('div', { class: 'notice warn' }, icon('alert'), h('p', {}, t('picker.crateNotIn')), h('button', { class: 'btn small warn', type: 'button', onclick: () => { store.put('shifts', { personId: p.id, start: new Date().toISOString(), end: null }, p.id); toast(t('picker.clockedIn')); finishAndReopen(); } }, t('picker.start'))) : null,
      chipRow(fields, 'fieldId', t('crate.field'), (f) => (D.karensFor(db, f.id, today) ? '⚠ ' + t('crate.karensShort') : f.id === assigned ? t('crate.assigned') : cropName(f.crop))),
      karens ? h('div', { class: 'karens-box', role: 'alert', 'data-karens': '' }, icon('alert', 32), h('div', {},
        h('strong', {}, t('karens.title')),
        h('p', {}, t('karens.text', { field: ft?.name || '', date: fmtDate(karens.sprayDate), products: karens.products.join(', ') || '–', allowed: fmtDate(karens.allowedFrom) })),
        h('p', { style: { margin: 0, fontWeight: 700 } }, blockMode ? t('karens.blocked') : t('karens.warnOnly')))) : null,
      vs.length > 1 ? chipRow(vs, 'varietyId', t('crate.variety')) : null,
      cts.length > 1 ? chipRow(cts, 'crateTypeId', t('crate.type'), (c) => (c.kg ? `${fmtNum(c.kg, 2)} kg` : '')) : null,
      h('div', { class: 'card' },
        h('div', { class: 'counter' },
          h('button', { type: 'button', 'aria-label': t('crate.less'), onclick: () => { st.count = Math.max(1, st.count - 1); feedback('tap'); draw(); } }, '−'),
          h('div', { class: 'num', 'aria-live': 'polite', 'data-count': st.count }, String(st.count), h('small', {}, st.count === 1 ? t('crate.one') : t('crate.many'))),
          h('button', { type: 'button', class: 'plus', 'aria-label': t('crate.more'), onclick: () => { st.count = Math.min(50, st.count + 1); feedback('tap'); draw(); } }, '+'))),
      h('details', { class: 'card', open: !!(st.weightKg || st.quality) || null },
        h('summary', { style: { fontWeight: 650, cursor: 'pointer', minHeight: '36px' } }, t('crate.optional')),
        h('div', { class: 'form-grid', style: { marginTop: '12px' } },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('crate.weight')), h('input', { class: 'input big', type: 'number', inputmode: 'decimal', step: '0.1', min: 0, value: st.weightKg, name: 'weight', oninput: (e) => { st.weightKg = e.target.value; } })),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('crate.quality')), h('div', { class: 'chips' }, ['A', 'B', 'C'].map((q) => h('button', { type: 'button', class: `chip ${st.quality === q ? 'on' : ''}`, onclick: () => { st.quality = st.quality === q ? '' : q; draw(); } }, q)))))),
      h('p', { class: 'muted small', style: { textAlign: 'center' } }, t('crate.rateInfo', { rate: fmtKr(rate) })),
      h('div', { class: 'sticky-action' }, h('div', { class: 'inner' },
        h('button', { class: 'btn light xl', type: 'button', onclick: finish }, t('common.cancel')),
        h('button', { class: 'btn primary xxl', type: 'button', 'data-act': 'register', disabled: (karens && blockMode) || null, onclick: () => submit(karens, blockMode) }, icon('check', 28), st.count === 1 ? t('crate.registerOne') : t('crate.registerN', { n: st.count })))),
      open ? h('div', { class: 'row wrap', style: { justifyContent: 'center' } },
        h('button', { class: 'btn light', type: 'button', 'data-act': 'break', onclick: async () => { flowEl = null; app.replaceChildren(...prev); await startBreak(p); onDone?.(); window.dispatchEvent(new HashChangeEvent('hashchange')); } }, icon('coffee', 18), t('picker.break')),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { flowEl = null; app.replaceChildren(...prev); await endDay(p); } }, icon('logout', 18), t('picker.end'))) : null,
    );
    if (karens) registerKarensAlert(p, st, karens, false);
  };
  const finishAndReopen = () => { draw(); };
  let alerted = new Set();
  function registerKarensAlert(person, s, k, attempted) {
    const key = `${s.fieldId}|${attempted}`;
    if (alerted.has(key)) return;
    alerted.add(key);
    if (!attempted) { feedback('warn'); return; }
    store.put('alerts', { type: 'karens', ts: new Date().toISOString(), fieldId: s.fieldId, sprayId: k.sprayId, personId: person.id, allowedFrom: k.allowedFrom, count: s.count, ack: false }, person.id);
  }
  const submit = async (karens, blockMode) => {
    if (karens) {
      registerKarensAlert(p, st, karens, true);
      if (blockMode) return;
    }
    const c = store.put('crates', {
      personId: p.id, fieldId: st.fieldId, varietyId: st.varietyId, crateTypeId: st.crateTypeId, count: st.count,
      weightKg: st.weightKg === '' ? null : D.num(st.weightKg), quality: st.quality || null, rate: D.crateRate(db, st), ts: new Date().toISOString(),
      karensOverride: karens ? karens.sprayId : undefined,
    }, p.id);
    flowEl = null;
    app.replaceChildren(...prev);
    await celebrate(p, c.count);
    resetToDeviceLang();
    onDone?.();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  draw();
  window.scrollTo(0, 0);
}

async function celebrate(p, n) {
  const sum = D.personSummary(dbView(), p.id);
  const before = sum.todayCrates - n;
  const earned = D.BADGES.filter((b) => before < b.at && sum.todayCrates >= b.at);
  const next = D.BADGES.find((b) => sum.todayCrates < b.at);
  const record = sum.todayCrates > sum.pastBest && before <= sum.pastBest && sum.pastBest > 0;
  const extra = h('div', { class: 'stack', style: { alignItems: 'center' } },
    h('div', { class: 'stats3', style: { width: 'min(460px, 90vw)', color: 'var(--ink)' } },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, String(sum.todayCrates)), h('div', { class: 'l' }, t('picker.cratesToday'))),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, String(Math.max(sum.pastBest, sum.todayCrates))), h('div', { class: 'l' }, t('picker.record'))),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, String(sum.streak)), h('div', { class: 'l' }, t('picker.streak')))),
    earned.length ? h('div', { class: 'badges' }, earned.map((b) => h('span', { class: 'badge-pill' }, icon(b.icon, 16), t('picker.newBadge'), ' ', t(b.key)))) : null,
    record ? h('div', { class: 'badges' }, h('span', { class: 'badge-pill' }, icon('trophy', 16), t('picker.newRecord'))) : null,
    next ? h('p', {}, t('picker.toNext', { n: next.at - sum.todayCrates, badge: t(next.key) })) : h('p', {}, t('picker.allBadges')));
  await bigResult({ type: 'success', title: n === 1 ? t('picker.crateAdded', { n }) : t('picker.crateAddedMany', { n }), lines: [p.name], extra, duration: 4500 });
}
