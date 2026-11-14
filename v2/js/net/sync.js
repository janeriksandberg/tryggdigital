// Synk mellom lokal database og Firestore.
//  - Henter: én sanntidslytter per samling på dokumenter endret etter forrige kjente servertid (_srv).
//  - Sender: utboksen (core/store.js) skrives med serverTimestamp, én bunke av gangen.
// Sikkerhetsreglene avviser eldre versjoner enn det serveren har, så samtidige endringer løses likt overalt.
import { F, encode, decode } from './fb.js';
import * as store from '../core/store.js';
import { COLLECTION_NAMES, isAdminCollection } from '../core/schema.js';
import { log } from '../core/log.js';

const OVERLAP_MS = 2 * 60 * 1000;

export class SyncEngine {
  /**
   * reader: Firestore-instans som brukes til å lytte.
   * writers(): liste av { db, canWrite(c) } i prioritert rekkefølge (admin før enhet).
   */
  constructor({ tenantId, reader, writers, onStatus }) {
    this.t = tenantId;
    this.reader = reader;
    this.writers = writers;
    this.onStatus = onStatus || (() => {});
    this.unsubs = [];
    this.connected = false;
    this.lastServer = 0;
    this.lastError = null;
    this.pushing = false;
    this.timer = null;
    this.stopped = false;
  }

  status() {
    return { connected: this.connected, lastServer: this.lastServer, pending: store.pendingCount(), error: this.lastError };
  }
  emit() { this.onStatus(this.status()); }

  async start() {
    this.stopped = false;
    for (const c of COLLECTION_NAMES) await this.listen(c);
    this.unsubOut = store.onOutbox(() => { this.emit(); this.kick(); });
    this.onOnline = () => this.kick(0);
    window.addEventListener('online', this.onOnline);
    this.kick(500);
  }
  stop() {
    this.stopped = true;
    for (const u of this.unsubs) try { u(); } catch { /* */ }
    this.unsubs = [];
    this.unsubOut?.();
    window.removeEventListener('online', this.onOnline);
    clearTimeout(this.timer);
  }

  async listen(c) {
    const cursor = await store.getCursor(c);
    const since = F.Timestamp.fromMillis(Math.max(0, cursor - OVERLAP_MS));
    const q = F.query(F.collection(this.reader, 'tenants', this.t, c), F.where('_srv', '>', since), F.orderBy('_srv'));
    let maxSeen = cursor;
    const unsub = F.onSnapshot(q, { includeMetadataChanges: c === 'settings' }, (snap) => {
      if (c === 'settings') this.setConnected(!snap.metadata.fromCache);
      if (!snap.metadata.fromCache) this.lastServer = Date.now();
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue; // fjernet fra spørringen, ikke slettet
        if (ch.doc.metadata.hasPendingWrites) continue;
        const d = decode(ch.doc.data());
        d.id = ch.doc.id;
        if (typeof d._srv === 'number' && d._srv > maxSeen) maxSeen = d._srv;
        store.merge(c, d, 'server');
      }
      if (maxSeen > cursor) store.setCursor(c, maxSeen);
    }, (err) => {
      this.lastError = `${c}: ${err.code || err.message}`;
      log('sync', 'Lytter feilet', { c, code: err.code, msg: err.message });
      this.emit();
      // Prøv igjen senere (f.eks. etter at enheten er godkjent eller nettet er tilbake)
      setTimeout(() => { if (!this.stopped) this.listen(c); }, 30000);
    });
    this.unsubs.push(unsub);
  }

  setConnected(v) {
    if (v) this.lastServer = Date.now();
    if (this.connected !== v) { this.connected = v; this.emit(); if (v) this.kick(0); }
  }

  kick(delay = 300) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), delay);
  }

  writerFor(c, origin) {
    for (const w of this.writers()) if (w.canWrite(c, origin)) return w;
    return null;
  }

  async push() {
    if (this.pushing || this.stopped) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    this.pushing = true;
    try {
      const rows = await store.outboxDue(200);
      if (!rows.length) return;
      const groups = new Map();
      for (const r of rows) {
        const w = this.writerFor(r.c, r.origin);
        if (!w) continue; // venter på at en administrator logger inn
        if (!groups.has(w)) groups.set(w, []);
        groups.get(w).push(r);
      }
      for (const [w, list] of groups) await this.pushGroup(w, list);
      this.lastError = null;
    } catch (e) {
      this.lastError = e.code || e.message;
      log('sync', 'Sending feilet', { msg: e.message, code: e.code });
    } finally {
      this.pushing = false;
      this.emit();
      const due = await store.outboxDue(1).catch(() => []);
      this.kick(due.length ? (this.connected ? 1000 : 15000) : 30000);
    }
  }

  docData(r) {
    const d = store.getRaw(r.c, r.id);
    if (!d || d._v !== r.v) return null; // en nyere lokal versjon er på vei
    const { id, _srv, ...rest } = d;
    return encode({ ...rest, _srv: F.serverTimestamp() });
  }

  async pushGroup(w, list) {
    const batch = F.writeBatch(w.db);
    const sent = [];
    for (const r of list) {
      const data = this.docData(r);
      if (!data) { sent.push(r); continue; }
      batch.set(F.doc(w.db, 'tenants', this.t, r.c, r.id), data);
      sent.push(r);
    }
    try {
      await withTimeout(batch.commit(), 25000);
      await store.outboxDone(sent);
      this.lastServer = Date.now();
    } catch (e) {
      if (e.code === 'permission-denied' || e.code === 'invalid-argument') {
        // Én av dem ble avvist: send én og én for å finne hvilken
        for (const r of list) await this.pushOne(w, r);
      } else throw e;
    }
  }

  async pushOne(w, r) {
    const data = this.docData(r);
    if (!data) return store.outboxDone([r]);
    const ref = F.doc(w.db, 'tenants', this.t, r.c, r.id);
    try {
      await withTimeout(F.setDoc(ref, data), 20000);
      await store.outboxDone([r]);
    } catch (e) {
      if (e.code === 'permission-denied') {
        // Har serveren allerede en nyere versjon? Da er vår endring overkjørt, og lytteren henter den nye.
        try {
          const snap = await F.getDoc(ref);
          if (snap.exists() && snap.data()._v >= r.v) { await store.outboxDrop(r); return; }
        } catch { /* */ }
      }
      log('sync', 'Avvist dokument', { c: r.c, id: r.id, code: e.code });
      await store.outboxFail(r, e.code || e.message, Math.min(3600000, 30000 * 2 ** Math.min(6, r.tries || 0)));
    }
  }
}

function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error('Tidsavbrudd'), { code: 'timeout' })), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/** Hvilke samlinger en skriver kan sende. Enheter kan ikke sende administratordata. */
export const deviceCanWrite = (c) => !isAdminCollection(c);
