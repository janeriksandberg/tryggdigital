// Samlinger (collections) per kunde. Speiles i firebase/firestore.rules – endringer må gjøres begge steder
// (testen tests/unit/schema.test.js sjekker at listene stemmer).
// admin: bare administrator (med tofaktor) kan endre. Øvrige kan også skrives av godkjente enheter.
export const COLLECTIONS = {
  settings: { admin: true },     // ett dokument «main»: gårdsnavn, satser, personvern, LAN-nøkkel
  people: { admin: true },       // plukkere, sprøytere, formenn (med hash av QR-nøkler)
  fields: { admin: true },       // jorder med kartgeometri og standardverdier
  varieties: { admin: true },    // bærsorter
  crateTypes: { admin: true },   // kassetyper
  products: { admin: true },     // plantevernmidler kunden bruker (eget register)
  shifts: {},                    // inn- og utstempling
  crates: {},                    // kasseleveranser
  sprays: {},                    // sprøytejournal
  stock: {},                     // lagerbevegelser for plantevernmidler
  pallets: {},                   // paller/etiketter for sporbarhet
  consents: {},                  // personvernsamtykker (hvem, versjon, språk, tid)
  assignments: {},               // plukker → jorde for en dag
  tasks: {},                     // sprøyteoppdrag
  alerts: {},                    // karenstidsvarsler
  events: {},                    // hendelseslogg (support)
};
export const COLLECTION_NAMES = Object.keys(COLLECTIONS);
export const ADMIN_COLLECTIONS = COLLECTION_NAMES.filter((c) => COLLECTIONS[c].admin);
export const DEVICE_COLLECTIONS = COLLECTION_NAMES.filter((c) => !COLLECTIONS[c].admin);
export const isAdminCollection = (c) => !!COLLECTIONS[c]?.admin;
export const META = ['_v', '_dev', '_del', '_srv', '_by'];
