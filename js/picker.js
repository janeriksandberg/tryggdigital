// Plukker: klokke inn, klokke ut, registrere kasser. Store knapper for hansker.
import { t } from './i18n.js';
import { h, bigResult, fmtTime, fmtDuration, fmtKr, feedback } from './ui.js';
import { scan } from './scanner.js';
import * as S from './store.js';

// Merker (gamification) basert på antall kasser i dag
export const BADGES = [
  { at: 1, icon: '🌱', key: 'badge.first' },
  { at: 5, icon: '🍓', key: 'badge.five' },
  { at: 10, icon: '⭐', key: 'badge.ten' },
  { at: 20, icon: '🔥', key: 'badge.twenty' },
  { at: 30, icon: '🏆', key: 'badge.thirty' },
  { at: 50, icon: '👑', key: 'badge.fifty' },
];
const badgeFor = (n) => [...BADGES].reverse().find((b) => n >= b.at);
const nextBadge = (n) => BADGES.find((b) => n < b.at);

function progressRing(value, max, label, sub) {
  const r = 52, c = 2 * Math.PI * r;
  const pct = Math.min(1, max ? value / max : 1);
  return h('div', { class: 'ring' },
    h('span', { class: 'ring-svg', html:
      `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>` }),
    h('div', { class: 'ring-label' }, h('strong', {}, label), h('span', {}, sub)));
}

function statsPanel(w) {
  const s = S.workerSummary(w.id);
  const nb = nextBadge(s.todayCrates);
  const cur = badgeFor(s.todayCrates);
  const prevAt = cur ? cur.at : 0;
  return h('div', { class: 'game-panel' },
    progressRing(s.todayCrates - prevAt, nb ? nb.at - prevAt : 1, String(s.todayCrates), t('picker.cratesToday')),
    h('div', { class: 'game-facts' },
      cur ? h('div', { class: 'badge-chip' }, h('span', { class: 'badge-icon' }, cur.icon), t(cur.key)) : null,
      nb ? h('p', { class: 'next' }, t('picker.toNext', { n: nb.at - s.todayCrates, badge: `${nb.icon} ${t(nb.key)}` })) : h('p', { class: 'next' }, t('picker.allBadges')),
      h('div', { class: 'mini-stats' },
        h('div', {}, h('strong', {}, String(Math.max(s.pastBest, s.todayCrates))), h('span', {}, t('picker.record'))),
        h('div', {}, h('strong', {}, String(s.streak)), h('span', {}, t('picker.streak'))),
        h('div', {}, h('strong', {}, String(s.total)), h('span', {}, t('picker.season'))))));
}

async function identify(title, color) {
  const code = await scan({ title, hint: t('scan.hintWorker'), color });
  if (!code) return null;
  const w = S.workerByCode(code);
  if (!w || w.active === false) {
    await bigResult({ type: 'error', title: t('picker.unknownCode'), lines: [h('p', { class: 'code-pill' }, code), t('picker.unknownHelp')] });
    return null;
  }
  return w;
}

async function doClockIn() {
  const w = await identify(t('picker.start'), 'green');
  if (!w) return;
  const open = S.openShift(w.id);
  if (open) {
    await bigResult({ type: 'error', title: t('picker.alreadyIn', { name: w.name }), lines: [t('picker.since', { time: fmtTime(open.start) })] });
    return;
  }
  const s = S.clockIn(w.id);
  await bigResult({ title: t('picker.welcome', { name: w.name }), lines: [h('p', { class: 'big-number' }, fmtTime(s.start)), t('picker.clockedIn'), t('picker.goodLuck')], duration: 6000 });
  rerender();
}

async function doClockOut() {
  const w = await identify(t('picker.end'), 'orange');
  if (!w) return;
  const open = S.openShift(w.id);
  if (!open) {
    await bigResult({ type: 'error', title: t('picker.notIn', { name: w.name }), lines: [t('picker.notInHelp')] });
    return;
  }
  const s = S.clockOut(w.id);
  const hours = S.shiftHours(s);
  const sum = S.workerSummary(w.id);
  const p = S.dayPay(sum.todayHours, sum.todayCrates);
  const cur = badgeFor(sum.todayCrates);
  await bigResult({
    title: t('picker.goodbye', { name: w.name }),
    lines: [
      h('p', { class: 'label-light' }, t('picker.workedToday')),
      h('p', { class: 'big-number' }, fmtDuration(sum.todayHours)),
      h('p', {}, t('picker.shiftInfo', { from: fmtTime(s.start), to: fmtTime(s.end), dur: fmtDuration(hours) })),
    ],
    extra: h('div', { class: 'result-stats' },
      h('div', {}, h('strong', {}, String(sum.todayCrates)), h('span', {}, t('picker.cratesToday'))),
      h('div', {}, h('strong', {}, fmtKr(p.pay)), h('span', {}, t('picker.estPay'))),
      cur ? h('div', {}, h('strong', {}, cur.icon), h('span', {}, t(cur.key))) : null,
      p.basis === 'crate' ? h('p', { class: 'cheer' }, '🎉 ' + t('picker.crateBeatsHour')) : null),
  });
  rerender();
}

