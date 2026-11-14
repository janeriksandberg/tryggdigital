// Inntasting av koder med fast format, som en produktnøkkel: brukeren skriver bare tegnene,
// skilletegnene settes inn av seg selv. Innliming av hele koden, med eller uten skilletegn, virker også.

/** QR-kortet: 26 tegn base32, vist som XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX. */
export const CARD_MASK = {
  groups: [4, 4, 4, 4, 4, 4, 2],
  sep: '-',
  allowed: /[0-9A-Z]/,
  // Godtar også hele innholdet i QR-koden («TD2:…») og tegn som lett forveksles (O/0, I/L/1).
  normalize: (s) => String(s).toUpperCase().replace(/^\s*TD2:/, '').replace(/O/g, '0').replace(/[IL]/g, '1'),
};

export const maskLength = (mask) => mask.groups.reduce((a, b) => a + b, 0);

/** Bare de gyldige tegnene, i rekkefølge, høyst så mange som formatet har plass til. */
export function cleanChars(raw, mask) {
  const s = mask.normalize ? mask.normalize(raw) : String(raw);
  let out = '';
  for (const ch of s) if (mask.allowed.test(ch)) out += ch;
  return out.slice(0, maskLength(mask));
}

/** Setter inn skilletegn. Når en gruppe er full (og det kommer flere), vises neste skilletegn med en gang. */
export function formatMasked(chars, mask) {
  let out = '', i = 0;
  for (let g = 0; g < mask.groups.length && i < chars.length; g++) {
    if (g > 0) out += mask.sep;
    out += chars.slice(i, i + mask.groups[g]);
    i += mask.groups[g];
  }
  const total = maskLength(mask);
  if (chars.length > 0 && chars.length < total && boundaries(mask).includes(chars.length)) out += mask.sep;
  return out;
}

/** Hele malen, f.eks. «XXXX-XXXX-…», brukt som grå forhåndsvisning bak feltet. */
export function maskTemplate(mask, ph = '_') {
  return mask.groups.map((n) => ph.repeat(n)).join(mask.sep);
}

/** Posisjonen i den formaterte teksten etter n tegn (etter et eventuelt skilletegn som følger). */
export function caretFor(n, mask) {
  if (n <= 0) return 0;
  return n + boundaries(mask).filter((b) => b <= n).length * mask.sep.length;
}

export const isComplete = (value, mask) => cleanChars(value, mask).length === maskLength(mask);

function boundaries(mask) {
  const b = []; let s = 0;
  for (const n of mask.groups.slice(0, -1)) { s += n; b.push(s); }
  return b;
}
