// Leveranser: kjøpere og følgesedler. En leveranse samler paller (fra Sporbarhet) eller frie varelinjer til én kjøper.
// Kjøpere kan hentes fra Enhetsregisteret med organisasjonsnummer.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, field, input, select, empty, fmtDate, fmtNum, fmtKr, download, toCsv } from '../../ui.js';
import * as store from '../../core/store.js';
import * as D from '../../core/domain.js';
import { lookupOrg, validOrgNo, cleanOrgNo, BRREG_CREDIT } from '../../core/registers.js';
import { pageHead } from './index.js';
import { actor, dbAll } from '../shared.js';
import { printNodes } from '../print.js';

let year = new Date().getFullYear();

export function render(ctx) {
  const db = dbAll();
  const buyers = new Map(db.buyers.map((b) => [b.id, b]));
  const years = [...new Set([new Date().getFullYear(), ...db.deliveries.map((s) => Number(s.date?.slice(0, 4))).filter(Boolean)])].sort((a, b) => b - a);
  const list = db.deliveries.filter((d) => d.date?.startsWith(String(year))).sort((a, b) => (a.date + a.no < b.date + b.no ? 1 : -1));
  const sum = list.reduce((a, d) => { const x = D.deliveryTotals(d); return { kg: a.kg + x.kg, value: a.value + x.value }; }, { kg: 0, value: 0 });
  return h('div', { class: 'stack' },
    pageHead(t('nav.deliveries'), t('deliv.text'),
      h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': t('common.year'), onchange: (e) => { year = Number(e.target.value); ctx.redraw(); } }, years.map((y) => h('option', { value: y, selected: y === year }, String(y)))),
      h('button', { class: 'btn light', disabled: !list.length || null, onclick: () => download(`leveranser-${year}.csv`, toCsv(csvRows(list, buyers)), 'text/csv') }, icon('download', 18), 'CSV'),
      h('button', { class: 'btn light', 'data-act': 'add-buyer', onclick: () => editBuyer(null, ctx) }, icon('building', 18), t('deliv.newBuyer')),
      h('button', { class: 'btn primary', 'data-act': 'new-delivery', onclick: () => editDelivery(null, ctx) }, icon('plus', 18), t('deliv.new'))),
    list.length ? h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, String(list.length)), h('div', { class: 'l' }, t('deliv.count'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v' }, `${fmtNum(sum.kg, 0)} kg`), h('div', { class: 'l' }, t('deliv.delivered'))),
      sum.value ? h('div', { class: 'kpi' }, h('div', { class: 'v' }, fmtKr(sum.value)), h('div', { class: 'l' }, t('deliv.value'))) : null) : null,
    h('div', { class: 'card' }, h('h3', {}, t('deliv.listYear', { year })),
      list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', 'data-deliveries': '' },
        h('thead', {}, h('tr', {}, h('th', {}, t('trace.no')), h('th', {}, t('common.date')), h('th', {}, t('deliv.buyer')), h('th', {}, t('deliv.goods')), h('th', { class: 'num' }, 'kg'), h('th', { class: 'num' }, t('deliv.value')), h('th', {}, ''))),
        h('tbody', {}, list.map((d) => { const x = D.deliveryTotals(d); return h('tr', { 'data-delivery': d.no },
          h('td', { class: 'mono' }, d.no), h('td', {}, fmtDate(d.date)), h('td', {}, h('strong', {}, buyers.get(d.buyerId)?.name || d.buyerName || '–')),
          h('td', { class: 'small' }, (d.lines || []).map((l) => l.text).join(', ')),
          h('td', { class: 'num' }, fmtNum(x.kg, 1)), h('td', { class: 'num' }, x.value ? fmtKr(x.value) : '–'),
          h('td', { class: 'num' }, h('div', { class: 'row end' },
            h('button', { class: 'icon-btn', title: t('deliv.note'), 'aria-label': t('deliv.note'), 'data-act': 'print-delivery', onclick: () => printNote(d, buyers.get(d.buyerId)) }, icon('printer', 18)),
            h('button', { class: 'icon-btn', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => editDelivery(d, ctx) }, icon('edit', 18))))); })))) : empty('truck', t('deliv.none'))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, t('deliv.buyers')),
      h('button', { class: 'btn small light', disabled: true, title: t('pay.tripletexSoon'), 'data-dummy': 'ehf' }, icon('send', 16), t('deliv.sendBuyer'))),
      db.buyers.length ? h('div', { class: 'list' }, db.buyers.slice().sort((a, b) => a.name.localeCompare(b.name, 'nb')).map((b) => h('div', { class: 'list-item', 'data-buyer': b.name }, icon('building', 18),
        h('span', { class: 'grow' }, h('strong', {}, b.name), h('div', { class: 'small muted' }, [b.orgNo, b.address, b.contact].filter(Boolean).join(' · '))),
        h('button', { class: 'icon-btn', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => editBuyer(b, ctx) }, icon('edit', 18)))))
        : h('p', { class: 'muted' }, t('deliv.noBuyers'))),
    h('p', { class: 'small muted' }, t('deliv.legalNote')));
}

