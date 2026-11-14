// Synk direkte mellom enheter på samme lokale nettverk (WebRTC-datakanaler, uten internett-relé).
//
// Viktig om hva som er mulig i en nettleser: en nettside kan ikke selv finne andre enheter på nettverket.
// To enheter må utveksle en kort tilkoblingsbeskrivelse én gang («signalering»). Det gjøres
//  1) automatisk via Firestore mens enhetene har internett. Forbindelsen lever videre på det lokale
//     nettverket også om internett eller Firestore faller ut, så lenge appen er åpen.
//  2) uten internett: den ene enheten viser en QR-kode som den andre skanner, og omvendt.
// Vi bruker ingen STUN/TURN-servere, så data går bare direkte mellom enheter som når hverandre lokalt.
// Enhetene beviser for hverandre at de hører til samme kunde med en felles hemmelig nøkkel (HMAC).
import * as store from '../core/store.js';
import { hmacHex, safeEqual, toHex, randomBytes, toB64, fromB64 } from '../core/crypt.js';
import { log } from '../core/log.js';

const CHUNK = 16000;
const HELLO_EVERY = 10 * 60 * 1000;
const RTC_CONFIG = { iceServers: [] };

export class LanSync {
  constructor({ tenantId, installId, signalDb, onPeers }) {
    this.t = tenantId;
    this.me = installId;
    this.signalDb = signalDb;
    this.onPeers = onPeers || (() => {});
    this.peers = new Map(); // peerId -> Peer
    this.stopped = false;
  }

  lanKey() { return store.settings().lanKey || null; }
  count() { return [...this.peers.values()].filter((p) => p.authed).length; }
  peerList() { return [...this.peers.values()].map((p) => ({ id: p.id, authed: p.authed, state: p.pc.connectionState, since: p.since, via: p.via })); }
  notify() { this.onPeers(this.count()); }

  start() {
    this.unsubStore = store.subscribe((ev) => {
      if (ev.type !== 'put' || ev.source === 'tab' || ev.source === 'lan') return; // LAN-videresending skjer i onMsg
      for (const p of this.peers.values()) if (p.authed && p.id !== ev.fromPeer) p.send({ type: 'docs', c: ev.c, docs: [ev.doc] });
    });
    this.startSignaling();
  }
  stop() {
    this.stopped = true;
    this.unsubStore?.();
    this.unsubSignal?.();
    clearInterval(this.helloTimer);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.notify();
  }

  // ---------- Signalering via Firestore ----------
  async startSignaling() {
    const db = this.signalDb?.();
    if (!db) return;
    const { F } = await import('./fb.js');
    const col = F.collection(db, 'tenants', this.t, 'signals');
    const hello = async () => {
      try { await F.setDoc(F.doc(col, `h_${this.me}`), { kind: 'hello', from: this.me, ts: F.serverTimestamp() }); } catch (e) { log('lan', 'Hello feilet', { code: e.code }); }
    };
    await hello();
    this.helloTimer = setInterval(hello, HELLO_EVERY);
    const since = F.Timestamp.fromMillis(Date.now() - 30 * 60 * 1000);
    this.unsubSignal = F.onSnapshot(F.query(col, F.where('ts', '>', since)), (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const d = ch.doc.data();
        if (!d || d.from === this.me) continue;
        if (d.kind === 'hello') this.onHello(d.from, F, col);
        else if (d.kind === 'offer' && d.to === this.me) this.onRemoteOffer(d, F, col);
        else if (d.kind === 'answer' && d.to === this.me) { const p = this.peers.get(d.from); if (p && p.sid === d.sid) p.acceptAnswer(d.sdp).catch((e) => log('lan', 'Svar avvist', { msg: e.message })); }
      }
    }, (e) => log('lan', 'Signallytter feilet', { code: e.code }));
  }
  async onHello(other, F, col) {
    const existing = this.peers.get(other);
    if (existing && ['connected', 'connecting', 'new'].includes(existing.pc.connectionState)) return;
    if (this.me > other) return; // den med lavest id ringer opp, så vi ikke lager to forbindelser
    const peer = this.newPeer(other, 'auto');
    const sdp = await peer.makeOffer();
    await F.setDoc(F.doc(col, `o_${this.me}_${other}`), { kind: 'offer', from: this.me, to: other, sid: peer.sid, sdp, ts: F.serverTimestamp() });
  }
  async onRemoteOffer(d, F, col) {
    const existing = this.peers.get(d.from);
    if (existing?.authed && existing.pc.connectionState === 'connected') return;
    if (this.answered?.has(d.sid)) return;
    (this.answered ??= new Set()).add(d.sid);
    existing?.close();
    const peer = this.newPeer(d.from, 'auto');
    const sdp = await peer.makeAnswer(d.sdp);
    await F.setDoc(F.doc(col, `a_${this.me}_${d.from}`), { kind: 'answer', from: this.me, to: d.from, sid: d.sid, sdp, ts: F.serverTimestamp() });
  }

  // ---------- Manuell kobling med QR (uten internett) ----------
  async createOfferCode() {
    this.pendingManual?.close();
    const peer = this.newPeer('manual-' + toHex(randomBytes(4)), 'qr');
    this.pendingManual = peer;
    const sdp = await peer.makeOffer();
    return 'TD2L1' + await pack({ f: this.me, s: sdp });
  }
  async acceptOfferCode(code) {
    const { f, s } = await unpack(code);
    this.peers.get(f)?.close();
    const peer = this.newPeer(f, 'qr');
    const sdp = await peer.makeAnswer(s);
    return 'TD2L2' + await pack({ f: this.me, s: sdp });
  }
  async acceptAnswerCode(code) {
    const { f, s } = await unpack(code);
    const peer = this.pendingManual;
    if (!peer) throw new Error('Ingen ventende kobling');
    this.peers.delete(peer.id);
    peer.id = f;
    this.peers.set(f, peer);
    this.pendingManual = null;
    await peer.acceptAnswer(s);
  }

  newPeer(id, via) {
    this.peers.get(id)?.close();
    const p = new Peer(this, id, via);
    this.peers.set(id, p);
    return p;
  }
  removePeer(p) { if (this.peers.get(p.id) === p) this.peers.delete(p.id); this.notify(); }
}

