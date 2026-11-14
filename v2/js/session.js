// Øktstyring: hvilken kunde (tenant) som er åpen, om enheten er godkjent, om en administrator er logget inn,
// og start/stopp av synk. All data leses fra den lokale databasen, så appen starter også uten nett.
import { IS_CONFIGURED, APP_VERSION } from './config.js';
import * as idb from './core/idb.js';
import * as store from './core/store.js';
import { log, recent } from './core/log.js';

export const S = {
  ready: false,
  mode: 'welcome',     // welcome | device | admin | demo
  installId: null,
  tenantId: null,
  tenantName: '',
  device: null,        // { uid, tenantId, name, status }
  admin: null,         // { uid, email, mfa, enrolled, emailVerified, isSuper, tenants: [{id,name}] }
  pairing: null,       // { uid } mens enheten venter på godkjenning
  net: { connected: false, lastServer: 0, pending: 0, error: null, peers: 0, online: navigator.onLine },
  notice: null,
};
const listeners = new Set();
export const onSession = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function emit() { for (const fn of listeners) try { fn(S); } catch (e) { console.error(e); } }

let F = null, fbm = null, authm = null, syncm = null, lanm = null;
let engine = null, deviceUnsub = null, adminUnsub = null, diagTimer = null, idleTimer = null, lan = null;
const ADMIN_IDLE_MS = 15 * 60 * 1000;

async function loadFirebase() {
  if (fbm) return;
  fbm = await import('./net/fb.js');
  F = fbm.F;
  authm = await import('./net/auth.js');
  syncm = await import('./net/sync.js');
}

export async function init() {
  S.installId = await idb.kvGet('installId');
  if (!S.installId) { S.installId = store.randomId(12); await idb.kvSet('installId', S.installId); }
  window.addEventListener('online', () => { S.net.online = true; emit(); });
  window.addEventListener('offline', () => { S.net.online = false; emit(); });
  store.onOutbox((n) => { S.net.pending = n; emit(); });

  const demo = await idb.kvGet('demo');
  const dev = await idb.kvGet('device');
  if (demo && !dev) { await enterDemo(false); S.ready = true; emit(); return; }

  if (IS_CONFIGURED) {
    await loadFirebase();
    const devAuth = fbm.fb('device').auth;
    await devAuth.authStateReady();
    if (dev && dev.status === 'active' && devAuth.currentUser?.uid === dev.uid) {
      S.device = dev;
      S.mode = 'device'; // må settes før kunden åpnes, ellers starter ikke LAN-signaleringen
      await openTenant(dev.tenantId, dev.tenantName);
      startDeviceWatch();
    } else if (dev && devAuth.currentUser?.uid === dev.uid && dev.status === 'pending') {
      S.pairing = { uid: dev.uid };
      watchPairing(dev.uid);
    }
    const adminAuth = fbm.fb('admin').auth;
    await adminAuth.authStateReady();
    adminUnsub = F.onAuthStateChanged(adminAuth, (u) => onAdminUser(u));
    await onAdminUser(adminAuth.currentUser);
  }
  S.ready = true;
  emit();
}

// ---------- Kunde / lokal database ----------
async function openTenant(t, name) {
  if (store.tenantId() === t) return;
  await stopSync();
  await store.openTenant(t, S.installId);
  S.tenantId = t;
  S.tenantName = name || store.settings().farmName || '';
  await startLan();
}
async function closeTenant({ wipe }) {
  const t = S.tenantId;
  await stopSync();
  lan?.stop(); lan = null;
  if (t && wipe) await store.wipeTenant(t); else store.closeTenant();
  S.tenantId = null; S.tenantName = '';
}

function writers() {
  const list = [];
  if (S.admin?.mfa && fbm) list.push({ name: 'admin', db: fbm.fb('admin').db, canWrite: (c, origin) => true });
  if (S.mode === 'device' && fbm) list.push({ name: 'device', db: fbm.fb('device').db, canWrite: (c) => syncm.deviceCanWrite(c) });
  return list;
}
async function startSync() {
  if (!fbm || !S.tenantId || S.mode === 'demo') return;
  await stopSync();
  const reader = S.mode === 'device' ? fbm.fb('device').db : (S.admin?.mfa ? fbm.fb('admin').db : null);
  if (!reader) return;
  engine = new syncm.SyncEngine({ tenantId: S.tenantId, reader, writers, onStatus: (st) => { Object.assign(S.net, st, { peers: S.net.peers }); emit(); } });
  await engine.start();
}
async function stopSync() { engine?.stop(); engine = null; }
export const syncNow = () => engine?.kick(0);
export const syncStatus = () => engine?.status() || null;

async function startLan() {
  if (S.mode === 'demo' || !S.tenantId) return;
  try {
    lanm ??= await import('./net/lan.js');
    lan?.stop();
    lan = new lanm.LanSync({ tenantId: S.tenantId, installId: S.installId, signalDb: () => (S.mode === 'device' ? fbm?.fb('device').db : null), onPeers: (n) => { S.net.peers = n; emit(); } });
    lan.start();
  } catch (e) { log('lan', 'Kunne ikke starte LAN-synk', { msg: e.message }); }
}
export const lanSync = () => lan;