function csvRows(list, buyers) {
  return list.flatMap((d) => (d.lines || []).map((l) => ({ nr: d.no, dato: d.date, kjoper: buyers.get(d.buyerId)?.name || d.buyerName || '', orgnr: buyers.get(d.buyerId)?.orgNo || '', vare: l.text, pall: l.palletNo || '', kasser: l.crates ?? '', kg: l.kg ?? '', pris_per_kg: l.pricePerKg ?? '', sum: D.round(D.num(l.kg) * D.num(l.pricePerKg), 2), merknad: d.note || '' })));
}

/** Felt for organisasjonsnummer med oppslag i Enhetsregisteret. onHit får { name, address, orgNo }. */
export function orgLookupField(orgInput, onHit) {
  const status = h('small', { class: 'hint', 'data-org-status': '' }, t('reg.orgHint'));
  const btn = h('button', { class: 'btn light', type: 'button', 'data-act': 'org-lookup', onclick: async () => {
    const n = cleanOrgNo(orgInput.value);
    if (!validOrgNo(n)) { status.textContent = t('reg.orgInvalid'); return; }
    btn.disabled = true; status.textContent = t('reg.searching');
    try {
      const hit = await lookupOrg(n);
      if (!hit) status.textContent = t('reg.orgNotFound');
      else { onHit(hit); status.textContent = `${t('reg.orgFound', { name: hit.name })} ${hit.deleted ? t('reg.orgDeleted') : ''} (${BRREG_CREDIT})`; }
    } catch { status.textContent = t('reg.offline'); }
    btn.disabled = false;
  } }, icon('search', 18), t('reg.lookup'));
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('settings.orgNo')), h('div', { class: 'row' }, h('div', { class: 'grow' }, orgInput), btn), status);
}

async function editBuyer(b, ctx) {
  const cur = b || { name: '', orgNo: '', address: '', contact: '' };
  const name = input({ name: 'buyerName', value: cur.name, required: true });
  const orgNo = input({ name: 'buyerOrgNo', value: cur.orgNo || '', inputmode: 'numeric', maxlength: 11 });
  const address = input({ name: 'buyerAddress', value: cur.address || '' });
  const contact = input({ name: 'buyerContact', value: cur.contact || '' });
  const r = await modal(b ? t('deliv.editBuyer') : t('deliv.newBuyer'), h('div', { class: 'form-grid' },
    h('div', { class: 'full' }, orgLookupField(orgNo, (hit) => { name.value = hit.name; address.value = hit.address; orgNo.value = hit.orgNo; })),
    field(t('people.name'), name), field(t('settings.address'), address), h('div', { class: 'full' }, field(t('deliv.contact'), contact))),
  [b ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null },
    { label: t('common.save'), class: 'primary', submit: true, onClick: () => (name.value.trim() ? true : (name.focus(), false)) }].filter(Boolean), { wide: true });
  if (!r) return null;
  if (r === 'delete') {
    if (store.all('deliveries').some((d) => d.buyerId === b.id)) { toast(t('deliv.buyerUsed'), 'error'); return null; }
    if (!(await confirmDialog(t('deliv.deleteBuyer'), b.name, t('common.delete')))) return null;
    store.remove('buyers', b.id, actor()); ctx.redraw(); return null;
  }
  const saved = store.put('buyers', { ...cur, name: name.value.trim(), orgNo: cleanOrgNo(orgNo.value), address: address.value.trim(), contact: contact.value.trim() }, actor());
  toast(t('common.saved'));
  ctx.redraw();
  return saved;
}

