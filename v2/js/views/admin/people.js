// Personer (plukkere, sprøytere, formenn) og QR-kort.
import { t, LANGS } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty } from '../../ui.js';
import * as store from '../../core/store.js';
import { issueCard, ROLES } from '../../core/qrauth.js';
import { pageHead } from './index.js';
import { actor } from '../shared.js';
import { cardsSheet, previewAndPrint } from '../print.js';

let filter = '';
export function render(ctx) {
  const people = store.all('people').sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name, 'nb'));
  const selected = new Set();
  const list = people.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
  const tbody = h('tbody', {}, list.map((p) => {
    const cards = (p.cards || []).filter((c) => !c.revoked);
    const cb = h('input', { type: 'checkbox', 'aria-label': p.name, onchange: (e) => (e.target.checked ? selected.add(p.id) : selected.delete(p.id)) });
    return h('tr', { 'data-person': p.name },
      h('td', {}, cb),
      h('td', {}, h('strong', {}, p.name), p.number ? h('span', { class: 'muted small' }, ` #${p.number}`), p.active === false ? h('span', { class: 'tag' }, t('people.inactive')) : null),
      h('td', {}, (p.roles || []).map((r) => h('span', { class: 'tag blue', style: { marginInlineEnd: '4px' } }, t('role.' + r)))),
      h('td', {}, LANGS.find((l) => l.code === p.lang)?.name || '–'),
      h('td', {}, cards.length ? h('span', { class: 'tag ok' }, icon('qr', 14), ` ${cards.length}`) : h('span', { class: 'tag warn' }, t('people.noCard'))),
      h('td', { class: 'num' },
        h('button', { class: 'icon-btn', title: t('people.printCard'), 'aria-label': t('people.printCard'), onclick: () => printCards([p], ctx) }, icon('printer', 18)),
        h('button', { class: 'icon-btn', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => editPerson(p, ctx) }, icon('edit', 18))));
  }));
  return h('div', { class: 'stack' },
    pageHead(t('nav.people'), t('people.text'),
      h('button', { class: 'btn light', onclick: () => { const sel = people.filter((p) => selected.has(p.id)); if (!sel.length) return toast(t('people.selectFirst'), 'info'); printCards(sel, ctx); } }, icon('printer', 18), t('people.printSelected')),
      h('button', { class: 'btn primary', 'data-act': 'add-person', onclick: () => editPerson(null, ctx) }, icon('userPlus', 18), t('people.add'))),
    h('div', { class: 'notice' }, icon('shield'), h('p', {}, t('people.cardSecurity'))),
    h('input', { class: 'input', type: 'search', placeholder: t('common.search'), value: filter, oninput: (e) => { filter = e.target.value; ctx.redraw(); }, style: { maxWidth: '360px' } }),
    people.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, t('people.name')), h('th', {}, t('people.roles')), h('th', {}, t('people.lang')), h('th', {}, t('people.cards')), h('th', {}, ''))), tbody))
      : empty('users', t('people.empty')));
}

