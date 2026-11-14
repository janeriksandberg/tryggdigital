// Kryptografiske hjelpere (WebCrypto). Brukes til QR-nøkler, LAN-autentisering og krypterte sikkerhetskopier.
const enc = new TextEncoder();
const dec = new TextDecoder();
const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'.split(''); // Crockford-lignende, uten I, L, O, U

export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((x) => parseInt(x, 16)));
export function toB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** Base32-koding (5 bit per tegn). 16 tilfeldige byte (128 bit) gir 26 tegn. */
export function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export const normalizeB32 = (s) => String(s).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
export async function hmacHex(keyHex, text) {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
/** Sammenligning som ikke lekker hvor tidlig strengene er ulike. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- Krypterte sikkerhetskopier: PBKDF2-SHA256 (600 000 runder) + AES-256-GCM ----------
export const PBKDF2_ITERATIONS = 600000;
async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptJson(obj, password, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { format: 'tryggdigital-encrypted', v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) };
}
export async function decryptJson(env, password) {
  const key = await deriveKey(password, fromB64(env.salt), env.iterations);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.data));
  return JSON.parse(dec.decode(pt));
}