// ---------- Godkjent enhet ----------
/** Enheten får en anonym Firebase-identitet og viser en kode/QR som en administrator godkjenner. */
export async function startPairing() {
  await loadFirebase();
  const auth = fbm.fb('device').auth;
  if (!auth.currentUser) await F.signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  await idb.kvSet('device', { uid, status: 'pending' });
  S.pairing = { uid };
  watchPairing(uid);
  emit();
  return uid;
}
export async function cancelPairing() {
  deviceUnsub?.(); deviceUnsub = null;
  S.pairing = null;
  await idb.kvDel('device');
  emit();
}
function watchPairing(uid) {
  deviceUnsub?.();
  deviceUnsub = F.onSnapshot(F.doc(fbm.fb('device').db, 'devices', uid), async (snap) => {
    const d = snap.data();
    if (snap.metadata.fromCache || !d || d.status !== 'active') return;
    deviceUnsub?.(); deviceUnsub = null;
    S.pairing = null;
    await activateDevice(uid, d);
  }, (e) => log('device', 'Venter på godkjenning', { code: e.code }));
}
async function activateDevice(uid, d) {
  let name = '';
  try { const t = await F.getDoc(F.doc(fbm.fb('device').db, 'tenants', d.tenantId)); name = t.data()?.name || ''; } catch { /* */ }
  S.device = { uid, tenantId: d.tenantId, name: d.name, status: 'active', tenantName: name };
  await idb.kvSet('device', S.device);
  await idb.kvDel('demo');
  S.mode = 'device'; // må settes før kunden åpnes, ellers starter ikke LAN-signaleringen
  await openTenant(d.tenantId, name);
  startDeviceWatch();
  log('device', 'Enheten er godkjent', { t: d.tenantId });
  emit();
}

function startDeviceWatch() {
  const db = fbm.fb('device').db;
  const uid = S.device.uid;
  deviceUnsub?.();
  deviceUnsub = F.onSnapshot(F.doc(db, 'devices', uid), { includeMetadataChanges: true }, async (snap) => {
    if (snap.metadata.fromCache) return; // ta aldri beslutninger på grunnlag av bufret/manglende data
    const d = snap.data();
    if (!d || d.status !== 'active') return revoked();
    if (d.tenantId !== S.device.tenantId) return moved(d);
    if (d.name !== S.device.name) { S.device.name = d.name; await idb.kvSet('device', S.device); emit(); }
    const cmd = d.cmd || {};
    const done = (await idb.kvGet('cmdDone')) || 0;
    if (cmd.resync && cmd.resync > done) {
      await idb.kvSet('cmdDone', cmd.resync);
      log('support', 'Full ny synk bestilt av support');
      for (const c of (await import('./core/schema.js')).COLLECTION_NAMES) await store.setCursor(c, 0);
      await startSync();
    }
    if (cmd.diag && cmd.diag > done) { await idb.kvSet('cmdDone', cmd.diag); sendDiag(); }
  }, (e) => {
    log('device', 'Enhetsdokument utilgjengelig', { code: e.code });
    if (e.code === 'permission-denied') revoked();
  });
  startSync();
  clearInterval(diagTimer);
  diagTimer = setInterval(sendDiag, 5 * 60 * 1000);
  setTimeout(sendDiag, 5000);
}
async function revoked() {
  log('device', 'Enheten er fjernet fra kunden');
  deviceUnsub?.(); deviceUnsub = null;
  clearInterval(diagTimer);
  await closeTenant({ wipe: true });
  await idb.kvDel('device');
  S.device = null;
  S.mode = S.admin?.mfa ? 'admin' : 'welcome';
  S.notice = 'device.revoked';
  emit();
}
async function moved(d) {
  log('device', 'Enheten er flyttet til en annen kunde', { to: d.tenantId });
  await closeTenant({ wipe: true });
  await activateDevice(S.device.uid, d);
  S.notice = 'device.moved';
  emit();
}

export async function diagnostics() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  return {
    appVersion: APP_VERSION, installId: S.installId, tenantId: S.tenantId, mode: S.mode,
    pending: store.pendingCount(), connected: S.net.connected, lastServer: S.net.lastServer || null, peers: S.net.peers,
    syncError: S.net.error || null, online: navigator.onLine, ua: navigator.userAgent.slice(0, 200),
    lang: document.documentElement.lang, screen: `${screen.width}x${screen.height}`,
    storageUsedMb: est ? Math.round(est.usage / 1e6) : null, persisted: await navigator.storage?.persisted?.().catch(() => null),
    swControlled: !!navigator.serviceWorker?.controller, log: recent(25),
    counts: Object.fromEntries(['people', 'crates', 'shifts', 'sprays'].map((c) => [c, store.all(c).length])),
  };
}
export async function sendDiag() {
  if (S.mode !== 'device' || !fbm || !navigator.onLine) return false;
  try {
    const diag = await diagnostics();
    await F.updateDoc(F.doc(fbm.fb('device').db, 'devices', S.device.uid), { lastSeen: F.serverTimestamp(), appVersion: APP_VERSION, diag: JSON.parse(JSON.stringify(diag)) });
    return true;
  } catch (e) { log('device', 'Diagnose ikke sendt', { code: e.code }); return false; }
}

