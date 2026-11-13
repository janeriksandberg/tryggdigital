// Sprøyter: registrere sprøyting mot registrerte jorder (plantevernjournal) med GPS-forslag.
import { t } from './i18n.js';
import { h, modal, confirmDialog, infoDialog, toast, fmtNum, fmtDate, download, toCsv, bigResult } from './ui.js';
import { CROPS, cropName, fieldPreview } from './map.js';
import { rankFields } from './geo.js';
import * as S from './store.js';

const BBCH = [
  { code: 0, key: 'bbch.0' }, { code: 1, key: 'bbch.1' }, { code: 3, key: 'bbch.3' }, { code: 5, key: 'bbch.5' },
  { code: 6, key: 'bbch.6' }, { code: 7, key: 'bbch.7' }, { code: 8, key: 'bbch.8' }, { code: 9, key: 'bbch.9' },
];
const UNITS = ['l/daa', 'ml/daa', 'kg/daa', 'g/daa'];

export function renderSprayer(tab) {
  tab = tab === 'journal' ? 'journal' : 'new';
  const main = h('main', { class: 'sprayer' });
  main.append(
    h('nav', { class: 'seg' },
      h('a', { href: '#/sprayer/new', class: tab === 'new' ? 'on' : '' }, '＋ ', t('spray.new')),
      h('a', { href: '#/sprayer/journal', class: tab === 'journal' ? 'on' : '' }, '📒 ', t('spray.journal'), ` (${S.db().sprays.length})`)),
    tab === 'new' ? sprayForm() : journal());
  return main;
}

const req = (txt) => h('span', { class: 'req' }, txt || t('spray.required'));
const rec = () => h('span', { class: 'rec' }, t('spray.recommended'));

function section(num, title, badge, ...body) {
  return h('section', { class: 'card form-sec' }, h('div', { class: 'sec-head' }, h('span', { class: 'sec-num' }, num), h('h3', {}, title), badge), ...body);
}

