# Tryggdigital

Webapp for bærgårder, laget for mobil og nettbrett. Den kjører fra GitHub Pages og har tre roller:

- **Plukker**: starter dagen, registrerer kasser og avslutter dagen ved å skanne sin egen QR-kode. Store knapper som fungerer med hansker, tydelig lyd, vibrasjon og fullskjerm-bekreftelse, og enkel gamification (merker, personlig rekord, dager på rad).
- **Administrator**: timelønn og kassesats, lønnsliste for valgfri periode (høyeste av timelønn og kasselønn per dag), ytelsesrapporter, CSV-eksport og utskrift, QR-kort for plukkere, redigering av registreringer, og jorder tegnet på kart. Knappen «Eksporter til TrippelTex» viser bare en melding.
- **Sprøyter**: plantevernjournal per jorde. GPS foreslår jordet du står i. Eksport som CSV og maskinlesbar JSON/GeoJSON. Knappen «Send sprøyte data til myndigheter» viser bare en melding.

Språk: norsk, polsk, litauisk, ukrainsk, vietnamesisk og engelsk. Språket kan byttes når som helst med knappen øverst til høyre.

## Teknikk

- Ren HTML, CSS og JavaScript (ES-moduler) uten byggetrinn, slik at siden laster raskt på mobilnett og virker offline (service worker).
- QR- og strekkoder leses med nettleserens innebygde `BarcodeDetector` der den finnes, ellers med ZXing (WebAssembly) via [`barcode-detector`](https://github.com/Sec-ant/barcode-detector).
- Kart: [Leaflet](https://leafletjs.com/) og [Geoman](https://geoman.io/) for tegning, med Kartverkets topografiske kart (OpenStreetMap som reserve).
- Alle biblioteker ligger i `vendor/`, så appen ikke er avhengig av CDN.

## Lagring

I denne første versjonen lagres alle data i nettleseren (localStorage) på enheten som brukes. Det betyr at

- data ikke deles mellom enheter. Bruk ett nettbrett ved innleveringen, eller flytt data med «Last ned / Importer sikkerhetskopi» under Administrator → Innstillinger,
- data kan forsvinne hvis nettleserdata slettes. Ta jevnlig sikkerhetskopi.

## Lisenser for tredjepartskode

Leaflet (BSD-2-Clause), Geoman free (MIT), barcode-detector og zxing-wasm (MIT), qrcode-generator (MIT).
