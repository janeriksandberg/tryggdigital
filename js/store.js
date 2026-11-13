// Tryggdigital – datalag. All data lagres lokalt i nettleseren (localStorage).
const KEY = 'tryggdigital.v1';

const defaults = () => ({
  version: 1,
  settings: {
    hourRate: 200,      // kr per time (grunnlag for minimumslønn per dag)
    crateRate: 35,      // kr per kasse
    farmName: '',
    orgOwner: '',       // organisasjonsnummer eier av arealet
    orgSprayer: '',     // organisasjonsnummer for den som sprøyter
    operatorName: '',
    authNo: '',
    equipment: '',
  },
  workers: [],
  shifts: [],
  crates: [],
  fields: [],
  sprays: [],
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = JSON.parse(raw);
    const base = defaults();
    return { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  } catch (e) {
    console.warn('Kunne ikke lese lagrede data', e);
    return defaults();
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Lagring feilet', e);
  }
  listeners.forEach((fn) => fn(state));
}

export const db = () => state;
export const onChange = (fn) => listeners.add(fn);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function replaceAll(data) {
  const base = defaults();
  state = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  save();
}
export function resetAll() {
  state = defaults();
  save();
}

// ---------- Plukkere ----------
export function newWorkerCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = 'TD-';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (state.workers.some((w) => w.code === code));
  return code;
}
export const workerByCode = (code) =>
  state.workers.find((w) => w.code.trim().toLowerCase() === String(code).trim().toLowerCase());
export const workerById = (id) => state.workers.find((w) => w.id === id);

export function addWorker(name, code) {
  const w = { id: uid(), name: name.trim(), code: (code || newWorkerCode()).trim(), active: true, createdAt: new Date().toISOString() };
  state.workers.push(w);
  save();
  return w;
}
export function updateWorker(id, patch) {
  const w = workerById(id);
  if (w) Object.assign(w, patch);
  save();
}
export function deleteWorker(id) {
  state.workers = state.workers.filter((w) => w.id !== id);
  state.shifts = state.shifts.filter((s) => s.workerId !== id);
  state.crates = state.crates.filter((c) => c.workerId !== id);
  save();
}

// ---------- Tid og kasser ----------
export const openShift = (workerId) => state.shifts.find((s) => s.workerId === workerId && !s.end);

export function clockIn(workerId, at = new Date()) {
  const s = { id: uid(), workerId, start: at.toISOString(), end: null };
  state.shifts.push(s);
  save();
  return s;
}
export function clockOut(workerId, at = new Date()) {
  const s = openShift(workerId);
  if (!s) return null;
  s.end = at.toISOString();
  save();
  return s;
}
export function addCrates(workerId, count, at = new Date()) {
  const c = { id: uid(), workerId, ts: at.toISOString(), count };
  state.crates.push(c);
  save();
  return c;
}
export function updateShift(id, patch) {
  const s = state.shifts.find((x) => x.id === id);
  if (s) Object.assign(s, patch);
  save();
}
export function deleteShift(id) {
  state.shifts = state.shifts.filter((s) => s.id !== id);
  save();
}
export function updateCrate(id, patch) {
  const c = state.crates.find((x) => x.id === id);
  if (c) Object.assign(c, patch);
  save();
}
export function deleteCrate(id) {
  state.crates = state.crates.filter((c) => c.id !== id);
  save();
}

// ---------- Dato-hjelpere ----------
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const todayKey = () => dayKey(new Date());

export function shiftHours(s, now = new Date()) {
  const end = s.end ? new Date(s.end) : now;
  return Math.max(0, (end - new Date(s.start)) / 3600000);
}

// Oppsummering per plukker per dag: { [workerId]: { [day]: {hours, crates, open} } }
export function dailyStats(fromKey, toKey, now = new Date()) {
  const out = {};
  const inRange = (k) => (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
  const slot = (wid, k) => {
    out[wid] ??= {};
    return (out[wid][k] ??= { hours: 0, crates: 0, open: false });
  };
  for (const s of state.shifts) {
    const k = dayKey(s.start);
    if (!inRange(k)) continue;
    const e = slot(s.workerId, k);
    e.hours += shiftHours(s, now);
    if (!s.end) e.open = true;
  }
  for (const c of state.crates) {
    const k = dayKey(c.ts);
    if (!inRange(k)) continue;
    slot(c.workerId, k).crates += c.count;
  }
  return out;
}

// Lønn for én dag: det høyeste av timelønn og kasselønn.
export function dayPay(hours, crates, st = state.settings) {
  const byHour = hours * Number(st.hourRate || 0);
  const byCrate = crates * Number(st.crateRate || 0);
  return { byHour, byCrate, pay: Math.max(byHour, byCrate), basis: byCrate > byHour ? 'crate' : 'hour' };
}

export function payReport(fromKey, toKey) {
  const stats = dailyStats(fromKey, toKey);
  const rows = [];
  for (const w of state.workers) {
    const days = stats[w.id] || {};
    let hours = 0, crates = 0, pay = 0, byHour = 0, byCrate = 0, crateDays = 0, open = false;
    const dayList = Object.keys(days).sort();
    for (const k of dayList) {
      const d = days[k];
      const p = dayPay(d.hours, d.crates);
      hours += d.hours; crates += d.crates; pay += p.pay; byHour += p.byHour; byCrate += p.byCrate;
      if (p.basis === 'crate') crateDays++;
      if (d.open) open = true;
    }
    if (!dayList.length) continue;
    rows.push({ worker: w, days: dayList.length, hours, crates, pay, byHour, byCrate, crateDays, open, daily: days });
  }
  return rows.sort((a, b) => a.worker.name.localeCompare(b.worker.name, 'nb'));
}

// Plukkerens egne tall (for gamification)
export function workerSummary(workerId) {
  const today = todayKey();
  const perDay = {};
  for (const c of state.crates) if (c.workerId === workerId) perDay[dayKey(c.ts)] = (perDay[dayKey(c.ts)] || 0) + c.count;
  const todayCrates = perDay[today] || 0;
  const pastBest = Math.max(0, ...Object.entries(perDay).filter(([k]) => k !== today).map(([, v]) => v));
  const total = Object.values(perDay).reduce((a, b) => a + b, 0);
  // dager på rad med minst én kasse (bakover fra i dag eller i går)
  let streak = 0;
  const d = new Date();
  if (!perDay[today]) d.setDate(d.getDate() - 1);
  while (perDay[dayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
  const todayHours = state.shifts.filter((s) => s.workerId === workerId && dayKey(s.start) === today).reduce((a, s) => a + shiftHours(s), 0);
  return { todayCrates, pastBest, total, streak, todayHours };
}

// ---------- Jorder ----------
export function saveField(f) {
  const i = state.fields.findIndex((x) => x.id === f.id);
  if (i >= 0) state.fields[i] = f; else state.fields.push(f);
  save();
}
export function deleteField(id) {
  state.fields = state.fields.filter((f) => f.id !== id);
  save();
}

// ---------- Sprøyting ----------
export function saveSpray(s) {
  const i = state.sprays.findIndex((x) => x.id === s.id);
  if (i >= 0) state.sprays[i] = s; else state.sprays.push(s);
  save();
}
export function deleteSpray(id) {
  state.sprays = state.sprays.filter((s) => s.id !== id);
  save();
}
export function setSettings(patch) {
  Object.assign(state.settings, patch);
  save();
}
