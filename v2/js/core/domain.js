// Forretningslogikk uten avhengighet til nettleser eller lagring (lett å teste i Node).
// Alle funksjoner tar inn data som argumenter: db = { settings, people, fields, varieties, crateTypes, shifts, crates, sprays, products, stock, assignments, pallets }

// ---------- Datoer ----------
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const todayKey = (now = new Date()) => dayKey(now);
export function addDays(key, n) { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return dayKey(d); }
export function shiftYear(key, n) { const [y, m, d] = key.split('-').map(Number); return `${y + n}-${pad(m)}-${pad(Math.min(d, 28 + (m === 2 ? 0 : 3)))}`; }
export const num = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Ubetalt pause i timer: avsluttede pauser (breakMin) pluss en pause som pågår (breakStart). */
export function breakHours(s, now = new Date()) {
  let ms = num(s.breakMin) * 60000;
  if (s.breakStart) ms += Math.max(0, (s.end ? new Date(s.end) : now) - new Date(s.breakStart));
  return ms / 3600000;
}
/** Arbeidstid i timer. Pauser trekkes fra, med mindre gården har valgt at pauser er betalt (paidBreaks). */
export function shiftHours(s, now = new Date(), paidBreaks = false) {
  const end = s.end ? new Date(s.end) : now;
  const gross = Math.max(0, (end - new Date(s.start)) / 3600000);
  return paidBreaks ? gross : Math.max(0, gross - breakHours(s, now));
}
/** Avslutter en pågående pause: gir feltene som skal lagres på vakten. */
export function endBreakPatch(s, now = new Date()) {
  if (!s.breakStart) return null;
  const min = Math.max(0, Math.round((now - new Date(s.breakStart)) / 60000));
  return { breakStart: null, breakMin: num(s.breakMin) + min, lastBreakMin: min };
}

// ---------- Satser ----------
/** Standardverdier for en kasse fra jordet, som kan endres ved registrering. */
export function crateDefaults(db, fieldId) {
  const f = (db.fields || []).find((x) => x.id === fieldId);
  const varieties = db.varieties || [];
  const crateTypes = db.crateTypes || [];
  const varietyId = f?.defaultVarietyId && varieties.some((v) => v.id === f.defaultVarietyId) ? f.defaultVarietyId : (varieties.find((v) => v.crop === f?.crop) || varieties[0])?.id || null;
  const crateTypeId = f?.defaultCrateTypeId && crateTypes.some((c) => c.id === f.defaultCrateTypeId) ? f.defaultCrateTypeId : crateTypes[0]?.id || null;
  return { fieldId: f?.id || null, varietyId, crateTypeId, quality: f?.defaultQuality || '' };
}
/** Kassesats: kassetype > bærsort > standard. Lagres på kassen ved registrering. */
export function crateRate(db, { varietyId, crateTypeId }) {
  const ct = (db.crateTypes || []).find((x) => x.id === crateTypeId);
  if (ct && ct.rate !== undefined && ct.rate !== '' && ct.rate !== null) return num(ct.rate);
  const v = (db.varieties || []).find((x) => x.id === varietyId);
  if (v && v.rate !== undefined && v.rate !== '' && v.rate !== null) return num(v.rate);
  return num(db.settings?.crateRate);
}
export const hourRateFor = (db, person) => (person && person.hourRate !== undefined && person.hourRate !== '' ? num(person.hourRate) : num(db.settings?.hourRate));

