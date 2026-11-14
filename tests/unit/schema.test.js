import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADMIN_COLLECTIONS, DEVICE_COLLECTIONS } from '../../v2/js/core/schema.js';

const rules = fs.readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8');
const list = (fn) => JSON.parse(rules.match(new RegExp(`function ${fn}\\(c\\) \\{ return c in (\\[[^\\]]+\\])`))[1].replace(/'/g, '"'));

test('samlingene i schema.js stemmer med sikkerhetsreglene', () => {
  assert.deepEqual(list('adminCol').sort(), [...ADMIN_COLLECTIONS].sort());
  assert.deepEqual(list('deviceCol').sort(), [...DEVICE_COLLECTIONS].sort());
});

test('alle språkfiler har de samme plassholderne som engelsk', async () => {
  const en = (await import('../../v2/js/lang/en.js')).default;
  const nb = (await import('../../v2/js/lang/nb.js')).default;
  assert.deepEqual(Object.keys(nb).sort(), Object.keys(en).sort(), 'nb og en har samme nøkler');
  const { LANGS } = await import('../../v2/js/lang/index.js');
  for (const l of LANGS) {
    const tab = (await import(`../../v2/js/lang/${l.code}.js`)).default;
    for (const [k, v] of Object.entries(tab)) {
      assert.ok(k in en, `${l.code}: ukjent nøkkel ${k}`);
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(ph(v), ph(en[k]), `${l.code}: plassholdere i ${k}`);
    }
  }
});
