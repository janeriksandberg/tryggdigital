// QR-kort for plukkere, sprøytere og formenn.
// Kortet inneholder en tilfeldig nøkkel på 128 bit. Systemet lagrer bare SHA-256 av (kunde-id + nøkkel),
// så selv den som får lese databasen kan ikke lage gyldige kort. Kortet kan sperres og erstattes.
import { randomBytes, base32, sha256Hex, normalizeB32 } from './crypt.js';

export const PREFIX = 'TD2';
export const TOKEN_LEN = 26; // 16 byte -> 26 base32-tegn

export function newToken() { return base32(randomBytes(16)); }
export const formatToken = (tok) => tok.match(/.{1,4}/g).join('-');
export const qrPayload = (tok) => `${PREFIX}:${tok}`;
export const tokenHash = (tenantId, tok) => sha256Hex(`${tenantId}:${normalizeB32(tok)}`);

/** Tolker innholdet i en skannet kode eller en manuelt skrevet kode. Returnerer nøkkelen eller null. */
export function parseScan(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.toUpperCase().startsWith(PREFIX + ':')) s = s.slice(PREFIX.length + 1);
  s = normalizeB32(s);
  return /^[0-9A-Z]{26}$/.test(s) ? s : null;
}

/** Finner personen et kort tilhører. people: liste fra lokal database. */
export async function findPerson(tenantId, people, raw) {
  const tok = parseScan(raw);
  if (!tok) return { error: 'format' };
  const h = await tokenHash(tenantId, tok);
  for (const p of people) {
    for (const c of p.cards || []) {
      if (c.h === h) {
        if (c.revoked) return { error: 'revoked', person: p };
        if (p.active === false) return { error: 'inactive', person: p };
        return { person: p, card: c };
      }
    }
  }
  return { error: 'unknown' };
}

/** Lager et nytt kort for en person. Returnerer { token, card } – token vises/skrives ut én gang og lagres ikke. */
export async function issueCard(tenantId) {
  const token = newToken();
  const card = { id: token.slice(0, 4) + randomBytes(2).reduce((a, b) => a + b.toString(16).padStart(2, '0'), ''), h: await tokenHash(tenantId, token), created: new Date().toISOString(), hint: token.slice(-4) };
  return { token, card };
}
export const ROLES = ['picker', 'sprayer', 'foreman'];