async function editDelivery(d, ctx) {
  let db = dbAll();
  if (!db.buyers.length) { toast(t('deliv.needBuyer'), 'info'); const b = await editBuyer(null, ctx); if (!b) return; db = dbAll(); }
  const vars = new Map(db.varieties.map((v) => [v.id, v]));
  const cts = new Map(db.crateTypes.map((c) => [c.id, c]));
  const fields = new Map(db.fields.map((f) => [f.id, f]));
  const taken = new Set(db.deliveries.filter((x) => x.id !== d?.id).flatMap((x) => (x.lines || []).map((l) => l.palletId).filter(Boolean)));
  const cur = d || { date: D.todayKey(), buyerId: db.buyers[0].id, lines: [], note: '' };
  let lines = (cur.lines || []).map((l) => ({ ...l }));
  const date = input({ type: 'date', value: cur.date, name: 'date', required: true });
  const buyer = select(db.buyers.map((b) => [b.id, b.name]), cur.buyerId, { name: 'buyer' });
  const price = input({ type: 'number', step: 'any', min: 0, name: 'price', inputmode: 'decimal', value: lines.find((l) => l.pricePerKg)?.pricePerKg ?? '' });
  const note = input({ name: 'note', value: cur.note || '', maxlength: 200 });
  const linesEl = h('div', { class: 'stack tight', 'data-lines': '' });
  const palletText = (p) => `${vars.get(p.varietyId)?.name || fields.get(p.fieldId)?.name || p.fieldName || ''} · ${p.fieldName || ''} · ${p.date}`;
  // Vekt foreslås fra kassetypen på jordet (kg per kasse) når den er kjent
  const palletKg = (p) => { const ct = cts.get(fields.get(p.fieldId)?.defaultCrateTypeId); return ct?.kg ? D.round(D.num(ct.kg) * D.num(p.count), 1) : ''; };
  const free = db.pallets.filter((p) => !taken.has(p.id)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
  const drawLines = () => {
    const sum = D.deliveryTotals({ lines: lines.map((l) => ({ ...l, pricePerKg: price.value })) });
    linesEl.replaceChildren(
      ...lines.map((l, i) => h('div', { class: 'row wrap line-row', 'data-line': l.text },
        h('div', { class: 'grow', style: { minWidth: '160px' } }, l.palletId ? h('span', {}, h('strong', {}, l.palletNo), ' ', l.text) : input({ value: l.text, name: `text${i}`, placeholder: t('deliv.goodsPh'), 'aria-label': t('deliv.goods'), oninput: (e) => { l.text = e.target.value; } })),
        h('label', { class: 'mini-field' }, h('span', {}, t('trace.crates')), input({ type: 'number', min: 0, step: 1, value: l.crates ?? '', name: `crates${i}`, inputmode: 'numeric', oninput: (e) => { l.crates = e.target.value === '' ? null : D.num(e.target.value); } })),
        h('label', { class: 'mini-field' }, h('span', {}, 'kg'), input({ type: 'number', min: 0, step: 'any', value: l.kg ?? '', name: `kg${i}`, inputmode: 'decimal', oninput: (e) => { l.kg = e.target.value === '' ? null : D.num(e.target.value); sumEl(); } })),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.delete'), title: t('common.delete'), onclick: () => { lines.splice(i, 1); drawLines(); drawPallets(); } }, icon('trash', 16)))),
      lines.length ? h('p', { class: 'small', 'data-sum': '' }, t('deliv.sum', { kg: fmtNum(sum.kg, 1) }), sum.value ? ` · ${fmtKr(sum.value)}` : '') : h('p', { class: 'muted small' }, t('deliv.noLines')));
  };
  const sumEl = () => { const s = linesEl.querySelector('[data-sum]'); if (s) { const sum = D.deliveryTotals({ lines: lines.map((l) => ({ ...l, pricePerKg: price.value })) }); s.textContent = t('deliv.sum', { kg: fmtNum(sum.kg, 1) }) + (sum.value ? ` · ${fmtKr(sum.value)}` : ''); } };
  price.addEventListener('input', sumEl);
  const palletsEl = h('div', { class: 'chips', 'data-pallets': '' });
  const drawPallets = () => {
    const used = new Set(lines.map((l) => l.palletId).filter(Boolean));
    const avail = free.filter((p) => !used.has(p.id));
    palletsEl.replaceChildren(...(avail.length ? avail.map((p) => h('button', { type: 'button', class: 'chip', 'data-pallet': p.no, onclick: () => { lines.push({ palletId: p.id, palletNo: p.no, text: palletText(p), crates: D.num(p.count), kg: palletKg(p) === '' ? null : palletKg(p) }); drawLines(); drawPallets(); } }, icon('plus', 14), `${p.no} · ${p.fieldName || ''} · ${p.count}`)) : [h('span', { class: 'muted small' }, t('deliv.noPallets'))]));
  };
  drawLines(); drawPallets();
  const r = await modal(d ? t('deliv.edit', { no: d.no }) : t('deliv.new'), h('div', { class: 'form-grid' },
    field(t('common.date'), date), field(t('deliv.buyer'), buyer),
    h('div', { class: 'field full' }, h('span', { class: 'field-label' }, t('deliv.addPallets')), palletsEl),
    h('div', { class: 'field full' }, h('span', { class: 'field-label' }, t('deliv.lines')), linesEl,
      h('div', {}, h('button', { class: 'btn small light', type: 'button', 'data-act': 'add-line', onclick: () => { lines.push({ text: '', crates: null, kg: null }); drawLines(); } }, icon('plus', 16), t('deliv.addLine')))),
    field(t('deliv.pricePerKg'), price, t('deliv.priceHint')), field(t('spray.notes'), note)),
  [d ? { label: t('common.delete'), class: 'danger-light', value: 'delete' } : null, { label: t('common.cancel'), class: 'ghost', value: null },
    { label: d ? t('common.save') : t('deliv.saveAndPrint'), class: 'primary', submit: true, onClick: () => {
      if (!date.value) { date.focus(); return false; }
      if (!lines.length || lines.some((l) => !String(l.text || '').trim())) { toast(t('deliv.needLines'), 'error'); return false; }
      return true;
    } }].filter(Boolean), { wide: true });
  if (!r) return;
  if (r === 'delete') {
    if (!(await confirmDialog(t('deliv.deleteTitle'), t('deliv.deleteText', { no: d.no }), t('common.delete')))) return;
    store.remove('deliveries', d.id, actor()); toast(t('common.deleted')); return ctx.redraw();
  }
  const b = db.buyers.find((x) => x.id === buyer.value);
  const p = price.value === '' ? null : D.num(price.value);
  const saved = store.put('deliveries', { ...cur, no: cur.no || D.nextDeliveryNo(db.deliveries, Number(date.value.slice(0, 4))), date: date.value, buyerId: b.id, buyerName: b.name,
    lines: lines.map((l) => ({ palletId: l.palletId || null, palletNo: l.palletNo || null, text: String(l.text).trim(), crates: l.crates ?? null, kg: l.kg ?? null, pricePerKg: p })), note: note.value.trim() }, actor());
  toast(t('common.saved'));
  ctx.redraw();
  if (!d) printNote(saved, b);
}

function printNote(d, b) {
  const st = store.settings();
  const x = D.deliveryTotals(d);
  const priced = (d.lines || []).some((l) => l.pricePerKg);
  const th = (v, num) => h('th', { style: num ? { textAlign: 'right' } : null }, v), td = (v, num) => h('td', { style: num ? { textAlign: 'right' } : null }, v);
  printNodes([h('div', { class: 'print-doc', 'data-delivery-note': d.no },
    h('h1', {}, `${t('deliv.note')} ${d.no}`),
    h('div', { class: 'print-cols' },
      h('div', {}, h('h2', {}, t('deliv.from')), h('p', {}, h('strong', {}, st.farmName || ''), h('br'), st.orgNo ? `${t('settings.orgNo')} ${st.orgNo}` : '', h('br'), st.address || '', h('br'), [st.contactPhone, st.contactEmail].filter(Boolean).join(' · '))),
      h('div', {}, h('h2', {}, t('deliv.to')), h('p', {}, h('strong', {}, b?.name || d.buyerName || ''), h('br'), b?.orgNo ? `${t('settings.orgNo')} ${b.orgNo}` : '', h('br'), b?.address || '', h('br'), b?.contact || ''))),
    h('p', {}, `${t('common.date')}: ${fmtDate(d.date)}`),
    h('table', { class: 'print-table' }, h('thead', {}, h('tr', {}, th(t('deliv.goods')), th(t('deliv.pallet')), th(t('trace.crates'), 1), th('kg', 1), priced ? th(t('deliv.pricePerKg'), 1) : null, priced ? th(t('pay.total'), 1) : null)),
      h('tbody', {}, (d.lines || []).map((l) => h('tr', {}, td(l.text), td(l.palletNo || ''), td(l.crates != null ? fmtNum(l.crates, 0) : '', 1), td(l.kg != null ? fmtNum(l.kg, 1) : '', 1), priced ? td(l.pricePerKg ? fmtNum(l.pricePerKg, 2) : '', 1) : null, priced ? td(l.pricePerKg ? fmtNum(D.num(l.kg) * D.num(l.pricePerKg), 2) : '', 1) : null)),
        h('tr', {}, h('td', { colspan: 2 }, h('strong', {}, t('pay.total'))), td(fmtNum(x.crates, 0), 1), td(fmtNum(x.kg, 1), 1), priced ? td('') : null, priced ? td(fmtNum(x.value, 2), 1) : null))),
    d.note ? h('p', {}, d.note) : null,
    h('div', { class: 'print-cols', style: { marginTop: '18mm' } }, h('p', { class: 'sign' }, t('deliv.signFrom')), h('p', { class: 'sign' }, t('deliv.signTo'))),
    h('p', { class: 'small' }, t('deliv.noteFoot')))], `${t('deliv.note')} ${d.no}`);
}
