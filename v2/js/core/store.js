// Lokal database for én kunde (tenant). All lesing i appen skjer herfra, så appen virker helt uten nett.
// Endringer får et HLC-versjonsstempel og legges i «utboksen», som synk-motoren sender til Firestore
// og som deles direkte med andre enheter på samme nettverk (lan.js). Ved konflikt vinner høyeste versjon.
import * as idb from './idb.js';
import * as hlc from './hlc.js';
import { COLLECTION_NAMES, isAdminCollection } from './schema.js';

const LAN_PUSH_DELAY = 10 * 60 * 1000; // data mottatt fra naboenhet sendes sentralt bare hvis den ikke dukker opp der selv

let tenant = null;
let mem = new Map(); // c -> Map(id -> doc)
const listeners = new Set();
const outListeners = new Set();
let bc = null;
let outboxCount = 0;
let writeChain = Promise.resolve();

export const tenantId = () => tenant;
export const isOpen = () => !!tenant;

export function randomId(len = 20) {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const x of b) s += a[x % 62];
  return s;
}

export async function openTenant(t, nodeId) {
  hlc.initClock(nodeId, await idb.kvGet('hlc'));
  tenant = t;
  mem = new Map(COLLECTION_NAMES.map((c) => [c, new Map()]));
  const rows = await idb.allByTenant('docs', t);
  for (const r of rows) mem.get(r.c)?.set(r.id, r.d);
  outboxCount = (await idb.allByTenant('outbox', t)).length;
  try {
    bc?.close();
    bc = new BroadcastChannel('td2-store');
    bc.onmessage = (e) => { if (e.data?.t === tenant) applyFromPeerTab(e.data); };
  } catch { bc = null; }
  emit({ type: 'reset' });
  emitOut();
}
export function closeTenant() {
  tenant = null;
  mem = new Map();
  bc?.close();
  bc = null;
  emit({ type: 'reset' });
}

// ---------- Lesing ----------
export function get(c, id) {
  const d = mem.get(c)?.get(id);
  return d && !d._del ? d : null;
}
export function getRaw(c, id) { return mem.get(c)?.get(id) || null; }
export function all(c) {
  const m = mem.get(c);
  if (!m) return [];
  const out = [];
  for (const d of m.values()) if (!d._del) out.push(d);
  return out;
}
export function allRaw(c) { return [...(mem.get(c)?.values() || [])]; }
export const settings = () => get('settings', 'main') || { id: 'main' };

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onOutbox(fn) { outListeners.add(fn); fn(outboxCount); return () => outListeners.delete(fn); }
export const pendingCount = () => outboxCount;
function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }
function emitOut() { for (const fn of outListeners) { try { fn(outboxCount); } catch (e) { console.error(e); } } }

// ---------- Skriving ----------
const clean = (data) => {
  const o = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined && k !== '_srv') o[k] = v;
  return o;
};

/** Lagrer et dokument lokalt (med ny versjon) og legger det i utboksen. Returnerer dokumentet. */
export function put(c, data, by = null) {
  if (!tenant) throw new Error('Ingen kunde valgt');
  if (!mem.has(c)) throw new Error('Ukjent samling ' + c);
  const id = data.id || randomId();
  const prev = mem.get(c).get(id);
  const d = clean({ ...data, id, _v: hlc.now(), _dev: hlc.nodeId(), _by: by ?? data._by ?? null });
  if (!d._del) delete d._del;
  if (d._by === null) delete d._by;
  if (prev?._srv) d._srv = prev._srv;
  mem.get(c).set(id, d);
  persist(c, d, { origin: 'local' });
  emit({ type: 'put', c, doc: d, source: 'local' });
  return d;
}
export function patch(c, id, changes, by = null) {
  const cur = getRaw(c, id);
  return put(c, { ...(cur || { id }), ...changes, id, _del: undefined }, by);
}
export function remove(c, id, by = null) {
  const cur = getRaw(c, id);
  if (!cur) return null;
  // Tombstone: vi beholder id og versjon slik at slettingen synkes. Personopplysninger fjernes.
  return put(c, { id, _del: true }, by);
}

function persist(c, d, { origin, notBefore = 0 }) {
  const k = `${tenant}|${c}|${d.id}`;
  const t = tenant;
  const ops = [{ store: 'docs', put: { k, t, c, id: d.id, d } }];
  ops.push({ store: 'outbox', put: { k, t, c, id: d.id, v: d._v, origin, notBefore, tries: 0 } });
  writeChain = writeChain.then(async () => {
    const existed = await idb.getRow('outbox', k);
    await idb.writeRows(ops);
    await idb.kvSet('hlc', hlc.current());
    if (!existed && t === tenant) { outboxCount++; emitOut(); }
  }).catch((e) => console.error('Lagring feilet', e));
  if (bc) try { bc.postMessage({ t, c, d }); } catch { /* */ }
  return writeChain;
}
export const flushWrites = () => writeChain;

/**
 * Tar inn et dokument fra server eller naboenhet. Høyeste versjon vinner.
 * source: 'server' | 'lan'. Returnerer true hvis lokal kopi ble endret.
 */