// ---------- Dagsoppsummering og lønn ----------
/** { [personId]: { [day]: { hours, crates, crateValue, open, byField: {fieldId: {crates, value}} } } } */
export function dailyStats(db, fromKey, toKey, now = new Date()) {
  const out = {};
  const inRange = (k) => (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
  const slot = (pid, k) => ((out[pid] ??= {})[k] ??= { hours: 0, crates: 0, kg: 0, crateValue: 0, open: false, byField: {} });
  for (const s of db.shifts || []) {
    const k = dayKey(s.start);
    if (!inRange(k)) continue;
    const e = slot(s.personId, k);
    e.hours += shiftHours(s, now, !!db.settings?.paidBreaks);
    if (!s.end) e.open = true;
  }
  for (const c of db.crates || []) {
    const k = dayKey(c.ts);
    if (!inRange(k)) continue;
    const e = slot(c.personId, k);
    const n = num(c.count) || 0;
    const value = n * num(c.rate);
    e.crates += n; e.crateValue += value; e.kg += num(c.weightKg);
    const bf = (e.byField[c.fieldId || ''] ??= { crates: 0, value: 0, kg: 0 });
    bf.crates += n; bf.value += value; bf.kg += num(c.weightKg);
  }
  return out;
}
/** Dagslønn: høyeste av timelønn og kasselønn (samme regel som v1). */
export function dayPay(hours, crateValue, hourRate) {
  const byHour = hours * hourRate;
  const byCrate = crateValue;
  return { byHour, byCrate, pay: Math.max(byHour, byCrate), basis: byCrate > byHour ? 'crate' : 'hour' };
}
export function payReport(db, fromKey, toKey, now = new Date()) {
  const stats = dailyStats(db, fromKey, toKey, now);
  const rows = [];
  for (const p of db.people || []) {
    const days = stats[p.id];
    if (!days) continue;
    const hr = hourRateFor(db, p);
    let hours = 0, crates = 0, kg = 0, pay = 0, byHour = 0, byCrate = 0, crateDays = 0, open = false;
    const keys = Object.keys(days).sort();
    for (const k of keys) {
      const d = days[k];
      const r = dayPay(d.hours, d.crateValue, hr);
      hours += d.hours; crates += d.crates; kg += d.kg; pay += r.pay; byHour += r.byHour; byCrate += r.byCrate;
      if (r.basis === 'crate') crateDays++;
      if (d.open) open = true;
    }
    rows.push({ person: p, days: keys.length, hours, crates, kg, pay, byHour, byCrate, crateDays, open, daily: days, hourRate: hr });
  }
  return rows.sort((a, b) => a.person.name.localeCompare(b.person.name, 'nb'));
}

// ---------- Karenstid ----------
/** Siste dato (dagnøkkel) da høsting fortsatt er sperret etter sprøyting, per jorde. */
export function sprayPhiDays(spray, products = []) {
  let phi = num(spray.phiDays);
  for (const p of spray.products || []) {
    const cat = products.find((x) => x.id === p.productId);
    phi = Math.max(phi, num(p.phiDays ?? cat?.phiDays));
  }
  return phi;
}
/** Høsting tillatt fra og med denne dagen (sprøytedato + karenstid i dager). */
export function harvestAllowedFrom(spray, products = []) {
  const phi = sprayPhiDays(spray, products);
  return phi > 0 ? addDays(spray.date, phi) : spray.date;
}
/** Returnerer aktiv karenstid for et jorde på en gitt dag, eller null. */
export function karensFor(db, fieldId, atKey) {
  let worst = null;
  for (const s of db.sprays || []) {
    if (s.fieldId !== fieldId || !s.date || s.date > atKey) continue;
    const from = harvestAllowedFrom(s, db.products);
    if (atKey < from && (!worst || from > worst.allowedFrom)) worst = { sprayId: s.id, sprayDate: s.date, allowedFrom: from, phiDays: sprayPhiDays(s, db.products), products: (s.products || []).map((p) => p.name).filter(Boolean) };
  }
  return worst;
}

// ---------- Plantevernmidler og lager ----------
const UNIT_FACTOR = { 'l/daa': [1, 'l'], 'ml/daa': [0.001, 'l'], 'kg/daa': [1, 'kg'], 'g/daa': [0.001, 'kg'], 'l/ha': [0.1, 'l'], 'kg/ha': [0.1, 'kg'], 'ml/ha': [0.0001, 'l'], 'g/ha': [0.0001, 'kg'] };
export const DOSE_UNITS = Object.keys(UNIT_FACTOR);
/** Total mengde (i l eller kg) for en dose over et areal i dekar. */
export function totalAmount(dose, unit, areaDaa) {
  const [f, base] = UNIT_FACTOR[unit] || [1, unit?.split('/')[0] || ''];
  return { qty: round(num(dose) * f * num(areaDaa), 4), unit: base };
}
/** Lagerbevegelser som en sprøyting skal trekke fra lageret. Id-ene er faste, så endring av sprøyting oppdaterer samme post. */
export function stockUseFromSpray(spray) {
  return (spray.products || []).map((p, i) => {
    if (!p.productId) return null;
    const { qty, unit } = totalAmount(p.dose, p.unit, spray.areaDaa);
    return { id: `use-${spray.id}-${i}`, productId: p.productId, ts: `${spray.date}T${spray.startTime || '12:00'}:00`, type: 'use', qty: -qty, unit, sprayId: spray.id, note: spray.fieldName || '' };
  }).filter(Boolean);
}
export function stockBalance(db) {
  const out = {};
  for (const p of db.products || []) out[p.id] = { product: p, purchased: 0, used: 0, adjusted: 0, balance: 0, unit: p.unit || '' };
  for (const m of db.stock || []) {
    const o = (out[m.productId] ??= { product: null, purchased: 0, used: 0, adjusted: 0, balance: 0, unit: m.unit || '' });
    const q = num(m.qty);
    if (m.type === 'purchase') o.purchased += q;
    else if (m.type === 'use') o.used += -q;
    else o.adjusted += q;
    o.balance += q;
  }
  for (const o of Object.values(out)) { o.purchased = round(o.purchased, 3); o.used = round(o.used, 3); o.adjusted = round(o.adjusted, 3); o.balance = round(o.balance, 3); }
  return out;
}

// ---------- Formannsvisning ----------
export function foremanSnapshot(db, now = new Date()) {
  const today = dayKey(now);
  const people = new Map((db.people || []).map((p) => [p.id, p]));
  const working = new Map();
  for (const s of db.shifts || []) {
    if (s.end || dayKey(s.start) !== today) continue;
    working.set(s.personId, { person: people.get(s.personId), since: s.start, fieldId: null, crates: 0, lastCrate: null });
  }
  const assign = {};
  for (const a of db.assignments || []) if (a.date === today) assign[a.personId] = a.fieldId;
  const fields = {};
  const perPerson = {};
  let total = 0;
  for (const c of db.crates || []) {
    if (dayKey(c.ts) !== today) continue;
    const n = num(c.count);
    total += n;
    perPerson[c.personId] = (perPerson[c.personId] || 0) + n;
    const f = (fields[c.fieldId || ''] ??= { crates: 0, kg: 0, people: new Set() });
    f.crates += n; f.kg += num(c.weightKg); f.people.add(c.personId);
    const w = working.get(c.personId);
    if (w && (!w.lastCrate || c.ts > w.lastCrate)) { w.lastCrate = c.ts; w.fieldId = c.fieldId; }
  }
  for (const [pid, w] of working) { w.crates = perPerson[pid] || 0; w.assignedFieldId = assign[pid] || null; if (!w.fieldId) w.fieldId = w.assignedFieldId; }
  const alerts = (db.alerts || []).filter((a) => dayKey(a.ts) === today);
  return { today, working: [...working.values()].filter((w) => w.person).sort((a, b) => b.crates - a.crates), fields, total, perPerson, alerts };
}

// ---------- Nøkkeltall per jorde og sort ----------
/** Fordeler dagslønn på jorder i forhold til kasseverdien levert fra hvert jorde den dagen. */
export function fieldKpis(db, fromKey, toKey, now = new Date()) {
  const stats = dailyStats(db, fromKey, toKey, now);
  const out = {}; // key fieldId|varietyId
  const fieldById = new Map((db.fields || []).map((f) => [f.id, f]));
  const row = (fieldId, varietyId) => (out[`${fieldId || ''}|${varietyId || ''}`] ??= { fieldId: fieldId || null, varietyId: varietyId || null, crates: 0, kg: 0, laborCost: 0, areaDaa: num(fieldById.get(fieldId)?.areaDaa) });
  const inRange = (k) => (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
  for (const c of db.crates || []) { const k = dayKey(c.ts); if (!inRange(k)) continue; const r = row(c.fieldId, c.varietyId); r.crates += num(c.count); r.kg += num(c.weightKg); }
  // Lønn per plukker-dag fordeles på kassene den dagen
  const people = new Map((db.people || []).map((p) => [p.id, p]));
  let unallocated = 0;
  for (const [pid, days] of Object.entries(stats)) {
    const hr = hourRateFor(db, people.get(pid));
    for (const [k, d] of Object.entries(days)) {
      const pay = dayPay(d.hours, d.crateValue, hr).pay;
      if (!d.crates) { unallocated += pay; continue; }
      const dayCrates = (db.crates || []).filter((c) => c.personId === pid && dayKey(c.ts) === k);
      const totalValue = dayCrates.reduce((a, c) => a + num(c.count) * num(c.rate), 0);
      const totalCount = dayCrates.reduce((a, c) => a + num(c.count), 0);
      for (const c of dayCrates) {
        const share = totalValue > 0 ? (num(c.count) * num(c.rate)) / totalValue : num(c.count) / totalCount;
        row(c.fieldId, c.varietyId).laborCost += pay * share;
      }
    }
  }
  const rows = Object.values(out).map((r) => ({ ...r, cratesPerDaa: r.areaDaa ? r.crates / r.areaDaa : null, costPerCrate: r.crates ? r.laborCost / r.crates : null }));
  return { rows, unallocated };
}
/** Sammenligner nøkkeltall med samme periode året før. */
export function kpiCompare(db, fromKey, toKey, now = new Date()) {
  const cur = fieldKpis(db, fromKey, toKey, now);
  const prev = fieldKpis(db, shiftYear(fromKey, -1), shiftYear(toKey, -1), now);
  const pmap = new Map(prev.rows.map((r) => [`${r.fieldId}|${r.varietyId}`, r]));
  return { ...cur, rows: cur.rows.map((r) => ({ ...r, prev: pmap.get(`${r.fieldId}|${r.varietyId}`) || null })), prevRows: prev.rows };
}

// ---------- Spillelementer for plukkere ----------
export const BADGES = [
  { at: 1, key: 'badge.first', icon: 'sprout' }, { at: 10, key: 'badge.ten', icon: 'leaf' }, { at: 25, key: 'badge.25', icon: 'star' },
  { at: 50, key: 'badge.50', icon: 'award' }, { at: 75, key: 'badge.75', icon: 'flame' }, { at: 100, key: 'badge.100', icon: 'trophy' },
];
export function personSummary(db, personId, now = new Date()) {
  const today = dayKey(now);
  const perDay = {};
  for (const c of db.crates || []) if (c.personId === personId) { const k = dayKey(c.ts); perDay[k] = (perDay[k] || 0) + num(c.count); }
  const todayCrates = perDay[today] || 0;
  const pastBest = Math.max(0, ...Object.entries(perDay).filter(([k]) => k !== today).map(([, v]) => v));
  const total = Object.values(perDay).reduce((a, b) => a + b, 0);
  let streak = 0;
  let k = perDay[today] ? today : addDays(today, -1);
  while (perDay[k]) { streak++; k = addDays(k, -1); }
  const todayHours = (db.shifts || []).filter((s) => s.personId === personId && dayKey(s.start) === today).reduce((a, s) => a + shiftHours(s, now, !!db.settings?.paidBreaks), 0);
  return { todayCrates, pastBest, total, streak, todayHours };
}

// ---------- Gjødsling ----------
/** Sum næringsstoff (kg) per jorde for en periode: { [fieldId]: { n, p, k, areaDaa, count } } */
export function nutrientTotals(db, fromKey, toKey) {
  const out = {};
  for (const f of db.fertilizations || []) {
    if (!f.date || (fromKey && f.date < fromKey) || (toKey && f.date > toKey)) continue;
    const o = (out[f.fieldId || ''] ??= { n: 0, p: 0, k: 0, count: 0 });
    const area = num(f.areaDaa);
    o.n += num(f.nPerDaa) * area; o.p += num(f.pPerDaa) * area; o.k += num(f.kPerDaa) * area; o.count++;
  }
  for (const o of Object.values(out)) { o.n = round(o.n, 1); o.p = round(o.p, 1); o.k = round(o.k, 1); }
  return out;
}
/** Næringsstoff per dekar fra mengde per dekar og innhold i prosent (mineralgjødsel) eller kg per tonn/m³ (husdyrgjødsel). */
export function nutrientPerDaa(amountPerDaa, content, basis = 'pct') {
  const a = num(amountPerDaa), c = num(content);
  return round(basis === 'pct' ? a * c / 100 : a * c, 2);
}

// ---------- Leveranser ----------
export function deliveryTotals(d) {
  let kg = 0, crates = 0, value = 0;
  for (const l of d.lines || []) { kg += num(l.kg); crates += num(l.crates); value += num(l.kg) * num(l.pricePerKg); }
  return { kg: round(kg, 1), crates, value: round(value, 2) };
}
/** Neste ledige følgeseddelnummer for året: «2026-0007». */
export function nextDeliveryNo(deliveries, year) {
  let max = 0;
  for (const d of deliveries || []) { const m = String(d.no || '').match(/^(\d{4})-(\d+)$/); if (m && Number(m[1]) === Number(year)) max = Math.max(max, Number(m[2])); }
  return `${year}-${String(max + 1).padStart(4, '0')}`;
}

// ---------- Vær: frost og sprøyteforhold fra MET-varselet ----------
/** Sammendrag av varselet de neste timene: laveste temperatur, frosttimer og timer med gode sprøyteforhold. */
export function weatherOutlook(json, now = new Date(), hours = 48, limits = { maxWind: 3, maxPrecip: 0.1 }) {
  const series = (json?.properties?.timeseries || []).filter((s) => { const d = new Date(s.time) - now; return d >= -3600000 && d <= hours * 3600000; });
  if (!series.length) return null;
  let min = null; const frost = []; const spray = [];
  for (const s of series) {
    const det = s.data?.instant?.details || {};
    const tC = det.air_temperature;
    if (typeof tC === 'number') { if (!min || tC < min.temp) min = { temp: tC, time: s.time }; if (tC <= 0) frost.push(s.time); }
    const pr = s.data?.next_1_hours?.details?.precipitation_amount;
    if (typeof det.wind_speed === 'number' && typeof pr === 'number' && det.wind_speed <= limits.maxWind && pr <= limits.maxPrecip && typeof tC === 'number' && tC > 0) spray.push(s.time);
  }
  return { min, frostHours: frost.length, firstFrost: frost[0] || null, sprayHours: spray.length, nextSpray: spray[0] || null, hours, updated: json?.properties?.meta?.updated_at || null };
}
