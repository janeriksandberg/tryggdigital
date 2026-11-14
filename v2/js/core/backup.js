// Sikkerhetskopi og gjenoppretting. Formatet er JSON (valgfritt kryptert med passord, AES-256-GCM).
import * as store from './store.js';
import { COLLECTION_NAMES } from './schema.js';
import { encryptJson, decryptJson } from './crypt.js';

export const FORMAT = 'tryggdigital-backup';

/** Kopi av én kundes data fra den lokale databasen (inkludert slettemerker, så slettinger også gjenopprettes riktig). */
export function tenantBackup(meta = {}) {
  return { format: FORMAT, version: 2, kind: 'tenant', tenantId: store.tenantId(), createdAt: new Date().toISOString(), meta, collections: store.snapshot({ includeDeleted: true }) };
}
export async function seal(obj, password) { return password ? encryptJson(obj, password) : obj; }
export async function open(fileText, password) {
  let obj;
  try { obj = JSON.parse(fileText); } catch { throw new Error('not-json'); }
  if (obj.format === 'tryggdigital-encrypted') {
    if (!password) throw new Error('needs-password');
    try { obj = await decryptJson(obj, password); } catch { throw new Error('wrong-password'); }
  }
  if (obj.format !== FORMAT) throw new Error('not-backup');
  return obj;
}
export function summarize(b) {
  const cols = b.kind === 'all' ? Object.values(b.tenants || {}).map((x) => x.collections) : [b.collections];
  const count = {};
  for (const c of cols) for (const [k, arr] of Object.entries(c || {})) count[k] = (count[k] || 0) + (arr || []).filter((d) => !d._del).length;
  return count;
}

/**
 * Gjenoppretter en kundekopi til den åpne kunden. Alle dokumenter i kopien skrives på nytt med ny versjon,
 * og dokumenter som ikke finnes i kopien merkes som slettet. Endringene synkes deretter som vanlig.
 */
export function restoreTenant(b, by) {
  const keep = new Set();
  let written = 0, removed = 0;
  for (const c of COLLECTION_NAMES) {
    for (const d of b.collections?.[c] || []) {
      if (!d?.id) continue;
      keep.add(`${c}|${d.id}`);
      const { _v, _dev, _srv, ...data } = d;
      store.put(c, data, by);
      written++;
    }
  }
  for (const c of COLLECTION_NAMES) for (const d of store.all(c)) if (!keep.has(`${c}|${d.id}`)) { store.remove(c, d.id, by); removed++; }
  return { written, removed };
}