// ---------- Administrator ----------
async function onAdminUser(user) {
  if (!user) {
    const was = S.admin;
    S.admin = null;
    clearTimeout(idleTimer);
    if (was && S.mode === 'admin') { await closeTenant({ wipe: true }); S.mode = 'welcome'; }
    else if (S.mode === 'device') startSync();
    emit();
    return;
  }
  const st = await authm.adminState(user);
  S.admin = { ...st, isSuper: false, tenants: [] };
  if (st.mfa && st.emailVerified) {
    const db = fbm.fb('admin').db;
    try { S.admin.isSuper = (await F.getDoc(F.doc(db, 'superadmins', st.uid))).exists(); } catch { /* */ }
    try {
      if (S.admin.isSuper) {
        const snap = await F.getDocs(F.collection(db, 'tenants'));
        S.admin.tenants = snap.docs.map((d) => ({ id: d.id, name: d.data().name || d.id, status: d.data().status || 'active' }));
      } else {
        const snap = await F.getDocs(F.query(F.collectionGroup(db, 'admins'), F.where('email', '==', st.email)));
        const ids = snap.docs.map((d) => d.ref.parent.parent.id);
        S.admin.tenants = await Promise.all(ids.map(async (id) => {
          try { return { id, name: (await F.getDoc(F.doc(db, 'tenants', id))).data()?.name || id }; } catch { return { id, name: id }; }
        }));
      }
    } catch (e) { log('admin', 'Kunne ikke hente kunder', { code: e.code }); }
    S.admin.tenants.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    armIdle();
    if (S.mode === 'device') { startSync(); }
    else {
      S.mode = 'admin';
      const last = await idb.kvGet('adminTenant');
      const pick = S.admin.tenants.find((x) => x.id === last) || (S.admin.tenants.length === 1 ? S.admin.tenants[0] : null);
      if (pick) await chooseTenant(pick.id);
    }
  }
  emit();
}
export async function refreshAdmin() { if (fbm) await onAdminUser(fbm.fb('admin').auth.currentUser); }

export async function chooseTenant(id) {
  if (S.mode === 'device') return;
  const tn = S.admin?.tenants.find((x) => x.id === id);
  if (!tn) return;
  if (S.tenantId && S.tenantId !== id) await closeTenant({ wipe: true });
  await openTenant(id, tn.name);
  await idb.kvSet('adminTenant', id);
  await startSync();
  emit();
}
export const isAdminHere = () => S.mode === 'demo' || (!!S.admin?.mfa && (S.admin.isSuper || S.admin.tenants.some((x) => x.id === S.tenantId)));

function armIdle() {
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => { if (S.admin) { S.notice = 'auth.idleLogout'; await signOutAdmin(); } }, ADMIN_IDLE_MS);
  };
  if (!armIdle.bound) { for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (S.admin) reset(); }, { passive: true }); armIdle.bound = true; }
  reset();
}
export async function signOutAdmin() {
  await loadFirebase();
  await authm.signOutAdmin();
}
export const auth = () => authm;
export const firebase = () => ({ F, fb: fbm?.fb });

// ---------- Registrering av enheter (gjøres av administrator) ----------
export async function registerDevice(uid, tenantId, name) {
  const db = fbm.fb('admin').db;
  await F.setDoc(F.doc(db, 'devices', uid), { tenantId, name: name.trim().slice(0, 60), status: 'active', addedBy: S.admin.email, addedAt: F.serverTimestamp() });
}
/** Gjør nettbrettet administratoren står på til fast enhet for den valgte kunden. */
export async function registerThisDevice(tenantId, name) {
  await loadFirebase();
  const auth = fbm.fb('device').auth;
  if (!auth.currentUser) await F.signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  await idb.kvSet('device', { uid, status: 'pending' });
  await registerDevice(uid, tenantId, name);
  if (S.tenantId) await closeTenant({ wipe: false });
  S.mode = 'welcome';
  watchPairing(uid);
}

// ---------- Demo (uten Firebase, data bare på denne enheten) ----------
export async function enterDemo(seed = true) {
  await idb.kvSet('demo', true);
  S.mode = 'demo';
  await store.openTenant('demo', S.installId);
  S.tenantId = 'demo';
  if (seed && !store.all('people').length) (await import('./demo.js')).seedDemo();
  S.tenantName = store.settings().farmName || 'Demo';
  emit();
}
export async function exitDemo() {
  await closeTenant({ wipe: true });
  await idb.kvDel('demo');
  S.mode = 'welcome';
  emit();
}
export const dismissNotice = () => { S.notice = null; emit(); };
export const refresh = () => emit();