async function editPerson(p, ctx) {
  const isNew = !p;
  p = p ? structuredClone(p) : { name: '', roles: ['picker'], lang: '', active: true, cards: [] };
  const name = input({ value: p.name, required: true, name: 'name', autocomplete: 'off' });
  const number = input({ type: 'number', min: 1, value: p.number ?? '', name: 'number' });
  const lang = select([['', t('people.langDevice')], ...LANGS.map((l) => [l.code, `${l.name} (${l.en})`])], p.lang, { name: 'lang' });
  const hourRate = input({ type: 'number', step: '0.01', min: 0, value: p.hourRate ?? '', placeholder: t('people.hourRateDefault'), name: 'hourRate' });
  const roleBoxes = ROLES.map((r) => { const cb = h('input', { type: 'checkbox', checked: (p.roles || []).includes(r), value: r, name: 'role-' + r }); return [r, cb, h('label', { class: 'check' }, cb, t('role.' + r))]; });
  const active = h('input', { type: 'checkbox', checked: p.active !== false });
  const cards = (p.cards || []);
  const cardList = h('div', { class: 'stack tight' }, cards.length ? cards.map((c) => h('div', { class: 'row' }, icon('qr', 18), h('span', { class: 'grow mono small' }, `…${c.hint} · ${c.created?.slice(0, 10) || ''}`),
    c.revoked ? h('span', { class: 'tag bad' }, t('people.revoked')) : h('button', { class: 'btn small danger-light', type: 'button', onclick: () => { c.revoked = true; c.revokedAt = new Date().toISOString(); toast(t('people.revokeOnSave'), 'info'); cardList.replaceWith(h('p', { class: 'small' }, t('people.revokeOnSave'))); } }, t('people.revoke')))) : [h('p', { class: 'muted small' }, t('people.noCard'))]);
  const r = await modal(isNew ? t('people.add') : t('people.edit'), h('div', { class: 'form-grid' },
    field(t('people.name'), name), field(t('people.number'), number, t('people.numberHint')),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('people.roles')), h('div', { class: 'stack tight' }, roleBoxes.map((x) => x[2]))),
    field(t('people.lang'), lang, t('people.langHint')), field(t('people.hourRate'), hourRate),
    h('label', { class: 'check' }, active, t('people.active')),
    isNew ? null : h('div', { class: 'field full' }, h('span', { class: 'field-label' }, t('people.cards')), cardList)),
  [
    isNew ? null : { label: t('common.delete'), class: 'danger-light', value: 'delete' },
    { label: t('common.cancel'), class: 'ghost', value: null },
    { label: isNew ? t('people.saveAndPrint') : t('common.save'), class: 'primary', submit: true, onClick: () => {
      if (!name.value.trim()) { name.focus(); return false; }
      const roles = roleBoxes.filter((x) => x[1].checked).map((x) => x[0]);
      if (!roles.length) { toast(t('people.needRole'), 'error'); return false; }
      return { name: name.value.trim(), number: number.value ? Number(number.value) : null, lang: lang.value || null, hourRate: hourRate.value === '' ? null : Number(hourRate.value), roles, active: active.checked };
    } },
  ].filter(Boolean), { wide: true });
  if (!r) return;
  if (r === 'delete') {
    if (!(await confirmDialog(t('people.deleteTitle'), t('people.deleteText', { name: p.name }), t('common.delete')))) return;
    // Personen deaktiveres og anonymiseres ikke automatisk: registreringene trengs for lønn og arbeidstid.
    store.patch('people', p.id, { active: false, cards: (p.cards || []).map((c) => ({ ...c, revoked: true })) }, actor());
    toast(t('people.deactivated'));
    return ctx.redraw();
  }
  const saved = store.put('people', { ...p, ...r, cards }, actor());
  toast(t('common.saved'));
  ctx.redraw();
  if (isNew) printCards([saved], ctx, false);
}

async function printCards(people, ctx, askRevoke = true) {
  const revokeBox = h('input', { type: 'checkbox' });
  const ok = await modal(t('people.printTitle', { n: people.length }), h('div', { class: 'stack' },
    h('p', {}, t('people.printText')),
    askRevoke ? h('label', { class: 'check' }, revokeBox, t('people.revokeOld')) : null),
  [{ label: t('common.cancel'), class: 'ghost', value: false }, { label: t('people.makeCards'), class: 'primary', value: true, icon: 'qr', id: 'make-cards' }]);
  if (!ok) return;
  const items = [];
  for (const p of people) {
    const { token, card } = await issueCard(store.tenantId());
    const cards = (p.cards || []).map((c) => (revokeBox.checked && !c.revoked ? { ...c, revoked: true, revokedAt: new Date().toISOString() } : c));
    store.put('people', { ...store.get('people', p.id), cards: [...cards, card] }, actor());
    items.push({ person: p, token });
  }
  ctx.redraw();
  await previewAndPrint(cardsSheet(items, store.settings().farmName), t('people.cardsTitle'));
}
