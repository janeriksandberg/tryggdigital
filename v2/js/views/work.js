// Arbeidsøkt for sprøyter og formann etter skanning av QR-kort. Økten lever bare i minnet og avsluttes
// ved «Ferdig», ved omstart eller etter 15 minutter uten aktivitet.
import { t } from '../i18n.js';
import { h, icon, fmtDate, fmtNum, fmtTime, clear, empty } from '../ui.js';
import * as store from '../core/store.js';
import * as D from '../core/domain.js';
import { topbar, go } from '../app.js';
import { work, workActive, endWork, avatar } from './kiosk.js';
import { board } from './foreman.js';
import { sprayForm } from './sprayform.js';
import { dbAll } from './shared.js';

let timer = null;

export function view() {
  let role = null, mode = 'home', task = null;
  let main = null;
  const done = () => { endWork(); go(''); };
  return {
    topbar: () => topbar({ kind: 'kiosk', subtitle: work.person ? `${work.person.name} · ${t('role.' + work.role)}` : '', actions: [h('button', { class: 'top-btn', type: 'button', 'data-act': 'done', onclick: done }, icon('logout', 20), h('span', { class: 'hide-sm' }, t('work.done')))] }),
    render(r) {
      role = r.page;
      if (!workActive(role)) { setTimeout(() => go(''), 0); return h('div'); }
      clearInterval(timer);
      timer = setInterval(() => { if (!workActive(role)) { clearInterval(timer); done(); } }, 30000);
      main = h('main', { class: 'work-main' });
      draw();
      return main;
    },
    onData() { if (mode === 'home') draw(); },
    destroy() { clearInterval(timer); },
  };

  function draw() {
    if (!main) return;
    const p = work.person;
    if (role === 'foreman') {
      clear(main, h('div', { class: 'who' }, avatar(p), h('div', { class: 'grow' }, h('h1', {}, p.name), h('span', { class: 'muted' }, t('role.foreman')))), board({ by: p.id }));
      return;
    }
    if (mode === 'form') {
      const host = h('div', { class: 'stack', 'data-form': 'spray' });
      clear(main, h('h1', {}, t('spray.newTitle')), host);
      sprayForm(host, { task, operator: p, by: p.id, onDone: (saved) => { mode = 'home'; task = null; draw(); window.scrollTo(0, 0); if (saved) afterSave(saved); } });
      window.scrollTo(0, 0);
      return;
    }
    clear(main, ...sprayerHome(p));
  }

  function afterSave(s) {
    main.prepend(h('div', { class: 'notice ok', role: 'status', 'data-saved': '' }, icon('checkCircle'), h('p', {}, t('spray.saved', { field: s.fieldName, date: fmtDate(D.harvestAllowedFrom(s, store.all('products'))) }))));
  }

  function sprayerHome(p) {
    const db = dbAll();
    const today = D.todayKey();
    const tasks = db.tasks.filter((x) => x.type === 'spray' && x.status !== 'done' && (!x.assigneeId || x.assigneeId === p.id)).sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || ''));
    const mine = db.sprays.filter((s) => s.operatorId === p.id).sort((a, b) => (a.date + (a.startTime || '') < b.date + (b.startTime || '') ? 1 : -1)).slice(0, 8);
    const fields = new Map(db.fields.map((f) => [f.id, f]));
    const karens = db.fields.map((f) => ({ f, k: D.karensFor(db, f.id, today) })).filter((x) => x.k);
    const bal = Object.values(D.stockBalance(db)).filter((b) => b.product && b.product.active !== false);
    return [
      h('div', { class: 'who' }, avatar(p), h('div', { class: 'grow' }, h('h1', {}, p.name), h('span', { class: 'muted' }, t('role.sprayer'), p.certNo ? ` · ${t('people.certNo')} ${p.certNo}` : ''))),
      h('button', { class: 'scan-hero', type: 'button', 'data-act': 'new-spray', onclick: () => { mode = 'form'; task = null; draw(); } }, icon('tractor', 52), h('span', {}, t('spray.new'), h('small', {}, t('spray.newSub')))),
      h('div', { class: 'card stack' }, h('h3', {}, icon('clipboard', 20), ' ', t('spray.tasks')),
        tasks.length ? h('div', { class: 'list' }, tasks.map((x) => h('div', { class: 'list-item', 'data-task': x.id },
          h('span', { class: 'dot', style: { background: fields.get(x.fieldId)?.color || '#999' } }),
          h('div', { class: 'grow' }, h('strong', {}, fields.get(x.fieldId)?.name || '–'), h('div', { class: 'small muted' }, x.plannedDate ? fmtDate(x.plannedDate) : '', x.productIds?.length ? ' · ' + x.productIds.map((id) => db.products.find((pp) => pp.id === id)?.name).filter(Boolean).join(', ') : '', x.note ? ` · ${x.note}` : '')),
          h('button', { class: 'btn primary', type: 'button', onclick: () => { mode = 'form'; task = x; draw(); } }, t('spray.doTask'))))) : h('p', { class: 'muted' }, t('spray.noTasks'))),
      karens.length ? h('div', { class: 'card stack' }, h('h3', {}, icon('hourglass', 20), ' ', t('spray.activeKarens')),
        karens.map(({ f, k }) => h('div', { class: 'notice warn' }, icon('alert'), h('p', {}, h('strong', {}, f.name), ' · ', t('spray.karensUntil', { date: fmtDate(k.allowedFrom) }))))) : null,
      h('div', { class: 'card stack' }, h('h3', {}, icon('history', 20), ' ', t('spray.myLatest')),
        mine.length ? h('div', { class: 'list' }, mine.map((s) => h('div', { class: 'list-item' },
          h('span', { class: 'dot', style: { background: fields.get(s.fieldId)?.color || '#999' } }),
          h('div', { class: 'grow' }, h('strong', {}, s.fieldName || fields.get(s.fieldId)?.name || '–', ' · ', fmtDate(s.date), s.startTime ? ` ${s.startTime}` : ''),
            h('div', { class: 'small muted' }, (s.products || []).map((x) => `${x.name} ${fmtNum(x.dose, 3)} ${x.unit}`).join(', '))),
          s.date === today ? h('button', { class: 'btn small light', type: 'button', onclick: () => editOwn(s) }, icon('edit', 16), t('common.edit')) : null))) : empty('tractor', t('spray.none'))),
      bal.length ? h('div', { class: 'card stack' }, h('h3', {}, icon('warehouse', 20), ' ', t('stock.title')),
        h('div', { class: 'list' }, bal.map((b) => h('div', { class: 'list-item' }, icon('flask', 20), h('span', { class: 'grow' }, b.product.name), h('strong', { class: b.balance < 0 ? 'neg' : '' }, `${fmtNum(b.balance, 2)} ${b.unit}`))))) : null,
      h('p', { class: 'muted small', style: { textAlign: 'center' } }, t('work.autoEnd', { time: fmtTime(work.until) })),
    ];
  }

  function editOwn(s) {
    const host = h('div', { class: 'stack' });
    clear(main, h('h1', {}, t('spray.editTitle')), host);
    mode = 'form';
    sprayForm(host, { spray: s, operator: work.person, by: work.person.id, onDone: (saved) => { mode = 'home'; draw(); if (saved) afterSave(saved); } });
  }
}