class Peer {
  constructor(hub, id, via) {
    this.hub = hub; this.id = id; this.via = via;
    this.authed = false; this.since = null;
    this.nonce = toHex(randomBytes(16));
    this.sid = toHex(randomBytes(8));
    this.inbox = new Map();
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(this.pc.connectionState)) { this.close(); }
      else if (this.pc.connectionState === 'disconnected') setTimeout(() => { if (this.pc.connectionState === 'disconnected') this.close(); }, 15000);
    };
    this.pc.ondatachannel = (e) => this.bind(e.channel);
  }
  bind(ch) {
    this.ch = ch;
    ch.onopen = () => this.raw({ type: 'hello', id: this.hub.me, t: this.hub.t, nonce: this.nonce });
    ch.onmessage = (e) => this.onRaw(e.data);
    ch.onclose = () => this.close();
  }
  async gather() {
    if (this.pc.iceGatheringState === 'complete') return;
    await new Promise((res) => {
      const done = () => { if (this.pc.iceGatheringState === 'complete') { this.pc.removeEventListener('icegatheringstatechange', done); res(); } };
      this.pc.addEventListener('icegatheringstatechange', done);
      setTimeout(res, 4000);
    });
  }
  async makeOffer() {
    this.bind(this.pc.createDataChannel('td2', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gather();
    return this.pc.localDescription.sdp;
  }
  async makeAnswer(sdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gather();
    return this.pc.localDescription.sdp;
  }
  async acceptAnswer(sdp) {
    if (this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.ch?.close(); } catch { /* */ }
    try { this.pc.close(); } catch { /* */ }
    if (this.authed) log('lan', 'Nabo frakoblet', { peer: this.id });
    this.authed = false;
    this.hub.removePeer(this);
  }

  // Meldinger deles i biter for å holde oss under størrelsesgrensen for datakanaler.
  raw(obj) {
    if (this.ch?.readyState !== 'open') return;
    const s = JSON.stringify(obj);
    if (s.length <= CHUNK) { this.ch.send(s); return; }
    const mid = toHex(randomBytes(6));
    const n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) this.ch.send(JSON.stringify({ type: 'chunk', mid, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  send(obj) { if (this.authed) this.raw(obj); }
  onRaw(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'chunk') {
      const parts = this.inbox.get(m.mid) || [];
      parts[m.i] = m.d;
      this.inbox.set(m.mid, parts);
      if (parts.filter((x) => x !== undefined).length === m.n) { this.inbox.delete(m.mid); this.onRaw(parts.join('')); }
      return;
    }
    this.onMsg(m).catch((e) => log('lan', 'Feil i melding', { msg: e.message }));
  }
  async onMsg(m) {
    const key = this.hub.lanKey();
    if (m.type === 'hello') {
      if (m.t !== this.hub.t || !key) { log('lan', 'Avviste nabo fra annen kunde eller uten nøkkel'); return this.close(); }
      this.peerId = m.id;
      this.raw({ type: 'auth', mac: await hmacHex(key, `${m.nonce}|${this.hub.me}|${this.hub.t}`) });
      return;
    }
    if (m.type === 'auth') {
      if (!key || !this.peerId) return this.close();
      const expect = await hmacHex(key, `${this.nonce}|${this.peerId}|${this.hub.t}`);
      if (!safeEqual(expect, m.mac)) { log('lan', 'Feil nøkkel fra nabo, kobler fra'); return this.close(); }
      if (this.id.startsWith('manual-')) { this.hub.peers.delete(this.id); this.id = this.peerId; this.hub.peers.set(this.id, this); }
      this.authed = true; this.since = Date.now();
      log('lan', 'Koblet til nabo på lokalt nett', { peer: this.peerId, via: this.via });
      this.hub.notify();
      this.send({ type: 'index', idx: store.versionIndex() });
      return;
    }
    if (!this.authed) return;
    if (m.type === 'index') {
      // Send det naboen mangler eller har eldre versjon av
      for (const [c, ids] of Object.entries(m.idx || {})) {
        const mine = store.allRaw(c);
        const out = mine.filter((d) => !ids[d.id] || ids[d.id] < d._v);
        for (let i = 0; i < out.length; i += 200) this.send({ type: 'docs', c, docs: out.slice(i, i + 200) });
      }
      // og dokumenter vi ikke har i det hele tatt i samlinger naboen kjenner men vi ikke
      return;
    }
    if (m.type === 'docs') {
      for (const d of m.docs || []) {
        const changed = store.merge(m.c, d, 'lan');
        if (changed) for (const p of this.hub.peers.values()) if (p !== this && p.authed) p.send({ type: 'docs', c: m.c, docs: [d] });
      }
    }
  }
}

async function pack(obj) {
  const data = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toB64(await new Response(data).arrayBuffer()).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(code) {
  const b64 = code.slice(5).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = fromB64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  return JSON.parse(text);
}
export { pack, unpack };
