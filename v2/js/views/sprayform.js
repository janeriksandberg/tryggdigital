// Sprøyteskjema (brukes både av sprøyteren på nettbrettet og av administrator). Lagring trekker automatisk
// brukt mengde fra lageret (faste id-er, så en endret sprøyting oppdaterer de samme lagerpostene).
import { t } from '../i18n.js';
import { h, icon, toast, fmtNum, fmtDate, fmtDateTime, clear, feedback } from '../ui.js';
import * as store from '../core/store.js';
import * as D from '../core/domain.js';
import { cropName } from '../core/crops.js';
import { centroid, fetchForecast, compass, CREDIT } from '../core/weather.js';

/** Lagrer en sprøyting og oppdaterer lagerbevegelsene den gir. Returnerer lagret dokument. */
export function saveSpray(data, by) {
  const s = store.put('sprays', data, by);
  const uses = D.stockUseFromSpray(s);
  const keep = new Set(uses.map((u) => u.id));
  for (const u of uses) store.put('stock', u, by);
  for (const m of store.all('stock')) if (m.sprayId === s.id && !keep.has(m.id)) store.remove('stock', m.id, by);
  if (s.taskId) { const task = store.get('tasks', s.taskId); if (task && task.status !== 'done') store.patch('tasks', task.id, { status: 'done', sprayId: s.id, doneAt: new Date().toISOString() }, by); }
  return s;
}
export function deleteSpray(id, by) {
  for (const m of store.all('stock')) if (m.sprayId === id) store.remove('stock', m.id, by);
  store.remove('sprays', id, by);
}

const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * Tegner skjemaet i `host`. opts: { spray?, task?, operator?: person, by, onDone(saved|null), compact }
 * Skjemaet er laget for store fingre: valg med brikker, få fritekstfelt, tydelig bekreftelse av været.
 */
