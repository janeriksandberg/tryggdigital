// Tester sikkerhetsreglene mot Firestore-emulatoren. Kjøres med: npm run test:rules
// Dette er også den automatiserte delen av penetrasjonstesten: hver test er et angrep som skal avvises
// eller en lovlig handling som skal fungere.
import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, collectionGroup, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';

let env;
const T = 'farmA', T2 = 'farmB';
const mfaAdmin = (email) => ({ email, email_verified: true, firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' } });
const pwOnly = (email) => ({ email, email_verified: true, firebase: { sign_in_provider: 'password' } });
const anon = { firebase: { sign_in_provider: 'anonymous' } };
const rec = (extra = {}) => ({ _v: '0000mhz9x.0000.dev1', _dev: 'dev1', _srv: serverTimestamp(), ...extra });

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tryggdigital', firestore: { rules: readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'superadmins/super1'), { email: 'super@x.no' });
    await setDoc(doc(db, `tenants/${T}`), { name: 'Gård A' });
    await setDoc(doc(db, `tenants/${T2}`), { name: 'Gård B' });
    await setDoc(doc(db, `tenants/${T}/admins/anne@a.no`), { email: 'anne@a.no' });
    await setDoc(doc(db, `tenants/${T2}/admins/bob@b.no`), { email: 'bob@b.no' });
    await setDoc(doc(db, 'devices/devA'), { tenantId: T, name: 'Nettbrett 1', status: 'active' });
    await setDoc(doc(db, 'devices/devRevoked'), { tenantId: T, name: 'Gammelt', status: 'revoked' });
    await setDoc(doc(db, `tenants/${T}/people/p1`), { name: 'Ola', _v: '0000mhz9x.0000.dev1', _dev: 'x', _srv: Timestamp.now() });
    await setDoc(doc(db, `tenants/${T}/crates/c1`), { count: 1, _v: '0000mhz9x.0005.dev1', _dev: 'x', _srv: Timestamp.now() });
  });
});

const as = (uid, claims) => env.authenticatedContext(uid, claims).firestore();

