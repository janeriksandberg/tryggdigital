import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validOrgNo, cleanOrgNo, parseEnhet, parseAddresses } from '../../v2/js/core/registers.js';

test('organisasjonsnummer: kontrollsiffer (modulus 11)', () => {
  assert.equal(validOrgNo('974 760 673'), true); // Brønnøysundregistrene
  assert.equal(validOrgNo('974760674'), false);
  assert.equal(validOrgNo('12345678'), false);
  assert.equal(cleanOrgNo('NO 974 760 673 MVA'), '974760673');
});

test('svar fra Enhetsregisteret gjøres om til navn og adresse', () => {
  const e = parseEnhet({ organisasjonsnummer: '974760673', navn: 'REGISTERENHETEN I BRØNNØYSUND', forretningsadresse: { adresse: ['Havnegata 48'], postnummer: '8900', poststed: 'BRØNNØYSUND', kommune: 'BRØNNØY' } });
  assert.deepEqual(e, { orgNo: '974760673', name: 'REGISTERENHETEN I BRØNNØYSUND', address: 'Havnegata 48, 8900 BRØNNØYSUND', municipality: 'BRØNNØY', deleted: false, bankrupt: false });
  assert.equal(parseEnhet({}), null);
});

test('svar fra Kartverkets adresse-API (kontrollert mot ekte svar 14.11.2026)', () => {
  const a = parseAddresses({ adresser: [{ adressetekst: 'Havnegata 48', postnummer: '8900', poststed: 'BRØNNØYSUND', kommunenavn: 'BRØNNØY', representasjonspunkt: { epsg: 'EPSG:4258', lat: 65.4764088062106, lon: 12.212558847024415 } }, { adressetekst: 'Uten punkt' }] });
  assert.deepEqual(a, [{ text: 'Havnegata 48, 8900 BRØNNØYSUND', municipality: 'BRØNNØY', lat: 65.4764088062106, lon: 12.212558847024415 }]);
});
