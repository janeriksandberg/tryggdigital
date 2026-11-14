# Tryggdigital v2

Webapp for bærgårder: plukkere stempler inn og leverer kasser med QR-kort, sprøytere fører sprøytejournal, formenn ser hvem som er på jobb, og administratorer har lønn, rapporter, sporbarhet og lager. Ligger på https://tryggdigital.no/v2/. Versjon 1 i roten av repoet er uendret.

## Hovedtrekk

- Virker offline. Alt lagres først på enheten (IndexedDB) og synkes automatisk til Firestore når nettet er tilbake. Statussymbol øverst viser om enheten er tilkoblet.
- Enheter på samme nett kan synke direkte med hverandre (WebRTC) uten sky.
- Flere kunder (gårder) i samme løsning, med superadministrator for drift og støtte.
- Administrator logger alltid inn med tofaktor. Plukkere har ingen konto, bare et personlig QR-kort som kan sperres.
- Personvernerklæring på brukerens eget språk første gang og ved endringer.
- Vær fra MET (varsel, må bekreftes), import av jorder fra KML og shapefil, karenstid som sperrer eller varsler, lager av plantevernmidler, QR-etiketter og revisjonsgrunnlag.

## Dokumentasjon

- [Oppsett av Firebase](docs/oppsett-firebase.md) – stegene som må gjøres én gang
- [Regelverk appen støtter](docs/lovkrav.md) – teknisk kartlegging med kilder (ikke juridisk råd)
- [Sikkerhet](docs/sikkerhet.md)
- [Språk og oversettelser](docs/oversettelser.md)

## Utvikling

Ingen byggetrinn for appkoden. Krever Node.js 20 eller nyere.

```
npm install
npm run serve          # http://127.0.0.1:8000/v2/
npm run test:unit      # enhetstester
npm run test:rules     # Firestore-regler mot emulatoren (krever Java)
npm run test:e2e       # nettlesertester (Playwright)
npm run vendor         # bygg biblioteker i v2/vendor og service worker på nytt
npm run build:sw       # bare service worker (kjør etter hver endring i v2/)
```