async function doCrate() {
  const w = await identify(t('picker.crate'), 'berry');
  if (!w) return;
  // Velg antall (standard 1)
  let count = 1;
  const num = h('div', { class: 'stepper-value' }, '1');
  const set = (v) => { count = Math.max(1, Math.min(20, v)); num.textContent = count; feedback('tap'); };
  const result = await new Promise((resolve) => {
    const el = h('div', { class: 'count-sheet show' },
      h('div', { class: 'count-inner' },
        h('p', { class: 'who' }, '👤 ', w.name),
        h('h1', {}, t('picker.howMany')),
        h('div', { class: 'stepper' },
          h('button', { class: 'step-btn', onclick: () => set(count - 1), 'aria-label': '-1' }, '−'),
          num,
          h('button', { class: 'step-btn', onclick: () => set(count + 1), 'aria-label': '+1' }, '+')),
        h('div', { class: 'quick-counts' }, [1, 2, 3, 4, 5].map((n) => h('button', { class: 'chip-btn', onclick: () => set(n) }, String(n)))),
        h('button', { class: 'btn primary xxl', onclick: () => { el.remove(); resolve(true); } }, '✓ ', t('picker.register')),
        h('button', { class: 'btn ghost-light xl', onclick: () => { el.remove(); resolve(false); } }, t('common.cancel'))));
    document.body.appendChild(el);
  });
  if (!result) return;
  const before = S.workerSummary(w.id);
  S.addCrates(w.id, count);
  const after = S.workerSummary(w.id);
  const newBadge = BADGES.find((b) => before.todayCrates < b.at && after.todayCrates >= b.at);
  const record = after.todayCrates > before.pastBest && before.pastBest > 0 && before.todayCrates <= before.pastBest;
  const nb = nextBadge(after.todayCrates);
  const notIn = !S.openShift(w.id);
  await bigResult({
    title: t(count === 1 ? 'picker.crateAdded' : 'picker.crateAddedMany', { n: count }),
    lines: [h('p', { class: 'who-light' }, w.name), h('p', { class: 'big-number' }, String(after.todayCrates)), t('picker.cratesTodayLong')],
    extra: h('div', { class: 'result-extra' },
      newBadge ? h('div', { class: 'new-badge' }, h('span', {}, newBadge.icon), h('strong', {}, t('picker.newBadge')), h('em', {}, t(newBadge.key))) : null,
      record ? h('div', { class: 'new-badge gold' }, h('span', {}, '🚀'), h('strong', {}, t('picker.newRecord'))) : null,
      nb ? h('p', {}, t('picker.toNext', { n: nb.at - after.todayCrates, badge: `${nb.icon} ${t(nb.key)}` })) : null,
      notIn ? h('p', { class: 'warn-light' }, '⚠️ ' + t('picker.crateNotIn')) : null),
    duration: 7000,
  });
  rerender();
}

let rerender = () => {};

export function renderPicker() {
  const main = h('main', { class: 'picker' });
  const draw = () => {
    const today = S.todayKey();
    const activeNow = S.db().shifts.filter((s) => !s.end && S.dayKey(s.start) === today).length;
    const cratesToday = S.db().crates.filter((c) => S.dayKey(c.ts) === today).reduce((a, c) => a + c.count, 0);
    main.replaceChildren(
      h('div', { class: 'picker-head' },
        h('h1', {}, t('picker.hello')),
        h('p', {}, t('picker.instructions'))),
      h('div', { class: 'action-stack' },
        h('button', { class: 'action-btn green', onclick: doClockIn },
          h('span', { class: 'a-icon' }, '☀️'), h('span', { class: 'a-text' }, h('strong', {}, t('picker.start')), h('small', {}, t('picker.startHint'))), h('span', { class: 'a-scan' }, '⌗')),
        h('button', { class: 'action-btn berry', onclick: doCrate },
          h('span', { class: 'a-icon' }, '🍓'), h('span', { class: 'a-text' }, h('strong', {}, t('picker.crate')), h('small', {}, t('picker.crateHint'))), h('span', { class: 'a-scan' }, '⌗')),
        h('button', { class: 'action-btn orange', onclick: doClockOut },
          h('span', { class: 'a-icon' }, '🌙'), h('span', { class: 'a-text' }, h('strong', {}, t('picker.end')), h('small', {}, t('picker.endHint'))), h('span', { class: 'a-scan' }, '⌗'))),
      h('div', { class: 'team-strip' },
        h('div', {}, h('strong', {}, String(activeNow)), h('span', {}, t('picker.teamActive'))),
        h('div', {}, h('strong', {}, String(cratesToday)), h('span', {}, t('picker.teamCrates')))),
      h('button', { class: 'btn ghost my-stats', onclick: showMyStats }, '🏅 ', t('picker.myStats')));
  };
  rerender = draw;
  draw();
  return main;
}

async function showMyStats() {
  const w = await identify(t('picker.myStats'), 'berry');
  if (!w) return;
  const el = h('div', { class: 'count-sheet show stats-sheet' },
    h('div', { class: 'count-inner' },
      h('p', { class: 'who' }, '👤 ', w.name),
      statsPanel(w),
      h('div', { class: 'badge-wall' }, BADGES.map((b) => {
        const have = S.workerSummary(w.id).todayCrates >= b.at;
        return h('div', { class: `badge-tile ${have ? 'have' : ''}` }, h('span', {}, b.icon), h('small', {}, t(b.key)), h('em', {}, `${b.at}`));
      })),
      h('button', { class: 'btn primary xl', onclick: () => el.remove() }, t('common.close'))));
  document.body.appendChild(el);
}
