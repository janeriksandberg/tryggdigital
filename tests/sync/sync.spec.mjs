// Synk mellom enheter: Firestore (emulator), lokalt nett (WebRTC) uten internett, offline-bruk med omstart, og stenging av enhet.
// Enhetene er separate nettleserkontekster på samme maskin. «Uten internett» betyr at all HTTP-trafikk er sperret for konteksten.
import { test, expect } from '@playwright/test';

const PROJ = 'demo-tryggdigital';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJ}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const T = 't-synk';

const enc = (v) => (v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
async function seed(request, path, data) {
  const res = await request.patch(`${FS}/${path}`, { headers: OWNER, data: { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) } });
  expect(res.ok(), await res.text()).toBeTruthy();
}
const serverDocs = async (request, c) => ((await (await request.get(`${FS}/tenants/${T}/${c}?pageSize=300`, { headers: OWNER })).json()).documents || []);

const S = (page) => page.evaluate(async () => { const s = (await import('/v2/js/session.js')).S; return { mode: s.mode, tenantId: s.tenantId, net: { ...s.net } }; });
const ready = (page) => expect.poll(() => page.evaluate(async () => (await import('/v2/js/session.js')).S.ready), { timeout: 20000 }).toBe(true);
const count = (page, c) => page.evaluate(async (c) => (await import('/v2/js/core/store.js')).all(c).length, c);
const put = (page, c, data) => page.evaluate(async ([c, d]) => (await import('/v2/js/core/store.js')).put(c, d, 'test').id, [c, data]);
const patch = (page, c, id, data) => page.evaluate(async ([c, id, d]) => { (await import('/v2/js/core/store.js')).patch(c, id, d, 'test'); }, [c, id, data]);
const getDoc = (page, c, id) => page.evaluate(async ([c, id]) => (await import('/v2/js/core/store.js')).get(c, id), [c, id]);

async function newDevice(browser, request, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/tile\.openstreetmap|cache\.kartverket|api\.met\.no/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/v2/?emulator=1');
  await ready(page);
  const uid = await page.evaluate(async () => (await import('/v2/js/session.js')).startPairing());
  await seed(request, `devices/${uid}`, { tenantId: T, name, status: 'active' });
  await expect.poll(async () => (await S(page)).mode, { timeout: 30000 }).toBe('device');
  await expect.poll(async () => (await S(page)).net.connected, { timeout: 30000 }).toBe(true);
  return { context, page, uid, errors, name };
}

