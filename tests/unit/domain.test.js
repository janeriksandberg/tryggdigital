import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../v2/js/core/domain.js';

const db0 = () => ({
  settings: { hourRate: 200, crateRate: 30 },
  people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', hourRate: 250 }],
  fields: [{ id: 'f1', areaDaa: 10, defaultVarietyId: 'v1', defaultCrateTypeId: 'c1' }, { id: 'f2', areaDaa: 5 }],
  varieties: [{ id: 'v1', rate: 40 }, { id: 'v2' }], crateTypes: [{ id: 'c1' }, { id: 'c2', rate: 50 }],
  shifts: [], crates: [], sprays: [], products: [], stock: [], assignments: [], alerts: [],
});

test('kassesats: kassetype > sort > gårdens standard', () => {
  const db = db0();
  assert.equal(D.crateRate(db, { varietyId: 'v1', crateTypeId: 'c2' }), 50);
  assert.equal(D.crateRate(db, { varietyId: 'v1', crateTypeId: 'c1' }), 40);
  assert.equal(D.crateRate(db, { varietyId: 'v2', crateTypeId: 'c1' }), 30);
});

test('standardverdier fra jordet', () => {
  const d = D.crateDefaults(db0(), 'f1');
  assert.equal(d.fieldId, 'f1'); assert.equal(d.varietyId, 'v1'); assert.equal(d.crateTypeId, 'c1');
});

test('dagslønn er høyeste av time- og kasselønn', () => {
  assert.deepEqual(D.dayPay(8, 1000, 200), { byHour: 1600, byCrate: 1000, pay: 1600, basis: 'hour' });
  assert.equal(D.dayPay(8, 2000, 200).basis, 'crate');
});

test('lønnsrapport bruker personens egen timelønn', () => {
  const db = db0();
  db.shifts = [{ personId: 'a', start: '2026-07-01T07:00:00', end: '2026-07-01T15:00:00' }, { personId: 'b', start: '2026-07-01T07:00:00', end: '2026-07-01T11:00:00' }];
  db.crates = [{ personId: 'a', ts: '2026-07-01T10:00:00', count: 10, rate: 40 }];
  const r = D.payReport(db, '2026-07-01', '2026-07-01');
  const a = r.find((x) => x.person.id === 'a'), b = r.find((x) => x.person.id === 'b');
  assert.equal(a.hours, 8); assert.equal(a.pay, 1600); assert.equal(a.crates, 10);
  assert.equal(b.pay, 1000);
});

test('karenstid: høsting sperret til sprøytedato + største karenstid', () => {
  const db = db0();
  db.products = [{ id: 'p1', phiDays: 3 }, { id: 'p2', phiDays: 7 }];
  db.sprays = [{ id: 's1', fieldId: 'f1', date: '2026-07-01', products: [{ productId: 'p1' }, { productId: 'p2' }] }];
  assert.equal(D.harvestAllowedFrom(db.sprays[0], db.products), '2026-07-08');
  assert.ok(D.karensFor(db, 'f1', '2026-07-07'));
  assert.equal(D.karensFor(db, 'f1', '2026-07-08'), null);
  assert.equal(D.karensFor(db, 'f1', '2026-06-30'), null, 'sprøyting fram i tid sperrer ikke før den har skjedd');
  assert.equal(D.karensFor(db, 'f2', '2026-07-03'), null);
});

test('totalmengde og lagertrekk fra sprøyting', () => {
  assert.deepEqual(D.totalAmount(100, 'g/daa', 12.4), { qty: 1.24, unit: 'kg' });
  assert.deepEqual(D.totalAmount(1, 'l/ha', 10), { qty: 1, unit: 'l' });
  const uses = D.stockUseFromSpray({ id: 'x', date: '2026-07-01', areaDaa: 10, products: [{ productId: 'p1', dose: 0.2, unit: 'l/daa' }, { name: 'uten register' }] });
  assert.equal(uses.length, 1);
  assert.equal(uses[0].id, 'use-x-0'); assert.equal(uses[0].qty, -2);
  const bal = D.stockBalance({ products: [{ id: 'p1', unit: 'l' }], stock: [{ productId: 'p1', type: 'purchase', qty: 10 }, ...uses] });
  assert.equal(bal.p1.balance, 8); assert.equal(bal.p1.used, 2);
});

test('nøkkeltall per jorde og sammenligning med i fjor', () => {
  const db = db0();
  db.shifts = [{ personId: 'a', start: '2026-07-01T07:00:00', end: '2026-07-01T15:00:00' }, { personId: 'a', start: '2025-07-01T07:00:00', end: '2025-07-01T15:00:00' }];
  db.crates = [{ personId: 'a', fieldId: 'f1', varietyId: 'v1', ts: '2026-07-01T10:00:00', count: 20, rate: 40 }, { personId: 'a', fieldId: 'f1', varietyId: 'v1', ts: '2025-07-01T10:00:00', count: 10, rate: 40 }];
  const c = D.kpiCompare(db, '2026-06-01', '2026-07-31');
  const r = c.rows[0];
  assert.equal(r.crates, 20); assert.equal(r.cratesPerDaa, 2); assert.equal(r.laborCost, 1600); assert.equal(r.costPerCrate, 80);
  assert.equal(r.prev.crates, 10);
});

test('formannsvisning: hvem er på jobb og kasser i dag', () => {
  const now = new Date('2026-07-01T12:00:00');
  const db = db0();
  db.shifts = [{ personId: 'a', start: '2026-07-01T07:00:00', end: null }];
  db.crates = [{ personId: 'a', fieldId: 'f2', ts: '2026-07-01T10:00:00', count: 3 }];
  const s = D.foremanSnapshot(db, now);
  assert.equal(s.working.length, 1); assert.equal(s.working[0].fieldId, 'f2'); assert.equal(s.total, 3);
});

test('merker og rekord for plukker', () => {
  const now = new Date('2026-07-02T12:00:00');
  const db = { crates: [{ personId: 'a', ts: '2026-07-01T10:00:00', count: 30 }, { personId: 'a', ts: '2026-07-02T10:00:00', count: 12 }], shifts: [] };
  const s = D.personSummary(db, 'a', now);
  assert.equal(s.todayCrates, 12); assert.equal(s.pastBest, 30); assert.equal(s.streak, 2);
});