export function sprayForm(existing) {
  const st = S.db().settings;
  const fields = S.db().fields;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const r = existing ? structuredClone(existing) : {
    id: S.uid(), fieldId: null, date: S.todayKey(), startTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`, endTime: '',
    crop: '', bbch: '', areaDaa: '', products: [{ name: '', regNo: '', dose: '', unit: 'l/daa', total: '' }], waterPerDaa: '',
    target: '', reason: '', attack: '', ipm: '', operator: st.operatorName, authNo: st.authNo, orgOwner: st.orgOwner, orgSprayer: st.orgSprayer,
    equipment: st.equipment, wind: '', windDir: '', temp: '', distWater: '', driftReduction: '', phiDays: '', notes: '', useType: 'outdoor',
  };

  if (!fields.length) {
    return h('div', { class: 'card empty big-empty' }, h('span', {}, '🗺️'), h('h3', {}, t('spray.noFields')), h('p', {}, t('spray.noFieldsHelp')), h('a', { class: 'btn primary', href: '#/admin/fields' }, t('spray.goFields')));
  }

  const form = h('form', { class: 'spray-form', novalidate: '' });
  const gpsBox = h('div', { class: 'gps-box' });
  const chips = h('div', { class: 'field-chips' });
  const mapEl = h('div', { class: 'map small-map' });
  let pos = null, map = null, ranked = fields.map((f) => ({ field: f, dist: null }));

  const areaIn = h('input', { class: 'input big', type: 'number', inputmode: 'decimal', step: '0.1', min: 0, value: r.areaDaa });
  const cropSel = h('select', { class: 'input big' }, h('option', { value: '' }, '–'), CROPS.map((c) => h('option', { value: c.eppo }, `${t(c.key)} · ${c.eppo}`)));
  cropSel.value = r.crop;

  const selectField = (id) => {
    r.fieldId = id;
    const f = fields.find((x) => x.id === id);
    if (f) {
      if (!existing || !r.areaDaa) { r.areaDaa = Math.round(f.areaDaa * 10) / 10; areaIn.value = r.areaDaa; }
      if (!r.crop || !existing) { r.crop = f.crop; cropSel.value = f.crop; }
    }
    drawChips();
    if (map) { map.remove(); map = null; }
    map = fieldPreview(mapEl, fields, id, pos);
    recalcTotals();
  };
  const drawChips = () => {
    chips.replaceChildren(...ranked.map(({ field: f, dist }) => h('button', {
      type: 'button', class: `field-chip ${f.id === r.fieldId ? 'on' : ''}`, onclick: () => selectField(f.id),
    }, h('span', { class: 'dot', style: { background: f.color } }), h('span', {}, h('strong', {}, f.name), h('small', {},
      `${cropName(f.crop)} · ${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}${dist === null ? '' : dist === 0 ? ' · 📍 ' + t('spray.youAreHere') : ` · ${dist < 1000 ? Math.round(dist) + ' m' : fmtNum(dist / 1000, 1) + ' km'}`}`)))));
  };
  const locate = () => {
    gpsBox.replaceChildren(h('span', { class: 'spinner' }), h('span', {}, t('gps.searching')));
    gpsBox.className = 'gps-box searching';
    if (!navigator.geolocation) { gpsBox.className = 'gps-box warn'; gpsBox.replaceChildren(t('gps.unavailable')); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      ranked = rankFields(fields, pos.lng, pos.lat);
      const best = ranked[0];
      gpsBox.className = 'gps-box ok';
      gpsBox.replaceChildren(
        h('span', { class: 'gps-icon' }, '📍'),
        h('span', {}, best.dist === 0 ? t('gps.inside', { name: best.field.name }) : t('gps.nearest', { name: best.field.name, dist: Math.round(best.dist) }),
          h('small', {}, ` (±${Math.round(pos.acc)} m)`)),
        h('button', { type: 'button', class: 'btn small light', onclick: locate }, '↻'));
      if (!existing || !r.fieldId) selectField(best.field.id); else drawChips();
    }, () => {
      gpsBox.className = 'gps-box warn';
      gpsBox.replaceChildren(h('span', {}, '⚠️ ', t('gps.denied')), h('button', { type: 'button', class: 'btn small light', onclick: locate }, t('gps.retry')));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };

  // Felter
  const inp = (k, attrs = {}) => {
    const el = h('input', { class: 'input', value: r[k] ?? '', ...attrs });
    el.addEventListener('input', () => { r[k] = el.value; if (k === 'areaDaa') recalcTotals(); });
    return el;
  };
  areaIn.addEventListener('input', () => { r.areaDaa = areaIn.value; recalcTotals(); });
  cropSel.addEventListener('change', () => { r.crop = cropSel.value; });
  const bbchIn = h('input', { class: 'input big mono', type: 'number', inputmode: 'numeric', min: 0, max: 99, placeholder: '00–99', value: r.bbch });
  const bbchChips = h('div', { class: 'chips wrap' });
  const drawBbch = () => bbchChips.replaceChildren(...BBCH.map((b) => h('button', {
    type: 'button', class: `chip ${r.bbch !== '' && Math.floor(Number(r.bbch) / 10) === b.code ? 'on' : ''}`,
    onclick: () => { r.bbch = String(b.code * 10 + (b.code === 0 ? 0 : 1)).padStart(2, '0'); bbchIn.value = r.bbch; drawBbch(); },
  }, h('strong', {}, String(b.code)), ' ', t(b.key))));
  bbchIn.addEventListener('input', () => { r.bbch = bbchIn.value; drawBbch(); });
  drawBbch();

  // Plantevernmidler
  const known = {};
  for (const s of S.db().sprays) for (const p of s.products || []) if (p.name) known[p.name] = p.regNo;
  const datalist = h('datalist', { id: 'known-products' }, Object.keys(known).map((n) => h('option', { value: n })));
  const prodBox = h('div', { class: 'products' });
  const recalcTotals = () => {
    prodBox.querySelectorAll('.prod-total-auto').forEach((el) => {
      const p = r.products[Number(el.dataset.i)];
      const area = Number(String(r.areaDaa).replace(',', '.')) || 0;
      const dose = Number(String(p.dose).replace(',', '.')) || 0;
      const unit = p.unit.split('/')[0];
      el.textContent = area && dose ? `≈ ${fmtNum(area * dose, 2)} ${unit} ${t('spray.totalFor', { area: fmtNum(area, 1) })}` : '';
    });
  };
  const drawProducts = () => {
    prodBox.replaceChildren(...r.products.map((p, i) => {
      const name = h('input', { class: 'input', list: 'known-products', value: p.name, placeholder: t('spray.productPh') });
      const reg = h('input', { class: 'input mono', value: p.regNo, placeholder: t('spray.regPh') });
      const dose = h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: p.dose, placeholder: '0,0' });
      const unit = h('select', { class: 'input' }, UNITS.map((u) => h('option', { value: u, selected: u === p.unit }, u)));
      name.addEventListener('input', () => { p.name = name.value; if (known[p.name] && !reg.value) { reg.value = known[p.name]; p.regNo = reg.value; } });
      reg.addEventListener('input', () => { p.regNo = reg.value; });
      dose.addEventListener('input', () => { p.dose = dose.value; recalcTotals(); });
      unit.addEventListener('change', () => { p.unit = unit.value; recalcTotals(); });
      return h('div', { class: 'product' },
        h('div', { class: 'prod-head' }, h('strong', {}, `${t('spray.product')} ${i + 1}`),
          r.products.length > 1 ? h('button', { type: 'button', class: 'icon-btn danger', onclick: () => { r.products.splice(i, 1); drawProducts(); } }, '✕') : null),
        h('div', { class: 'form-2' },
          h('label', { class: 'field' }, h('span', {}, t('spray.productName'), ' ', req()), name),
          h('label', { class: 'field' }, h('span', {}, t('spray.regNo'), ' ', req()), reg),
          h('label', { class: 'field' }, h('span', {}, t('spray.dose'), ' ', req()), h('div', { class: 'dose-row' }, dose, unit))),
        h('small', { class: 'prod-total-auto muted', 'data-i': i }));
    }), h('button', { type: 'button', class: 'btn light', onclick: () => { r.products.push({ name: '', regNo: '', dose: '', unit: 'l/daa', total: '' }); drawProducts(); } }, '＋ ', t('spray.addProduct')));
    recalcTotals();
  };
  drawProducts();

  const sel = (k, options) => {
    const el = h('select', { class: 'input' }, h('option', { value: '' }, '–'), options.map(([v, l]) => h('option', { value: v, selected: r[k] === v }, l)));
    el.addEventListener('change', () => { r[k] = el.value; });
    return el;
  };
  const ta = (k, ph) => { const el = h('textarea', { class: 'input', rows: 2, placeholder: ph || '' }, r[k] || ''); el.addEventListener('input', () => { r[k] = el.value; }); return el; };

  const phi = inp('phiDays', { type: 'number', min: 0, inputmode: 'numeric' });
  const phiOut = h('small', { class: 'muted' });
  const updPhi = () => {
    const d = Number(phi.value);
    if (d > 0 && r.date) { const x = new Date(r.date + 'T12:00'); x.setDate(x.getDate() + d); phiOut.textContent = t('spray.harvestFrom', { date: fmtDate(x) }); } else phiOut.textContent = '';
  };
  phi.addEventListener('input', updPhi);
  const dateIn = inp('date', { type: 'date', required: true });
  dateIn.addEventListener('input', updPhi);
  updPhi();

  const errBox = h('div', { class: 'form-errors', hidden: '' });

  const submit = async (e) => {
    e.preventDefault();
    const errors = [];
    const area = Number(String(r.areaDaa).replace(',', '.'));
    if (!r.fieldId) errors.push(t('spray.errField'));
    if (!r.date || !r.startTime) errors.push(t('spray.errDate'));
    if (!r.crop) errors.push(t('spray.errCrop'));
    if (!(area > 0)) errors.push(t('spray.errArea'));
    r.products.forEach((p, i) => {
      if (!p.name.trim() || !p.regNo.trim() || !(Number(String(p.dose).replace(',', '.')) > 0)) errors.push(t('spray.errProduct', { n: i + 1 }));
    });
    if (!r.target.trim()) errors.push(t('spray.errTarget'));
    if (!r.operator?.trim()) errors.push(t('spray.errOperator'));
    if (r.orgOwner && !/^\d{9}$/.test(r.orgOwner.replace(/\s/g, ''))) errors.push(t('spray.errOrg'));
    if (r.orgSprayer && !/^\d{9}$/.test(r.orgSprayer.replace(/\s/g, ''))) errors.push(t('spray.errOrg'));
    if (errors.length) {
      errBox.hidden = false;
      errBox.replaceChildren(h('strong', {}, '⚠️ ', t('spray.errTitle')), h('ul', {}, errors.map((x) => h('li', {}, x))));
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(t('spray.errTitle'), 'error');
      return;
    }
    errBox.hidden = true;
    const f = fields.find((x) => x.id === r.fieldId);
    const record = {
      ...r,
      areaDaa: area,
      fieldName: f.name,
      geometry: f.geometry,
      orgOwner: (r.orgOwner || '').replace(/\s/g, ''),
      orgSprayer: (r.orgSprayer || '').replace(/\s/g, ''),
      products: r.products.map((p) => ({ ...p, dose: Number(String(p.dose).replace(',', '.')), total: Math.round(area * Number(String(p.dose).replace(',', '.')) * 100) / 100 })),
      position: pos,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    S.saveSpray(record);
    // Husk sprøyter og utstyr til neste gang
    S.setSettings({ operatorName: record.operator, authNo: record.authNo, equipment: record.equipment, orgOwner: record.orgOwner || st.orgOwner, orgSprayer: record.orgSprayer || st.orgSprayer });
    await bigResult({ title: t('spray.saved'), lines: [`${f.name} · ${fmtDate(record.date + 'T12:00')}`, record.products.map((p) => p.name).join(', ')], duration: 4000 });
    location.hash = '#/sprayer/journal';
  };
  form.addEventListener('submit', submit);

  form.append(
    datalist,
    section('1', t('spray.where'), req(),
      gpsBox, chips, mapEl,
      h('div', { class: 'form-2' },
        h('label', { class: 'field' }, h('span', {}, t('spray.area'), ' ', req()), h('div', { class: 'input-unit' }, areaIn, h('em', {}, t('unit.daa'))), h('small', { class: 'muted' }, t('spray.areaHelp'))))),
    section('2', t('spray.when'), req(),
      h('div', { class: 'form-3' },
        h('label', { class: 'field' }, h('span', {}, t('spray.date')), dateIn),
        h('label', { class: 'field' }, h('span', {}, t('spray.start')), inp('startTime', { type: 'time', required: true })),
        h('label', { class: 'field' }, h('span', {}, t('spray.end'), ' ', rec()), inp('endTime', { type: 'time' })))),
    section('3', t('spray.cropTitle'), req(),
      h('label', { class: 'field' }, h('span', {}, t('spray.crop'), ' ', req()), cropSel, h('small', { class: 'muted' }, t('spray.cropHelp'))),
      h('div', { class: 'field' }, h('span', {}, t('spray.bbch'), ' ', req(t('spray.reqRelevant'))), bbchChips, bbchIn, h('small', { class: 'muted' }, t('spray.bbchHelp')))),
    section('4', t('spray.products'), req(),
      prodBox,
      h('label', { class: 'field' }, h('span', {}, t('spray.water'), ' ', rec()), h('div', { class: 'input-unit' }, inp('waterPerDaa', { type: 'number', inputmode: 'decimal', min: 0 }), h('em', {}, 'l/daa')))),
    section('5', t('spray.why'), req(),
      h('div', { class: 'form-2' },
        h('label', { class: 'field' }, h('span', {}, t('spray.target'), ' ', req()), inp('target', { placeholder: t('spray.targetPh') })),
        h('label', { class: 'field' }, h('span', {}, t('spray.attack')), sel('attack', [['low', t('spray.attackLow')], ['medium', t('spray.attackMed')], ['high', t('spray.attackHigh')], ['preventive', t('spray.attackPrev')]]))),
      h('label', { class: 'field' }, h('span', {}, t('spray.reason')), ta('reason', t('spray.reasonPh'))),
      h('label', { class: 'field' }, h('span', {}, t('spray.ipm')), ta('ipm', t('spray.ipmPh'))),
      h('small', { class: 'muted' }, t('spray.whyHelp'))),
    section('6', t('spray.who'), req(),
      h('div', { class: 'form-2' },
        h('label', { class: 'field' }, h('span', {}, t('spray.operator'), ' ', req()), inp('operator')),
        h('label', { class: 'field' }, h('span', {}, t('spray.authNo'), ' ', rec()), inp('authNo')),
        h('label', { class: 'field' }, h('span', {}, t('set.orgOwner'), ' ', req(t('spray.reqMattilsynet'))), inp('orgOwner', { inputmode: 'numeric', placeholder: '9 siffer' })),
        h('label', { class: 'field' }, h('span', {}, t('set.orgSprayer'), ' ', req(t('spray.reqMattilsynet'))), inp('orgSprayer', { inputmode: 'numeric', placeholder: '9 siffer' })),
        h('label', { class: 'field' }, h('span', {}, t('set.equipment'), ' ', rec()), inp('equipment')))),
    section('7', t('spray.env'), rec(),
      h('div', { class: 'form-3' },
        h('label', { class: 'field' }, h('span', {}, t('spray.wind')), h('div', { class: 'input-unit' }, inp('wind', { type: 'number', inputmode: 'decimal', min: 0 }), h('em', {}, 'm/s'))),
        h('label', { class: 'field' }, h('span', {}, t('spray.windDir')), sel('windDir', ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'].map((d) => [d, d]))),
        h('label', { class: 'field' }, h('span', {}, t('spray.temp')), h('div', { class: 'input-unit' }, inp('temp', { type: 'number', inputmode: 'decimal' }), h('em', {}, '°C'))),
        h('label', { class: 'field' }, h('span', {}, t('spray.distWater')), h('div', { class: 'input-unit' }, inp('distWater', { type: 'number', inputmode: 'decimal', min: 0 }), h('em', {}, 'm'))),
        h('label', { class: 'field' }, h('span', {}, t('spray.drift')), sel('driftReduction', [['0', t('spray.driftNone')], ['50', '50 %'], ['75', '75 %'], ['90', '90 %']])),
        h('label', { class: 'field' }, h('span', {}, t('spray.phi')), h('div', { class: 'input-unit' }, phi, h('em', {}, t('unit.days'))), phiOut)),
      h('small', { class: 'muted' }, t('spray.envHelp')),
      h('label', { class: 'field' }, h('span', {}, t('spray.notes')), ta('notes'))),
    errBox,
    h('div', { class: 'sticky-submit' }, h('button', { class: 'btn primary xxl', type: 'submit' }, '✓ ', existing ? t('common.save') : t('spray.saveBtn'))),
    lawInfo());

  requestAnimationFrame(() => {
    drawChips();
    if (r.fieldId) selectField(r.fieldId); else map = fieldPreview(mapEl, fields, null, null);
    locate();
  });
  return form;
}

function lawInfo() {
  return h('details', { class: 'card law' },
    h('summary', {}, '§ ', t('law.title')),
    h('p', {}, t('law.p1')),
    h('p', {}, t('law.p2')),
    h('p', {}, t('law.p3')),
    h('ul', { class: 'sources' },
      h('li', {}, h('a', { href: 'https://eur-lex.europa.eu/eli/reg_impl/2023/564/oj', target: '_blank', rel: 'noopener' }, 'Kommisjonens gjennomføringsforordning (EU) 2023/564')),
      h('li', {}, h('a', { href: 'https://eur-lex.europa.eu/eli/reg_impl/2025/2203/oj', target: '_blank', rel: 'noopener' }, 'Gjennomføringsforordning (EU) 2025/2203')),
      h('li', {}, h('a', { href: 'https://europalov.no/rettsakt/plantevernmiddelforordningen-gjennomforingsbestemmelser-om-opplysninger-som-naeringsdrivende-skal/id-30694', target: '_blank', rel: 'noopener' }, 'Europalov: EØS-status for 2023/564')),
      h('li', {}, h('a', { href: 'https://github.com/Mattilsynet/plantevernjournal-innlesing-api', target: '_blank', rel: 'noopener' }, 'Mattilsynet: API for elektronisk plantevernjournal')),
      h('li', {}, h('a', { href: 'https://www.nlr.no/plantevern/plantevernjournal-og-plantevernplaner', target: '_blank', rel: 'noopener' }, 'NLR: Plantevernjournal og plantevernplaner'))));
}

// ---------- Journal ----------
function journal() {
  const list = S.db().sprays.slice().sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  const box = h('div', { class: 'stack' });

  const exportCsv = () => {
    const rows = [['Dato', 'Start', 'Slutt', 'Jorde', 'Kultur', 'EPPO', 'BBCH', 'Areal (daa)', 'Middel', 'Reg.nr', 'Dose', 'Enhet', 'Totalmengde', 'Vann (l/daa)', 'Skadegjører', 'Angrepsgrad', 'Begrunnelse', 'Forebyggende tiltak', 'Utført av', 'Autorisasjonsnr', 'Org.nr eier', 'Org.nr sprøyter', 'Utstyr', 'Vind (m/s)', 'Vindretning', 'Temp (°C)', 'Avstand vann (m)', 'Avdriftsreduksjon (%)', 'Behandlingsfrist (dager)', 'Merknad']];
    for (const s of list) for (const p of s.products) rows.push([s.date, s.startTime, s.endTime, s.fieldName, cropName(s.crop), s.crop, s.bbch, String(s.areaDaa).replace('.', ','), p.name, p.regNo, String(p.dose).replace('.', ','), p.unit, String(p.total).replace('.', ','), s.waterPerDaa, s.target, s.attack, s.reason, s.ipm, s.operator, s.authNo, s.orgOwner, s.orgSprayer, s.equipment, s.wind, s.windDir, s.temp, s.distWater, s.driftReduction, s.phiDays, s.notes]);
    download(`sproytejournal_${S.todayKey()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };
  // Maskinlesbar JSON med feltnavn inspirert av Mattilsynets API (UtendoersBruk)
  const exportJson = () => {
    const out = list.map((s) => ({
      egenReferanse: s.id,
      startTid: new Date(`${s.date}T${s.startTime || '00:00'}`).toISOString(),
      organisasjonsnummerEier: s.orgOwner || null,
      organisasjonsnummerSproeyter: s.orgSprayer || null,
      behandler: { navn: s.operator, autorisasjonsnummer: s.authNo || null },
      arealBehandletOmraade: { verdi: s.areaDaa, enhet: 'daa' },
      behandledeVekster: [{ eppoKode: s.crop, bbch: s.bbch || null }],
      plantevernmiddel: s.products.map((p) => ({ navn: p.name, registreringsnummer: p.regNo, dose: { verdi: p.dose, enhet: p.unit }, totalMengde: { verdi: p.total, enhet: p.unit.split('/')[0] } })),
      behandledeOmraader: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { navn: s.fieldName }, geometry: s.geometry }] },
      begrunnelse: { skadegjoerer: s.target, angrepsgrad: s.attack || null, vurdering: s.reason || null, forebyggendeTiltak: s.ipm || null },
      vaer: { vindMs: s.wind || null, vindretning: s.windDir || null, temperaturC: s.temp || null },
      avstandVannM: s.distWater || null, avdriftsreduksjonProsent: s.driftReduction || null, behandlingsfristDager: s.phiDays || null, utstyr: s.equipment || null, merknad: s.notes || null,
    }));
    download(`sproytejournal_${S.todayKey()}.json`, JSON.stringify(out, null, 2), 'application/json');
  };

  box.append(
    h('div', { class: 'card journal-actions' },
      h('button', { class: 'btn authority xl', onclick: () => infoDialog(t('spray.sendBtn'), t('spray.sendMsg')) }, '📤 ', t('spray.sendBtn')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn light', onclick: exportCsv, disabled: !list.length }, '⬇ CSV'),
        h('button', { class: 'btn light', onclick: exportJson, disabled: !list.length }, '⬇ JSON / GeoJSON'),
        h('button', { class: 'btn light', onclick: () => window.print(), disabled: !list.length }, '🖨 ', t('common.print'))),
      h('p', { class: 'muted small' }, t('spray.keepNote'))),
    list.length ? h('div', { class: 'journal-list printable' }, list.map((s) => h('article', { class: 'card spray-card' },
      h('div', { class: 'spray-top' },
        h('div', { class: 'spray-date' }, h('strong', {}, new Date(s.date + 'T12:00').getDate()), h('span', {}, new Date(s.date + 'T12:00').toLocaleDateString(undefined, { month: 'short' }))),
        h('div', { class: 'spray-main' },
          h('h3', {}, s.fieldName, ' ', h('span', { class: 'muted small' }, `${fmtNum(s.areaDaa, 1)} ${t('unit.daa')}`)),
          h('p', {}, `${cropName(s.crop)} (${s.crop})${s.bbch !== '' && s.bbch !== undefined ? ` · BBCH ${s.bbch}` : ''} · ${s.startTime}${s.endTime ? '–' + s.endTime : ''}`),
          h('div', { class: 'prod-pills' }, s.products.map((p) => h('span', { class: 'pill berry' }, `${p.name} · ${fmtNum(p.dose, 3)} ${p.unit} · ${t('spray.regShort')} ${p.regNo}`))),
          h('p', { class: 'muted small' }, `${t('spray.target')}: ${s.target} · ${t('spray.operator')}: ${s.operator}`)),
        h('div', { class: 'spray-actions no-print' },
          h('button', { class: 'icon-btn', title: t('common.edit'), onclick: () => box.replaceChildren(sprayForm(s)) }, '✎'),
          h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: async () => {
            if (!(await confirmDialog(t('spray.deleteTitle'), t('spray.deleteText'), t('common.delete')))) return;
            S.deleteSpray(s.id); toast(t('common.deleted')); location.hash = '#/sprayer/journal'; window.dispatchEvent(new HashChangeEvent('hashchange'));
          } }, '🗑')))))) : h('div', { class: 'card empty' }, h('span', {}, '📒'), h('p', {}, t('spray.emptyJournal')), h('a', { class: 'btn primary', href: '#/sprayer/new' }, '＋ ', t('spray.new'))));
  return box;
}