describe('administrator', () => {
  test('med tofaktor kan lese og skrive egen kundes data', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    await assertSucceeds(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/people/p2`), rec({ name: 'Kari' })));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/settings/main`), rec({ hourRate: 200 })));
  });
  test('med bare passord (uten andre faktor) får ingen tilgang', async () => {
    const db = as('anne', pwOnly('anne@a.no'));
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertFails(setDoc(doc(db, `tenants/${T}/people/p2`), rec({ name: 'Kari' })));
  });
  test('med ubekreftet e-post får ingen tilgang', async () => {
    const db = as('anne', { ...mfaAdmin('anne@a.no'), email_verified: false });
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
  });
  test('kan ikke lese eller skrive en annen kundes data', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    await assertFails(getDoc(doc(db, `tenants/${T2}/people/x`)));
    await assertFails(setDoc(doc(db, `tenants/${T2}/people/x`), rec({ name: 'Inntrenger' })));
    await assertFails(getDoc(doc(db, `tenants/${T2}`)));
  });
  test('e-post med store bokstaver matcher administratoroppføringen', async () => {
    const db = as('anne', mfaAdmin('Anne@A.no'));
    await assertSucceeds(getDoc(doc(db, `tenants/${T}/people/p1`)));
  });
  test('finner egne kunder via collectionGroup, men ikke andres', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    const snap = await assertSucceeds(getDocs(query(collectionGroup(db, 'admins'), where('email', '==', 'anne@a.no'))));
    if (snap.docs.length !== 1) throw new Error('forventet 1');
    await assertFails(getDocs(query(collectionGroup(db, 'admins'), where('email', '==', 'bob@b.no'))));
    await assertFails(getDocs(collectionGroup(db, 'admins')));
  });
  test('kan legge til en ny administrator, men ikke fjerne seg selv', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/admins/per@a.no`), { email: 'per@a.no', addedBy: 'anne@a.no' }));
    await assertFails(setDoc(doc(db, `tenants/${T}/admins/Per@A.no`), { email: 'Per@A.no' }));
    await assertFails(deleteDoc(doc(db, `tenants/${T}/admins/anne@a.no`)));
    await assertSucceeds(deleteDoc(doc(db, `tenants/${T}/admins/per@a.no`)));
  });
  test('kan ikke gjøre seg selv til superadministrator eller opprette kunder', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    await assertFails(setDoc(doc(db, 'superadmins/anne'), { email: 'anne@a.no' }));
    await assertFails(setDoc(doc(db, 'tenants/ny'), { name: 'Ny' }));
    await assertFails(getDocs(collection(db, 'tenants')));
  });
  test('kan registrere enhet for egen kunde, men ikke flytte en enhet fra en annen kunde', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    await assertSucceeds(setDoc(doc(db, 'devices/newDev'), { tenantId: T, name: 'Nytt', status: 'active', addedBy: 'anne@a.no', addedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'devices/newDev2'), { tenantId: T2, name: 'Feil kunde', status: 'active' }));
    const bob = as('bob', mfaAdmin('bob@b.no'));
    await assertFails(updateDoc(doc(bob, 'devices/devA'), { tenantId: T2 }));
    await assertFails(setDoc(doc(bob, 'devices/devA'), { tenantId: T2, name: 'Stjålet', status: 'active' }));
    await assertFails(getDoc(doc(bob, 'devices/devA')));
  });
  test('kan stenge og gi nytt navn til egen enhet, men ikke flytte den', async () => {
    const db = as('anne', mfaAdmin('anne@a.no'));
    await assertSucceeds(updateDoc(doc(db, 'devices/devA'), { name: 'Mottak', status: 'revoked' }));
    await assertFails(updateDoc(doc(db, 'devices/devA'), { tenantId: T2 }));
  });
});

describe('superadministrator', () => {
  test('kan opprette kunder, liste alle og flytte enheter', async () => {
    const db = as('super1', mfaAdmin('super@x.no'));
    await assertSucceeds(setDoc(doc(db, 'tenants/ny'), { name: 'Ny gård' }));
    await assertSucceeds(getDocs(collection(db, 'tenants')));
    await assertSucceeds(updateDoc(doc(db, 'devices/devA'), { tenantId: T2 }));
    await assertSucceeds(getDoc(doc(db, `tenants/${T2}/people/x`)));
  });
  test('uten tofaktor er superadministrator også stengt ute', async () => {
    const db = as('super1', pwOnly('super@x.no'));
    await assertFails(getDocs(collection(db, 'tenants')));
    await assertFails(updateDoc(doc(db, 'devices/devA'), { tenantId: T2 }));
  });
});

describe('godkjent enhet', () => {
  test('kan lese kundens data og skrive driftsdata', async () => {
    const db = as('devA', anon);
    await assertSucceeds(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/crates/c2`), rec({ count: 2 })));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/shifts/s1`), rec({ personId: 'p1' })));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/sprays/sp1`), rec({ fieldId: 'f1' })));
  });
  test('kan ikke endre personer, satser eller jorder', async () => {
    const db = as('devA', anon);
    await assertFails(setDoc(doc(db, `tenants/${T}/people/p1`), rec({ name: 'Endret', _v: '0000mhz9z.0000.dev1' })));
    await assertFails(setDoc(doc(db, `tenants/${T}/settings/main`), rec({ hourRate: 1 })));
    await assertFails(setDoc(doc(db, `tenants/${T}/fields/f1`), rec({ name: 'X' })));
  });
  test('kan ikke lese eller skrive en annen kundes data', async () => {
    const db = as('devA', anon);
    await assertFails(getDoc(doc(db, `tenants/${T2}/people/x`)));
    await assertFails(setDoc(doc(db, `tenants/${T2}/crates/x`), rec({ count: 1 })));
  });
  test('kan ikke slette data fysisk', async () => {
    const db = as('devA', anon);
    await assertFails(deleteDoc(doc(db, `tenants/${T}/crates/c1`)));
  });
  test('eldre versjon kan ikke overskrive nyere', async () => {
    const db = as('devA', anon);
    await assertFails(setDoc(doc(db, `tenants/${T}/crates/c1`), rec({ count: 9, _v: '0000mhz9x.0001.dev1' })));
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/crates/c1`), rec({ count: 9, _v: '0000mhz9x.0009.dev1' })));
  });
  test('servertid kan ikke forfalskes', async () => {
    const db = as('devA', anon);
    await assertFails(setDoc(doc(db, `tenants/${T}/crates/c3`), { ...rec(), _srv: Timestamp.fromMillis(Date.now() + 1e9) }));
    await assertFails(setDoc(doc(db, `tenants/${T}/crates/c4`), { count: 1 }));
  });
  test('ukjente samlinger er stengt', async () => {
    const db = as('devA', anon);
    await assertFails(setDoc(doc(db, `tenants/${T}/hemmelig/x`), rec()));
    await assertFails(setDoc(doc(db, `annet/x`), { a: 1 }));
  });
  test('stengt enhet får ingen tilgang', async () => {
    const db = as('devRevoked', anon);
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertFails(setDoc(doc(db, `tenants/${T}/crates/c9`), rec({ count: 1 })));
  });
  test('kan oppdatere egen diagnose, men ikke status eller kunde', async () => {
    const db = as('devA', anon);
    await assertSucceeds(updateDoc(doc(db, 'devices/devA'), { lastSeen: serverTimestamp(), diag: { pending: 0 } }));
    await assertFails(updateDoc(doc(db, 'devices/devA'), { status: 'active', tenantId: T2 }));
    await assertFails(updateDoc(doc(db, 'devices/devA'), { name: 'Nytt navn' }));
  });
  test('kan ikke registrere seg selv som enhet', async () => {
    const db = as('evil', anon);
    await assertFails(setDoc(doc(db, 'devices/evil'), { tenantId: T, name: 'Hacker', status: 'active' }));
    await assertSucceeds(getDoc(doc(db, 'devices/evil'))); // kan se om den er godkjent (dokumentet finnes ikke)
    await assertFails(getDoc(doc(db, 'devices/devA')));
  });
  test('kan bruke signalering for LAN innen egen kunde', async () => {
    const db = as('devA', anon);
    await assertSucceeds(setDoc(doc(db, `tenants/${T}/signals/h_x`), { kind: 'hello', from: 'x', ts: serverTimestamp() }));
    await assertFails(setDoc(doc(db, `tenants/${T2}/signals/h_x`), { kind: 'hello', from: 'x', ts: serverTimestamp() }));
    await assertFails(setDoc(doc(db, `tenants/${T}/signals/h_y`), { kind: 'evil', from: 'x', ts: serverTimestamp(), payload: 'x' }));
  });
});

describe('uautentisert og fremmede', () => {
  test('uten innlogging er alt stengt', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertFails(getDoc(doc(db, `tenants/${T}`)));
    await assertFails(getDoc(doc(db, 'devices/devA')));
    await assertFails(getDocs(collection(db, 'tenants')));
  });
  test('anonym bruker som ikke er godkjent enhet får ingenting', async () => {
    const db = as('random', anon);
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertFails(setDoc(doc(db, `tenants/${T}/crates/x`), rec({ count: 1 })));
  });
  test('innlogget bruker som ikke er administrator får ingenting, selv med tofaktor', async () => {
    const db = as('mallory', mfaAdmin('mallory@evil.no'));
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
    await assertFails(setDoc(doc(db, `tenants/${T}/admins/mallory@evil.no`), { email: 'mallory@evil.no' }));
  });
  test('anonym bruker kan ikke utgi seg for administrator ved å legge til e-postfelt', async () => {
    const db = as('anonX', { ...anon, email: 'anne@a.no', email_verified: true });
    await assertFails(getDoc(doc(db, `tenants/${T}/people/p1`)));
  });
});
