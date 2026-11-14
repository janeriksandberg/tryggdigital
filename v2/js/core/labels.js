// Etikettkoder for sporbarhet. Palle: TD2P:<id>, kasse: TD2K:<dato>:<jorde-id>:<plukker-id>. Ingen navn i kodene.
export const PALLET_PREFIX = 'TD2P:';
export const CRATE_PREFIX = 'TD2K:';
/** Kasseetikett: TD2K:<dato>:<jorde-id>:<plukker-id> (ingen navn i QR-koden, bare id-er). */
export const crateCode = (date, fieldId, personId) => `${CRATE_PREFIX}${date}:${fieldId}:${personId}`;
export function parseLabel(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith(PALLET_PREFIX)) return { kind: 'pallet', id: s.slice(PALLET_PREFIX.length) };
  if (s.startsWith(CRATE_PREFIX)) { const [date, fieldId, personId] = s.slice(CRATE_PREFIX.length).split(':'); if (/^\d{4}-\d{2}-\d{2}$/.test(date) && fieldId && personId) return { kind: 'crate', date, fieldId, personId }; }
  const m = s.match(/^P-?\d{4}-?\d{1,6}$/i);
  if (m) return { kind: 'palletNo', no: s.toUpperCase() };
  return null;
}
/** Neste palle-nummer for året, f.eks. P2026-0007. */
export function nextPalletNo(pallets, year = new Date().getFullYear()) {
  const max = pallets.map((p) => String(p.no || '')).filter((n) => n.startsWith(`P${year}-`)).map((n) => Number(n.split('-')[1]) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `P${year}-${String(max + 1).padStart(4, '0')}`;
}
