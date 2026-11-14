// Oppslag i åpne, offentlige registre, slik at bonden slipper å taste inn det som allerede finnes.
//  - Enhetsregisteret (Brønnøysundregistrene): navn og adresse fra organisasjonsnummer. https://data.brreg.no/enhetsregisteret/api
//  - Kartverkets adresse-API: adresse til koordinat (for å finne gården i kartet). https://ws.geonorge.no/adresser/v1
// Oppslagene er frivillige hjelpemidler. Uten nett, eller hvis registeret ikke svarer, taster brukeren inn selv.
// Bare selve søketeksten sendes (organisasjonsnummer eller adresse), aldri persondata fra appen.
export const BRREG_URL = 'https://data.brreg.no/enhetsregisteret/api/enheter';
export const ADDRESS_URL = 'https://ws.geonorge.no/adresser/v1/sok';
export const BRREG_CREDIT = 'Enhetsregisteret, Brønnøysundregistrene';
export const ADDRESS_CREDIT = 'Adresser fra Kartverket';

export const cleanOrgNo = (v) => String(v ?? '').replace(/\D/g, '');
/** Kontrollsiffer for organisasjonsnummer (modulus 11 med vektene 3,2,7,6,5,4,3,2). */
export function validOrgNo(v) {
  const s = cleanOrgNo(v);
  if (s.length !== 9) return false;
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, x, i) => a + x * Number(s[i]), 0);
  const c = 11 - (sum % 11);
  const check = c === 11 ? 0 : c;
  return check !== 10 && check === Number(s[8]);
}

const addrText = (a) => (a ? [...(a.adresse || []), [a.postnummer, a.poststed].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');
/** Gjør om svaret fra Enhetsregisteret til det appen trenger. */
export function parseEnhet(j) {
  if (!j || !j.organisasjonsnummer) return null;
  return {
    orgNo: String(j.organisasjonsnummer), name: j.navn || '',
    address: addrText(j.forretningsadresse) || addrText(j.postadresse),
    municipality: j.forretningsadresse?.kommune || '', deleted: !!j.slettedato, bankrupt: !!j.konkurs,
  };
}
export function parseAddresses(j) {
  return (j?.adresser || []).map((a) => ({
    text: [a.adressetekst, [a.postnummer, a.poststed].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    municipality: a.kommunenavn || '', lat: a.representasjonspunkt?.lat, lon: a.representasjonspunkt?.lon,
  })).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
}

async function getJson(url, ms = 8000) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(tm); }
}
/** Slår opp en virksomhet. Gir null hvis den ikke finnes. Kaster feil uten nett. */
export async function lookupOrg(orgNo) {
  const n = cleanOrgNo(orgNo);
  if (!validOrgNo(n)) return null;
  return parseEnhet(await getJson(`${BRREG_URL}/${n}`));
}
export async function searchAddress(text, limit = 6) {
  const q = String(text || '').trim();
  if (q.length < 3) return [];
  return parseAddresses(await getJson(`${ADDRESS_URL}?sok=${encodeURIComponent(q)}&treffPerSide=${limit}`));
}