test('to enheter: synk via server, synk på lokalt nett uten internett, offline med omstart, konflikt og stenging', async ({ browser, request }) => {
  await request.delete(`http://127.0.0.1:8080/emulator/v1/projects/${PROJ}/databases/(default)/documents`); // start med tom database
  await seed(request, `tenants/${T}`, { name: 'Synkgården' });
  await seed(request, `tenants/${T}/settings/main`, { farmName: 'Synkgården', hourRate: 200, lanKey: 'ab'.repeat(32), _v: '9999999999999-0000-seed', _dev: 'seed', _srv: new Date() });

  const A = await newDevice(browser, request, 'Nettbrett A');
  const B = await newDevice(browser, request, 'Nettbrett B');

  await test.step('innstillinger kommer fra serveren til begge', async () => {
    for (const d of [A, B]) await expect.poll(() => d.page.evaluate(async () => (await import('/v2/js/core/store.js')).settings().farmName), { timeout: 20000 }).toBe('Synkgården');
  });

  let shiftId;
  await test.step('en stempling på A dukker opp på B', async () => {
    shiftId = await put(A.page, 'shifts', { personId: 'p1', start: '2026-07-01T05:00:00.000Z', end: null });
    await expect.poll(() => count(B.page, 'shifts'), { timeout: 20000 }).toBe(1);
    await expect.poll(async () => (await serverDocs(request, 'shifts')).length, { timeout: 20000 }).toBe(1);
    await expect.poll(async () => (await S(A.page)).net.pending, { timeout: 20000 }).toBe(0);
  });

  await test.step('enhetene finner hverandre på lokalt nett (WebRTC, automatisk kobling)', async () => {
    try {
      for (const d of [A, B]) await expect.poll(async () => (await S(d.page)).net.peers, { timeout: 45000 }).toBeGreaterThanOrEqual(1);
    } catch (e) {
      for (const d of [A, B]) console.log(d.name, await d.page.evaluate(async () => { const s = await import('/v2/js/session.js'); const l = await import('/v2/js/core/log.js'); return JSON.stringify({ me: s.S.installId, peers: s.lanSync()?.peerList(), log: l.recent(15) }); }));
      throw e;
    }
  });

  await test.step('appen er lagret for offline-bruk (service worker styrer siden)', async () => {
    for (const d of [A, B]) {
      await d.page.evaluate(() => navigator.serviceWorker.ready);
      await expect.poll(() => d.page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);
    }
  });

  await test.step('uten internett: kasser registrert på A kommer til B over lokalt nett, og omvendt', async () => {
    await A.context.setOffline(true); await B.context.setOffline(true);
    for (let i = 0; i < 5; i++) await put(A.page, 'crates', { personId: 'p1', fieldId: 'f1', count: i + 1, rate: 40, ts: new Date().toISOString() });
    await expect.poll(() => count(B.page, 'crates'), { timeout: 20000 }).toBe(5);
    await put(B.page, 'crates', { personId: 'p2', fieldId: 'f1', count: 7, rate: 40, ts: new Date().toISOString() });
    await expect.poll(() => count(A.page, 'crates'), { timeout: 20000 }).toBe(6);
    expect((await S(A.page)).net.pending).toBeGreaterThanOrEqual(5); // venter på internett
    expect((await serverDocs(request, 'crates')).length).toBe(0); // ingenting har nådd serveren
  });

  await test.step('uten internett: appen kan lastes på nytt, og alt er der fortsatt', async () => {
    await A.page.reload();
    await ready(A.page);
    expect((await S(A.page)).mode).toBe('device');
    expect(await count(A.page, 'crates')).toBe(6);
    expect(await count(A.page, 'shifts')).toBe(1);
    await expect(A.page.locator('[data-act=scan]')).toBeVisible();
    await put(A.page, 'crates', { personId: 'p1', fieldId: 'f1', count: 9, rate: 40, ts: new Date().toISOString() });
    expect(await count(A.page, 'crates')).toBe(7);
  });

  await test.step('uten internett: manuell kobling med kode (QR) mellom A og B etter omstart', async () => {
    // Lokalt nett uten internett: nettverket er oppe, men alt til Firebase er sperret.
    // (Full «offline» i testnettleseren sperrer også oppslaget enhetene bruker for å finne hverandre lokalt.)
    for (const d of [A, B]) { await d.context.route(/127\.0\.0\.1:(8080|9099)/, (r) => r.abort('internetdisconnected')); await d.context.setOffline(false); }
    const offer = await A.page.evaluate(async () => (await import('/v2/js/session.js')).lanSync().createOfferCode());
    const answer = await B.page.evaluate(async (c) => (await import('/v2/js/session.js')).lanSync().acceptOfferCode(c), offer);
    await A.page.evaluate(async (c) => (await import('/v2/js/session.js')).lanSync().acceptAnswerCode(c), answer);
    try { await expect.poll(async () => (await S(A.page)).net.peers, { timeout: 15000 }).toBeGreaterThanOrEqual(1); } catch (e) {
      for (const d of [A, B]) console.log(d.name, await d.page.evaluate(async () => { const s = await import('/v2/js/session.js'); const l = await import('/v2/js/core/log.js'); const lan = s.lanSync(); return JSON.stringify({ me: s.S.installId, peers: [...lan.peers.values()].map((p) => ({ id: p.id, authed: p.authed, st: p.pc.connectionState, ice: p.pc.iceConnectionState, sig: p.pc.signalingState, ch: p.ch?.readyState, sdp: (p.pc.localDescription?.sdp || '').split('\n').filter((x) => x.startsWith('a=candidate')).join(' | ').slice(0, 300) })), log: l.recent(8).map((x) => x.msg || x) }); }));
      throw e;
    }
    await expect.poll(() => count(B.page, 'crates'), { timeout: 20000 }).toBe(7); // B får kassen A registrerte etter omstarten
  });

  await test.step('fortsatt ingenting på serveren mens internett er borte', async () => {
    expect((await serverDocs(request, 'crates')).length).toBe(0);
    expect((await S(A.page)).net.pending).toBeGreaterThanOrEqual(6);
  });

  await test.step('konflikt: samme stempling rettes på begge mens de er uten nett, siste endring vinner likt overalt', async () => {
    await patch(A.page, 'shifts', shiftId, { end: '2026-07-01T13:00:00.000Z' });
    await A.page.waitForTimeout(50);
    await patch(B.page, 'shifts', shiftId, { end: '2026-07-01T14:00:00.000Z' });
    await expect.poll(async () => (await getDoc(A.page, 'shifts', shiftId)).end, { timeout: 20000 }).toBe('2026-07-01T14:00:00.000Z');
    expect((await getDoc(B.page, 'shifts', shiftId)).end).toBe('2026-07-01T14:00:00.000Z');
  });

  await test.step('internett tilbake: alt sendes til serveren, og en ny enhet C får alt', async () => {
    for (const d of [A, B]) await d.context.unroute(/127\.0\.0\.1:(8080|9099)/);
    await A.context.setOffline(false); await B.context.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event('online'))); await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
    for (const d of [A, B]) await expect.poll(async () => (await S(d.page)).net.pending, { timeout: 60000 }).toBe(0);
    await expect.poll(async () => (await serverDocs(request, 'crates')).length, { timeout: 30000 }).toBe(7);
    const C = await newDevice(browser, request, 'Nettbrett C');
    await expect.poll(() => count(C.page, 'crates'), { timeout: 30000 }).toBe(7);
    await expect.poll(async () => (await getDoc(C.page, 'shifts', shiftId))?.end, { timeout: 20000 }).toBe('2026-07-01T14:00:00.000Z');
    // Nye samlinger (gjødsling) synkes også
    await put(C.page, 'fertilizations', { date: '2026-05-01', fieldId: 'f1', product: 'Test', amount: 30, unit: 'kg/daa' });
    await expect.poll(() => count(A.page, 'fertilizations'), { timeout: 20000 }).toBe(1);
    // En enhet kan ikke endre oppsett (jorder): endringen blir liggende og når aldri serveren
    await put(C.page, 'fields', { name: 'Ulovlig jorde' });
    await C.page.waitForTimeout(3000);
    expect((await serverDocs(request, 'fields')).length).toBe(0);
    await C.context.close();
  });

  await test.step('en stengt enhet mister tilgangen og de lokale dataene', async () => {
    await seed(request, `devices/${B.uid}`, { tenantId: T, name: 'Nettbrett B', status: 'revoked' });
    await expect.poll(async () => (await S(B.page)).mode, { timeout: 30000 }).toBe('welcome');
    expect((await S(B.page)).tenantId).toBeNull();
    const left = await B.page.evaluate(async () => { const idb = await import('/v2/js/core/idb.js'); return (await idb.allByTenant('docs', 't-synk')).length; });
    expect(left).toBe(0);
  });

  expect(A.errors).toEqual([]);
  expect(B.errors).toEqual([]);
  await A.context.close(); await B.context.close();
});
