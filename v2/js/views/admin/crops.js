// Bærsorter og kassetyper med egne satser. Kassesats: kassetype > bærsort > standard i innstillinger.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, fmtKr, fmtNum, empty } from '../../ui.js';
import * as store from '../../core/store.js';
import { CROPS, cropName } from '../../core/crops.js';
import { pageHead } from './index.js';
import { actor } from '../shared.js';

const COLORS = ['#d6264f', '#e85d75', '#b0124c', '#7c3aed', '#1d4ed8', '#157a52', '#b45309', '#0e7490'];

export function render(ctx) {
  const st = store.settings();
  const vs = store.all('varieties').sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const cts = store.all('crateTypes').sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  return h('div', { class: 'stack' },
    pageHead(t('nav.crops'), t('crops.text')),
    h('div', { class: 'notice' }, icon('info'), h('p', {}, t('crops.rateOrder', { rate: fmtKr(st.crateRate || 0) }), ' ', h('a', { href: '#/admin/settings' }, t('crops.changeDefault')))),
    h('div', { class: 'grid two' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('crops.varieties')), h('button', { class: 'btn small primary', 'data-act': 'add-variety', onclick: () => editVariety(null, ctx) }, icon('plus', 16), t('common.add'))),
        vs.length ? h('div', { class: 'list' }, vs.map((v) => h('div', { class: 'list-item' }, h('span', { class: 'dot', style: { background: v.color || '#999' } }),
          h('span', { class: 'grow' }, h('strong', {}, v.name), h('div', { class: 'small muted' }, cropName(v.crop))),
          h('span', { class: 'tag' }, v.rate !== null && v.rate !== undefined && v.rate !== '' ? `${fmtKr(v.rate)}/${t('crate.one')}` : t('crops.defaultRate')),
          h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), onclick: () => editVariety(v, ctx) }, icon('edit', 18))))) : empty('grape', t('crops.noVarieties'))),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('crops.crateTypes')), h('button', { class: 'btn small primary', 'data-act': 'add-cratetype', onclick: () => editCrateType(null, ctx) }, icon('plus', 16), t('common.add'))),
        cts.length ? h('div', { class: 'list' }, cts.map((c) => h('div', { class: 'list-item' }, icon('box', 20),
          h('span', { class: 'grow' }, h('strong', {}, c.name), h('div', { class: 'small muted' }, c.kg ? `${fmtNum(c.kg, 2)} kg` : '')),
          h('span', { class: 'tag' }, c.rate !== null && c.rate !== undefined && c.rate !== '' ? `${fmtKr(c.rate)}/${t('crate.one')}` : t('crops.varietyRate')),
          h('button', { class: 'icon-btn', 'aria-label': t('common.edit'), onclick: () => editCrateType(c, ctx) }, icon('edit', 18))))) : empty('box', t('crops.noCrateTypes')))));
}

async function editVariety(v, ctx) {
  const cur = v || { name: '', crop: 'FRAAN', rate: '', color: COLORS[store.all('varieties').length % COLORS.length] };
  const name = input({ value: cur.name, required: true, name: 'name' });
  const crop = select(CROPS.map((c) => [c.eppo, `${t(c.key)} (${c.eppo})`]), cur.crop);
  const rate = input({ type: 'number', step: '0.01', min: 0, value: cur.rate ?? '', placeholder: t('crops.defaultRate'), name: 'rate' });
  const color = select(COLORS.map((c) => [c, c]), cur.color);
  const r = await modal(v ? t('crops.editVariety') : t('crops.newVariety'), h('div', { class: 'form-grid' }, field(t('crops.name'), name), field(t('fields.crop'), crop), field(t('crops.ratePerCrate'), rate, t('crops.rateBlank')), field(t('fields.color'), color)),
    [v ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.save'), class: 'primary', submit: true, onClick: () => (name.value.trim() ? { name: name.value.trim(), crop: crop.value, rate: rate.value === '' ? null : Number(rate.value), color: color.value } : (name.focus(), false)) }].filter(Boolean));
  if (!r) return;
  if (r === 'delete') { if (await confirmDialog(t('crops.deleteTitle'), t('crops.deleteText', { name: cur.name }), t('common.delete'))) { store.remove('varieties', cur.id, actor()); ctx.redraw(); } return; }
  store.put('varieties', { ...cur, ...r }, actor()); toast(t('common.saved')); ctx.redraw();
}
async function editCrateType(c, ctx) {
  const cur = c || { name: '', kg: '', rate: '' };
  const name = input({ value: cur.name, required: true, name: 'name' });
  const kg = input({ type: 'number', step: '0.01', min: 0, value: cur.kg ?? '', name: 'kg' });
  const rate = input({ type: 'number', step: '0.01', min: 0, value: cur.rate ?? '', placeholder: t('crops.varietyRate'), name: 'rate' });
  const r = await modal(c ? t('crops.editCrateType') : t('crops.newCrateType'), h('div', { class: 'form-grid' }, field(t('crops.name'), name), field(t('crops.kg'), kg), field(t('crops.ratePerCrate'), rate, t('crops.rateBlankType'))),
    [c ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null }, { label: t('common.save'), class: 'primary', submit: true, onClick: () => (name.value.trim() ? { name: name.value.trim(), kg: kg.value === '' ? null : Number(kg.value), rate: rate.value === '' ? null : Number(rate.value) } : (name.focus(), false)) }].filter(Boolean));
  if (!r) return;
  if (r === 'delete') { if (await confirmDialog(t('crops.deleteTitle'), t('crops.deleteText', { name: cur.name }), t('common.delete'))) { store.remove('crateTypes', cur.id, actor()); ctx.redraw(); } return; }
  store.put('crateTypes', { ...cur, ...r }, actor()); toast(t('common.saved')); ctx.redraw();
}
