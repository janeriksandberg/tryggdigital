// Demodata for å prøve appen uten Firebase. Lagres bare på denne enheten, under kunden «demo».
import * as store from './core/store.js';
import { issueCard } from './core/qrauth.js';
import { dayKey, addDays, crateRate } from './core/domain.js';
import { randomBytes, toHex } from './core/crypt.js';

export const DEMO_TOKENS = {};

export async function seedDemo() {
  const t = store.tenantId();
  store.put('settings', { id: 'main', farmName: 'Demogården', orgNo: '999999999', hourRate: 182.8, crateRate: 38, contactEmail: 'post@demogarden.no', contactPhone: '', address: 'Bærveien 1, 3000 Drammen', privacyRev: 1, lanKey: toHex(randomBytes(32)), karensMode: 'block' });
  const v1 = store.put('varieties', { name: 'Jordbær – Korona', crop: 'FRAAN', rate: 38, color: '#d6264f' });
  const v2 = store.put('varieties', { name: 'Jordbær – Sonata', crop: 'FRAAN', rate: 40, color: '#e85d75' });
  const v3 = store.put('varieties', { name: 'Bringebær – Glen Ample', crop: 'RUBID', rate: 55, color: '#b0124c' });
  const c1 = store.put('crateTypes', { name: 'Kasse 8 × 0,5 kg', kg: 4 });
  const c2 = store.put('crateTypes', { name: 'Kasse 10 × 0,25 kg', kg: 2.5, rate: 30 });
  const ring = (lng, lat, w, hgt) => [[[lng, lat], [lng + w, lat], [lng + w, lat + hgt], [lng, lat + hgt], [lng, lat]]];
  const f1 = store.put('fields', { name: 'Nordre', crop: 'FRAAN', color: '#d6264f', areaDaa: 12.4, geometry: { type: 'Polygon', coordinates: ring(10.2, 59.75, 0.004, 0.0015) }, defaultVarietyId: v1.id, defaultCrateTypeId: c1.id });
  const f2 = store.put('fields', { name: 'Søndre', crop: 'FRAAN', color: '#157a52', areaDaa: 8.1, geometry: { type: 'Polygon', coordinates: ring(10.2, 59.747, 0.003, 0.0012) }, defaultVarietyId: v2.id, defaultCrateTypeId: c1.id });
  const f3 = store.put('fields', { name: 'Bringebærlia', crop: 'RUBID', color: '#7c3aed', areaDaa: 5.6, geometry: { type: 'Polygon', coordinates: ring(10.206, 59.749, 0.002, 0.0012) }, defaultVarietyId: v3.id, defaultCrateTypeId: c2.id });
  const names = [['Anna Kowalska', 'pl', ['picker']], ['Tomas Petrauskas', 'lt', ['picker']], ['Olena Shevchenko', 'uk', ['picker']], ['Nguyen Van An', 'vi', ['picker']], ['Kari Nordmann', 'nb', ['sprayer', 'foreman']], ['Piotr Nowak', 'pl', ['picker', 'foreman']]];
  const people = [];
  let n = 1;
  for (const [name, lang, roles] of names) {
    const { token, card } = await issueCard(t);
    const p = store.put('people', { name, lang, roles, active: true, number: n++, cards: [card] });
    DEMO_TOKENS[p.id] = token;
    people.push(p);
  }
  try { localStorage.setItem('td2.demoTokens', JSON.stringify(DEMO_TOKENS)); } catch { /* */ }
  store.put('products', { name: 'Eksempelmiddel A (fiktivt)', regNo: '0000.01', substance: 'Fiktivt virkestoff', unit: 'kg', phiDays: 3, defaultDose: 100, defaultUnit: 'g/daa', notes: 'Demodata – ikke et ekte produkt' });
  store.put('products', { name: 'Eksempelmiddel B (fiktivt)', regNo: '0000.02', substance: 'Fiktivt virkestoff', unit: 'l', phiDays: 7, defaultDose: 0.1, defaultUnit: 'l/daa', notes: 'Demodata – ikke et ekte produkt' });
  const prods = store.all('products');
  store.put('stock', { productId: prods[0].id, ts: new Date(Date.now() - 20 * 864e5).toISOString(), type: 'purchase', qty: 5, unit: 'kg', note: 'Felleskjøpet' });
  store.put('stock', { productId: prods[1].id, ts: new Date(Date.now() - 20 * 864e5).toISOString(), type: 'purchase', qty: 10, unit: 'l', note: '' });
  // Historikk: noen dager med plukking, også samme periode i fjor
  const db = { settings: store.settings(), varieties: store.all('varieties'), crateTypes: store.all('crateTypes') };
  const today = dayKey(new Date());
  const pickers = people.filter((p) => p.roles.includes('picker'));
  const fields = [f1, f2, f3];
  for (const yearOffset of [-365, 0]) {
    for (let d = 6; d >= 1; d--) {
      const key = addDays(today, -d + yearOffset);
      pickers.forEach((p, i) => {
        const start = new Date(`${key}T07:${String(10 + i * 3).padStart(2, '0')}:00`);
        const end = new Date(`${key}T15:${String(5 + i * 4).padStart(2, '0')}:00`);
        store.put('shifts', { personId: p.id, start: start.toISOString(), end: end.toISOString() });
        const f = fields[(i + d) % 3];
        const rounds = 5 + ((i * 7 + d * 3) % 6) + (yearOffset ? -1 : 0);
        for (let r = 0; r < rounds; r++) {
          const ts = new Date(start.getTime() + (r + 1) * 70 * 60000 / 1.6);
          const varietyId = f.defaultVarietyId, crateTypeId = f.defaultCrateTypeId;
          store.put('crates', { personId: p.id, fieldId: f.id, varietyId, crateTypeId, count: 2, rate: crateRate(db, { varietyId, crateTypeId }), ts: ts.toISOString(), quality: r % 5 === 0 ? 'B' : 'A' });
        }
      });
    }
  }
  // I dag: to plukkere på jobb
  for (const p of pickers.slice(0, 3)) store.put('shifts', { personId: p.id, start: new Date(`${today}T07:30:00`).toISOString(), end: null });
  store.put('crates', { personId: pickers[0].id, fieldId: f1.id, varietyId: v1.id, crateTypeId: c1.id, count: 3, rate: 38, ts: new Date(`${today}T09:10:00`).toISOString(), quality: 'A' });
  store.put('assignments', { date: today, personId: pickers[1].id, fieldId: f2.id });
  store.put('assignments', { date: today, personId: pickers[2].id, fieldId: f3.id });
  // Sprøyting på Bringebærlia for to dager siden med 7 dagers karenstid -> sperre i dag
  const sprayDate = addDays(today, -2);
  store.put('buyers', { name: 'Demo Frukt og Grønt AS (fiktiv)', orgNo: '', address: 'Torggata 1, 3000 Drammen', contact: '' });
  store.put('fertilizations', { date: sprayDate, fieldId: f3.id, fieldName: f3.name, crop: 'RUBID', areaDaa: 5.6, product: 'Eksempelgjødsel 12-4-18 (fiktiv)', kind: 'mineral', amount: 30, unit: 'kg/daa', nContent: 12, pContent: 4, kContent: 18, nPerDaa: 3.6, pPerDaa: 1.2, kPerDaa: 5.4, method: 'spread', operator: people[4].name, notes: 'Demodata' });
  store.put('sprays', { fieldId: f3.id, fieldName: f3.name, date: sprayDate, startTime: '06:30', crop: 'RUBID', areaDaa: 5.6, products: [{ productId: prods[1].id, name: prods[1].name, regNo: prods[1].regNo, dose: 0.1, unit: 'l/daa', phiDays: 7 }], target: 'Gråskimmel', operatorId: people[4].id, operator: people[4].name, phiDays: 7, weather: { temp: 14, wind: 2.1, confirmed: true } });
  store.put('tasks', { type: 'spray', fieldId: f1.id, plannedDate: addDays(today, 1), assigneeId: people[4].id, productIds: [prods[0].id], status: 'open', note: 'Forebyggende mot gråskimmel' });
}
export function demoTokens() { try { return JSON.parse(localStorage.getItem('td2.demoTokens') || '{}'); } catch { return {}; } }