export function merge(c, incoming, source) {
  if (!tenant || !mem.has(c) || !incoming?.id || typeof incoming._v !== 'string') return false;
  hlc.observe(incoming._v);
  const cur = mem.get(c).get(incoming.id);
  const k = `${tenant}|${c}|${incoming.id}`;
  const t = tenant;
  if (cur && cur._v >= incoming._v) {
    // Vi har samme eller nyere. Hvis serveren nå har vår versjon, er utboksen ferdig for dette dokumentet.
    if (source === 'server') {
      writeChain = writeChain.then(async () => {
        const ob = await idb.getRow('outbox', k);
        if (ob && ob.v <= incoming._v) { await idb.writeRows([{ store: 'outbox', del: k }]); if (t === tenant) { outboxCount = Math.max(0, outboxCount - 1); emitOut(); } }
        if (incoming._srv && cur._v === incoming._v && cur._srv !== incoming._srv) {
          cur._srv = incoming._srv;
          await idb.writeRows([{ store: 'docs', put: { k, t, c, id: cur.id, d: cur } }]);
        }
      }).catch((e) => console.error(e));
    }
    return false;
  }
  const d = { ...incoming };
  mem.get(c).set(d.id, d);
  const ops = [{ store: 'docs', put: { k, t, c, id: d.id, d } }];
  writeChain = writeChain.then(async () => {
    const ob = await idb.getRow('outbox', k);
    if (source === 'server') {
      if (ob && ob.v <= d._v) { ops.push({ store: 'outbox', del: k }); }
    } else if (source === 'lan') {
      // Lagre for sentral sending senere, i tilfelle enheten som laget det aldri kommer på nett.
      if (!ob) ops.push({ store: 'outbox', put: { k, t, c, id: d.id, v: d._v, origin: 'lan', notBefore: Date.now() + LAN_PUSH_DELAY, tries: 0, adminOnly: isAdminCollection(c) } });
      else ops.push({ store: 'outbox', put: { ...ob, v: d._v } });
    }
    await idb.writeRows(ops);
    await idb.kvSet('hlc', hlc.current());
    if (t === tenant) {
      const delta = (source === 'server' && ob && ob.v <= d._v) ? -1 : (source === 'lan' && !ob) ? 1 : 0;
      if (delta) { outboxCount = Math.max(0, outboxCount + delta); emitOut(); }
    }
  }).catch((e) => console.error(e));
  if (bc) try { bc.postMessage({ t, c, d, merged: true }); } catch { /* */ }
  emit({ type: 'put', c, doc: d, source });
  return true;
}

function applyFromPeerTab({ c, d }) {
  const cur = mem.get(c)?.get(d.id);
  if (cur && cur._v >= d._v) return;
  mem.get(c)?.set(d.id, d);
  hlc.observe(d._v);
  emit({ type: 'put', c, doc: d, source: 'tab' });
}

// ---------- Utboks (brukes av synk-motoren) ----------
export async function outboxDue(limit = 200, now = Date.now()) {
  if (!tenant) return [];
  await writeChain;
  const rows = await idb.allByTenant('outbox', tenant);
  return rows.filter((r) => (r.notBefore || 0) <= now && (r.retryAt || 0) <= now).slice(0, limit);
}
export async function outboxAll() {
  if (!tenant) return [];
  await writeChain;
  return idb.allByTenant('outbox', tenant);
}
export async function outboxDone(rows) {
  const t = tenant;
  writeChain = writeChain.then(async () => {
    let n = 0;
    const ops = [];
    for (const r of rows) {
      const cur = await idb.getRow('outbox', r.k);
      if (cur && cur.v === r.v) { ops.push({ store: 'outbox', del: r.k }); n++; }
    }
    await idb.writeRows(ops);
    if (t === tenant && n) { outboxCount = Math.max(0, outboxCount - n); emitOut(); }
  });
  return writeChain;
}
export async function outboxFail(row, err, retryMs) {
  writeChain = writeChain.then(async () => {
    const cur = await idb.getRow('outbox', row.k);
    if (!cur) return;
    await idb.writeRows([{ store: 'outbox', put: { ...cur, tries: (cur.tries || 0) + 1, lastErr: String(err).slice(0, 300), retryAt: Date.now() + retryMs } }]);
  });
  return writeChain;
}
export async function outboxDrop(row) { return outboxDone([row]); }

// ---------- Kursorer for inkrementell synk ----------
export const cursorKey = (c) => `cur|${tenant}|${c}`;
export const getCursor = (c) => idb.kvGet(cursorKey(c), 0);
export const setCursor = (c, ms) => idb.kvSet(cursorKey(c), ms);

// ---------- Eksport / import (backup, LAN) ----------
export function snapshot({ includeDeleted = true } = {}) {
  const out = {};
  for (const c of COLLECTION_NAMES) out[c] = includeDeleted ? allRaw(c) : all(c);
  return out;
}
/** Oversikt over versjoner, brukes når to enheter på LAN sammenligner hva de har. */
export function versionIndex() {
  const idx = {};
  for (const [c, m] of mem) { const o = {}; for (const [id, d] of m) o[id] = d._v; idx[c] = o; }
  return idx;
}
export async function wipeTenant(t) {
  if (t === tenant) closeTenant();
  await idb.clearTenant(t);
}
