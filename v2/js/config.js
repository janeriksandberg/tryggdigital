// Firebase-oppsett for Tryggdigital v2.
// Verdiene her er ikke hemmelige: en Firebase web-konfigurasjon er ment å ligge i klientkoden.
// Tilgang styres av sikkerhetsreglene i firebase/firestore.rules og av innlogging.
// Fylles inn når Firebase-prosjektet er opprettet (se docs/firebase-oppsett.md).
export const FIREBASE_CONFIG = null;

// Lokal testing mot Firebase-emulatorene. Kan bare slås på når appen kjører fra localhost.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
let emu = false;
try { emu = isLocal && (new URLSearchParams(location.search).get('emulator') === '1' || localStorage.getItem('td2.emulator') === '1'); } catch { /* */ }
if (emu) try { localStorage.setItem('td2.emulator', '1'); } catch { /* */ }

export const EMULATOR = emu ? { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080] } : null;
export const ACTIVE_CONFIG = emu
  ? { apiKey: 'demo-api-key', authDomain: 'demo-tryggdigital.firebaseapp.com', projectId: 'demo-tryggdigital', appId: 'demo-app' }
  : FIREBASE_CONFIG;
export const IS_CONFIGURED = !!ACTIVE_CONFIG;
export const APP_VERSION = '2.0.0';