export function sprayForm(host, { spray = null, task = null, operator = null, by, onDone, admin = false }) {
  const fields = store.all('fields').filter((f) => f.active !== false || f.id === spray?.fieldId);
  const products = store.all('products').filter((p) => p.active !== false || spray?.products?.some((x) => x.productId === p.id));
  const people = store.all('people').filter((p) => (p.roles || []).includes('sprayer'));
  const st = spray ? structuredClone(spray) : {
    fieldId: task?.fieldId || '', date: D.todayKey(), startTime: nowTime(), endTime: '',
    products: (task?.productIds || []).map((pid) => fromProduct(products.find((p) => p.id === pid))).filter(Boolean),
    target: task?.target || '', operatorId: operator?.id || task?.assigneeId || '', operator: operator?.name || '', certNo: operator?.certNo || '',
    equipment: '', waterLPerDaa: '', notes: task?.note || '', weather: null, taskId: task?.id || null,
  };
  st.weather ??= null;
  let wxState = st.weather ? 'done' : 'idle', wxErr = '';

  function fromProduct(p) { return p ? { productId: p.id, name: p.name, regNo: p.regNo || '', dose: p.defaultDose ?? '', unit: p.defaultUnit || (p.unit === 'kg' ? 'kg/daa' : 'l/daa'), phiDays: p.phiDays ?? 0 } : null; }
  const field = () => fields.find((f) => f.id === st.fieldId);

  async function loadWeather() {
    const f = field();
    const c = f?.geometry ? centroid(f.geometry) : null;
    if (!c) { wxState = 'nogeo'; draw(); return; }
    if (!navigator.onLine) { wxState = 'offline'; draw(); return; }
    wxState = 'loading'; draw();
    try {
      const at = new Date(`${st.date}T${st.startTime || nowTime()}:00`);
      const w = await fetchForecast(c.lat, c.lon, at);
      if (!w) throw new Error('empty');
      st.weather = { temp: w.temp, wind: w.wind, gust: w.gust, windDir: w.windDir, humidity: w.humidity, precip1h: w.precip1h, source: w.source, forecastTime: w.time, fetchedAt: new Date().toISOString(), forecast: true, confirmed: false };
      wxState = 'done';
    } catch (e) { wxState = 'error'; wxErr = e.message; }
    draw();
  }

  const chip = (on, label, onclick, extra = {}) => h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, onclick: () => { feedback('tap'); onclick(); }, ...extra }, label);
  const lbl = (text) => h('span', { class: 'field-label' }, text);
  const inp = (key, attrs = {}, obj = st) => h('input', { class: 'input', value: obj[key] ?? '', oninput: (e) => { obj[key] = e.target.value; }, ...attrs });

  function draw() {
    const f = field();
    const area = D.num(f?.areaDaa);
    const phi = D.sprayPhiDays(st, products);
    const w = st.weather;
    clear(host, 
      // 1. Jorde
      h('section', { class: 'card stack' },
        h('h3', {}, h('span', { class: 'step-no' }, '1'), t('spray.field')),
        fields.length ? h('div', { class: 'pick-row' }, fields.map((x) => chip(x.id === st.fieldId, h('span', {}, h('span', { class: 'dot', style: { background: x.color } }), ' ', x.name, h('small', {}, `${cropName(x.crop)} · ${fmtNum(x.areaDaa, 1)} ${t('unit.daa')}`)), () => {
          if (st.fieldId !== x.id) { st.fieldId = x.id; st.weather = null; wxState = 'idle'; }
          draw(); if (!st.weather) loadWeather();
        }, { 'data-pick': `field:${x.name}` }))) : h('p', { class: 'muted' }, t('crate.noFieldsText')),
        h('div', { class: 'form-grid' },
          h('label', { class: 'field' }, lbl(t('common.date')), inp('date', { type: 'date', name: 'date', onchange: (e) => { st.date = e.target.value; } })),
          h('label', { class: 'field' }, lbl(t('spray.start')), inp('startTime', { type: 'time', name: 'start' })),
          h('label', { class: 'field' }, lbl(t('spray.end')), inp('endTime', { type: 'time', name: 'end' })))),
      // 2. Midler
      h('section', { class: 'card stack' },
        h('h3', {}, h('span', { class: 'step-no' }, '2'), t('spray.products')),
        products.length ? h('div', { class: 'pick-row' }, products.map((p) => {
          const on = st.products.some((x) => x.productId === p.id);
          return chip(on, h('span', {}, p.name, h('small', {}, `${t('spray.phi')}: ${p.phiDays ?? 0} ${t('unit.days')}`)), () => {
            if (on) st.products = st.products.filter((x) => x.productId !== p.id); else st.products.push(fromProduct(p));
            draw();
          }, { 'data-pick': `product:${p.name}` });
        })) : h('div', { class: 'notice warn' }, icon('info'), h('p', {}, t('spray.noProducts'))),
        st.products.map((x) => {
          const totalText = () => { const r = D.totalAmount(x.dose, x.unit, area); return area ? t('spray.total', { qty: fmtNum(r.qty, 2), unit: r.unit, area: fmtNum(area, 1) }) : t('spray.noArea'); };
          const totEl = h('div', { class: 'small muted', style: { flexBasis: '100%' }, 'data-total': '' }, totalText());
          return h('div', { class: 'dose-row', 'data-dose': x.name },
            h('strong', { class: 'grow' }, x.name, x.regNo ? h('small', { class: 'muted' }, ` · ${t('products.regNo')} ${x.regNo}`) : null),
            h('label', { class: 'field' }, lbl(t('spray.dose')), h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: x.dose, name: 'dose', oninput: (e) => { x.dose = e.target.value; totEl.textContent = totalText(); } })),
            h('label', { class: 'field' }, lbl(t('spray.unit')), h('select', { class: 'input', name: 'unit', onchange: (e) => { x.unit = e.target.value; totEl.textContent = totalText(); } }, D.DOSE_UNITS.map((u) => h('option', { value: u, selected: u === x.unit }, u)))),
            totEl);
        }),
        h('div', { class: 'form-grid' },
          h('label', { class: 'field' }, lbl(t('spray.target')), inp('target', { name: 'target', list: 'spray-targets', placeholder: t('spray.targetPh') })),
          h('label', { class: 'field' }, lbl(t('spray.water')), inp('waterLPerDaa', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', name: 'water' })),
          h('label', { class: 'field' }, lbl(t('spray.equipment')), inp('equipment', { name: 'equipment', placeholder: t('spray.equipmentPh') }))),
        h('datalist', { id: 'spray-targets' }, [...new Set(store.all('sprays').map((s) => s.target).filter(Boolean))].slice(0, 30).map((x) => h('option', { value: x }))),
        phi ? h('div', { class: 'notice warn', 'data-phi': phi }, icon('clock'), h('p', {}, t('spray.phiInfo', { days: phi, date: fmtDate(D.addDays(st.date, phi)) }))) : null),
      // 3. Vær
      h('section', { class: `card stack wx ${w?.confirmed ? 'ok' : ''}`, 'data-weather': wxState },
        h('h3', {}, h('span', { class: 'step-no' }, '3'), t('spray.weather')),
        wxState === 'loading' ? h('p', { class: 'row' }, h('span', { class: 'spinner' }), t('spray.wxLoading')) : null,
        wxState === 'offline' ? h('div', { class: 'notice warn' }, icon('cloudOff'), h('p', {}, t('spray.wxOffline'))) : null,
        wxState === 'nogeo' ? h('div', { class: 'notice warn' }, icon('map'), h('p', {}, t('spray.wxNoGeo'))) : null,
        wxState === 'error' ? h('div', { class: 'notice warn' }, icon('alert'), h('p', {}, t('spray.wxError'), ' ', wxErr)) : null,
        w?.forecast ? h('p', { class: 'small muted' }, t('spray.wxForecastNote', { time: w.forecastTime ? fmtDateTime(w.forecastTime) : '' })) : null,
        h('div', { class: 'form-grid' },
          wxInput('temp', t('spray.temp'), '°C'), wxInput('wind', t('spray.wind'), 'm/s'), wxInput('gust', t('spray.gust'), 'm/s'),
          h('label', { class: 'field' }, lbl(t('spray.windDir')), h('select', { class: 'input', name: 'windDir', onchange: (e) => { ensureWx(); st.weather.windDir = e.target.value === '' ? null : Number(e.target.value); st.weather.confirmed = false; draw(); } },
            h('option', { value: '' }, '–'), [0, 45, 90, 135, 180, 225, 270, 315].map((d) => h('option', { value: d, selected: w?.windDir != null && Math.round(w.windDir / 45) % 8 * 45 === d }, compass(d))))),
          wxInput('humidity', t('spray.humidity'), '%'), wxInput('precip1h', t('spray.precip'), 'mm')),
        h('label', { class: 'check big-check' }, h('input', { type: 'checkbox', name: 'wxConfirm', checked: !!w?.confirmed, onchange: (e) => { ensureWx(); st.weather.confirmed = e.target.checked; st.weather.confirmedAt = new Date().toISOString(); draw(); } }), t('spray.wxConfirm')),
        h('div', { class: 'row wrap' },
          h('button', { type: 'button', class: 'btn small light', onclick: loadWeather, disabled: wxState === 'loading' || null }, icon('sync', 16), t('spray.wxFetch')),
          h('span', { class: 'small muted grow' }, CREDIT))),
      // 4. Utført av
      h('section', { class: 'card stack' },
        h('h3', {}, h('span', { class: 'step-no' }, '4'), t('spray.operator')),
        operator && !admin ? h('p', {}, h('strong', {}, operator.name), operator.certNo ? ` · ${t('people.certNo')} ${operator.certNo}` : '')
          : h('div', { class: 'pick-row' }, people.map((p) => chip(p.id === st.operatorId, p.name, () => { st.operatorId = p.id; st.operator = p.name; st.certNo = p.certNo || ''; draw(); }))),
        h('label', { class: 'field' }, lbl(t('spray.notes')), h('textarea', { class: 'input', rows: 2, name: 'notes', oninput: (e) => { st.notes = e.target.value; } }, st.notes || ''))),
      h('div', { class: 'sticky-action' }, h('div', { class: 'inner' },
        h('button', { class: 'btn light xl', type: 'button', onclick: () => onDone?.(null) }, t('common.cancel')),
        h('button', { class: 'btn primary xxl', type: 'button', 'data-act': 'save-spray', onclick: save }, icon('check', 26), t('spray.save')))),
    );
  }
  function ensureWx() { st.weather ??= { forecast: false, confirmed: false, source: 'manual' }; }
  function wxInput(key, label, unit) {
    return h('label', { class: 'field' }, lbl(`${label} (${unit})`), h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: 'any', name: key, value: st.weather?.[key] ?? '', oninput: (e) => {
      ensureWx(); st.weather[key] = e.target.value === '' ? null : D.num(e.target.value);
      if (st.weather.confirmed) { st.weather.confirmed = false; const cb = host.querySelector('[name=wxConfirm]'); if (cb) cb.checked = false; host.querySelector('.wx')?.classList.remove('ok'); }
    } }));
  }

  function save() {
    const f = field();
    const err = !f ? t('spray.errField') : !st.products.length ? t('spray.errProduct') : st.products.some((x) => !(D.num(x.dose) > 0)) ? t('spray.errDose')
      : !st.weather?.confirmed ? t('spray.errWeather') : !st.operatorId && !st.operator ? t('spray.errOperator') : !st.date ? t('spray.errDate') : null;
    if (err) { feedback('error'); toast(err, 'error'); return; }
    const data = {
      ...st, fieldName: f.name, crop: f.crop, areaDaa: D.num(f.areaDaa),
      products: st.products.map((x) => ({ ...x, dose: D.num(x.dose), phiDays: D.num(x.phiDays) })),
      phiDays: D.sprayPhiDays({ products: st.products }, products),
      waterLPerDaa: st.waterLPerDaa === '' ? null : D.num(st.waterLPerDaa),
    };
    const saved = saveSpray(data, by);
    feedback('success');
    onDone?.(saved);
  }

  draw();
  if (!spray && st.fieldId && !st.weather) loadWeather();
}
