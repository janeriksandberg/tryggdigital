// Firebase-instanser. Vi bruker to separate «apper»:
//  - «device»: enhetens egen anonyme identitet (husket i IndexedDB), som gir tilgang når enheten er godkjent for en kunde.
//  - «admin»: administratorens innlogging (e-post + passord + tofaktor), bare for denne nettleserøkten.
// Firestore kjøres med minnebuffer; appens egen lokale database (core/store.js) er den varige lagringen offline.
import * as F from '../../vendor/firebase.js';
import { ACTIVE_CONFIG, EMULATOR } from '../config.js';

const inst = {};

export function fb(name) {
  if (inst[name]) return inst[name];
  if (!ACTIVE_CONFIG) throw new Error('Firebase er ikke konfigurert');
  const app = F.initializeApp(ACTIVE_CONFIG, name);
  const auth = F.initializeAuth(app, { persistence: name === 'device' ? F.indexedDBLocalPersistence : F.browserSessionPersistence });
  const db = F.initializeFirestore(app, { localCache: F.memoryLocalCache(), ignoreUndefinedProperties: true });
  if (EMULATOR) {
    F.connectAuthEmulator(auth, EMULATOR.auth, { disableWarnings: true });
    F.connectFirestoreEmulator(db, ...EMULATOR.firestore);
  }
  inst[name] = { app, auth, db, name };
  return inst[name];
}
export const hasInstance = (name) => !!inst[name];
export { F };

// Firestore tåler ikke lister i lister (f.eks. GeoJSON-koordinater). Slike verdier lagres som JSON-tekst.
export function encode(v) {
  if (Array.isArray(v)) {
    if (v.some((x) => Array.isArray(x))) return { $json: JSON.stringify(v) };
    return v.map(encode);
  }
  if (v && typeof v === 'object' && !(v instanceof Date) && v.constructor === Object) {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = encode(x);
    return o;
  }
  return v;
}
export function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (Object.keys(v).length === 1 && typeof v.$json === 'string') { try { return JSON.parse(v.$json); } catch { return null; } }
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = decode(x);
    return o;
  }
  return v;
}
