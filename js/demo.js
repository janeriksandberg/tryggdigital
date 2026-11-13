// Demodata for å prøve appen. Legges til i tillegg til eksisterende data.
import * as S from './store.js';
import { polygonAreaM2, m2ToDaa } from './geo.js';

const NAMES = ['Anna Nowak', 'Piotr Kowalski', 'Jonas Petrauskas', 'Rūta Kazlauskienė', 'Olena Shevchenko', 'Nguyen Van An', 'Tran Thi Mai', 'Marek Wiśniewski'];

function rect(lng, lat, w, hgt) {
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + w, lat], [lng + w, lat + hgt], [lng, lat + hgt], [lng, lat]]] };
}

export function seedDemo() {
  const db = S.db();
  const workers = NAMES.map((n) => S.workerByCode(`DEMO-${n.split(' ')[0].toUpperCase()}`) || S.addWorker(n, `DEMO-${n.split(' ')[0].toUpperCase()}`));
  const now = new Date();
  for (let back = 13; back >= 0; back--) {
    const day = new Date(now);
    day.setDate(now.getDate() - back);
    if (day.getDay() === 0) continue; // fri søndag
    workers.forEach((w, i) => {
      if ((back + i) % 6 === 0) return; // noen fridager
      let start = new Date(day); start.setHours(6 + (i % 2), (i * 7) % 60, 0, 0);
      if (back === 0) start = new Date(now.getTime() - (2.5 + (i % 4) * 0.6) * 3600000);
      if (back === 0) {
        if (start > now) return;
        db.shifts.push({ id: S.uid(), workerId: w.id, start: start.toISOString(), end: null });
      } else {
        const end = new Date(start); end.setHours(start.getHours() + 7 + (i % 3), (i * 13) % 60);
        db.shifts.push({ id: S.uid(), workerId: w.id, start: start.toISOString(), end: end.toISOString() });
      }
      const skill = 3.2 + ((i * 37) % 30) / 10; // kasser per time
      const hours = back === 0 ? Math.max(0, (now - start) / 3600000) : 7.5;
      const n = Math.round(skill * hours * (0.85 + ((back * 7 + i) % 5) / 15));
      for (let c = 0; c < n; c++) {
        const ts = new Date(start.getTime() + ((c + 0.5) / Math.max(n, 1)) * hours * 3600000);
        db.crates.push({ id: S.uid(), workerId: w.id, ts: ts.toISOString(), count: 1 });
      }
    });
  }
  if (!db.fields.length) {
    const defs = [
      { name: 'Jordbær Nord', crop: 'FRAAN', color: '#e11d48', g: rect(10.2420, 59.7905, 0.0040, 0.0016) },
      { name: 'Jordbær Sør', crop: 'FRAAN', color: '#db2777', g: rect(10.2425, 59.7880, 0.0035, 0.0018) },
      { name: 'Bringebær ved låven', crop: 'RUBID', color: '#7c3aed', g: rect(10.2480, 59.7890, 0.0022, 0.0012) },
    ];
    for (const d of defs) S.saveField({ id: S.uid(), name: d.name, crop: d.crop, color: d.color, geometry: d.g, areaDaa: m2ToDaa(polygonAreaM2(d.g)), createdAt: new Date().toISOString() });
  }
  if (!db.settings.farmName) Object.assign(db.settings, { farmName: 'Demogården' });
  S.save();
}
