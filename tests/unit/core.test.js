import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hlc from '../../v2/js/core/hlc.js';
import * as C from '../../v2/js/core/crypt.js';
import * as Q from '../../v2/js/core/qrauth.js';
import { centroid, pickWeather, round4, compass } from '../../v2/js/core/weather.js';
import { parseLabel, nextPalletNo, crateCode } from '../../v2/js/core/labels.js';
import { parseCsv } from '../../v2/js/core/csv.js';

test('HLC-versjoner øker alltid og kan sammenlignes som tekst, også med feil klokke', () => {
  hlc.initClock('devA');
  const a = hlc.now(1000), b = hlc.now(1000), c = hlc.now(900);
  assert.ok(a < b && b < c);
  hlc.observe(hlc.now(5000).replace('devA', 'devB'), 2000);
  assert.ok(hlc.now(2000) > c);
  // Stempler mer enn ett døgn fram i tid ignoreres
  const before = hlc.now(3000);
  hlc.observe('zzzzzzzzz.0000.devC', 3000);
  assert.ok(hlc.now(3000).startsWith(before.slice(0, 9)));
});

test('base32, sha256 og konstant-tid sammenligning', async () => {
  assert.equal(C.base32(new Uint8Array(16)).length, 26);
  assert.equal(await C.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(C.safeEqual('abc', 'abc')); assert.ok(!C.safeEqual('abc', 'abd')); assert.ok(!C.safeEqual('abc', 'ab'));
  assert.equal(C.normalizeB32('ab-cd o1 il'), 'ABCD0111');
});

test('kryptert sikkerhetskopi: riktig passord åpner, feil passord avvises', async () => {
  const env = await C.encryptJson({ x: 1, s: 'æøå' }, 'passord-123456', 1000);
  assert.equal(env.format, 'tryggdigital-encrypted');
  assert.deepEqual(await C.decryptJson(env, 'passord-123456'), { x: 1, s: 'æøå' });
  await assert.rejects(C.decryptJson(env, 'feil'));
});

test('QR-kort: nøkkel på 128 bit, bare hash lagres, sperret og ukjent avvises', async () => {
  const { token, card } = await Q.issueCard('gard1');
  assert.equal(token.length, 26);
  assert.ok(!JSON.stringify(card).includes(token.slice(0, 20)), 'nøkkelen lagres ikke');
  assert.ok(!card.id.includes(token.slice(0, 4)));
  const people = [{ id: 'p', cards: [card] }];
  assert.equal((await Q.findPerson('gard1', people, Q.qrPayload(token))).person.id, 'p');
  assert.equal((await Q.findPerson('gard1', people, Q.formatToken(token).toLowerCase())).person.id, 'p', 'manuell inntasting med bindestrek og små bokstaver');
  assert.equal((await Q.findPerson('gard2', people, Q.qrPayload(token))).error, 'unknown', 'kort fra annen gård');
  assert.equal((await Q.findPerson('gard1', [{ id: 'p', cards: [{ ...card, revoked: true }] }], token)).error, 'revoked');
  assert.equal((await Q.findPerson('gard1', [{ id: 'p', active: false, cards: [card] }], token)).error, 'inactive');
  assert.equal((await Q.findPerson('gard1', people, 'tull')).error, 'format');
});

test('vær: midtpunkt med 4 desimaler og valg av nærmeste tidssteg', () => {
  const c = centroid({ type: 'Polygon', coordinates: [[[10.123456, 59.1], [10.2, 59.1], [10.2, 59.2], [10.123456, 59.2], [10.123456, 59.1]]] });
  assert.deepEqual(c, { lon: round4((10.123456 * 2 + 10.2 * 2) / 4), lat: 59.15 });
  const json = { properties: { timeseries: [{ time: '2026-07-01T10:00:00Z', data: { instant: { details: { air_temperature: 10, wind_speed: 1 } } } }, { time: '2026-07-01T11:00:00Z', data: { instant: { details: { air_temperature: 12, wind_speed: 3 } } } }] } };
  const w = pickWeather(json, new Date('2026-07-01T10:40:00Z'));
  assert.equal(w.temp, 12); assert.equal(w.forecast, true);
  assert.equal(compass(225), 'SV'); assert.equal(compass(350), 'N');
});

test('etiketter: palle- og kassekoder', () => {
  assert.deepEqual(parseLabel('TD2P:abc'), { kind: 'pallet', id: 'abc' });
  assert.deepEqual(parseLabel(crateCode('2026-07-01', 'f1', 'p1')), { kind: 'crate', date: '2026-07-01', fieldId: 'f1', personId: 'p1' });
  assert.equal(parseLabel('P2026-0007').kind, 'palletNo');
  assert.equal(parseLabel('TD2K:feil'), null);
  assert.equal(nextPalletNo([{ no: 'P2026-0009' }, { no: 'P2025-0100' }], 2026), 'P2026-0010');
  assert.equal(nextPalletNo([], 2027), 'P2027-0001');
});

test('CSV-import tåler semikolon, anførselstegn og fjerner formelvern', () => {
  const rows = parseCsv('﻿name;regNo;notes\r\n"Middel; A";0001.01;"sier ""hei"""\r\nB;;\'=1+1\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Middel; A'); assert.equal(rows[0].notes, 'sier "hei"');
  assert.equal(rows[1].notes, '=1+1');
  assert.equal(parseCsv('name,phiDays\nX,3')[0].phiDays, '3');
});
