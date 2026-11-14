# Sikkerhet i Tryggdigital v2

Dette er en gjennomgang av egen kode og egne sikkerhetsregler, gjort 14. november 2026. Det er ikke en ekstern penetrasjonstest. Før appen brukes med mange kunder, anbefales en uavhengig test.


## Hvordan tilgangen er bygget

| Hvem | Innlogging | Tilgang |
|---|---|---|
| Superadministrator | E-post og passord + tofaktor (TOTP). Opprettes bare manuelt i Firebase-konsollet. | Alle kunder, alle enheter, full sikkerhetskopi. |
| Administrator for en gård | E-post og passord + tofaktor (TOTP), bekreftet e-post, og oppført som administrator hos kunden. | Bare egen gård. Logges ut etter 15 minutter uten bruk. |
| Nettbrett/telefon ved gården | Anonym Firebase-innlogging, godkjent av administrator. | Lese gårdens data og skrive driftsdata (stempling, kasser, sprøyting). Kan ikke endre personer, satser eller jorder. Kan stenges fra Enheter. |
| Plukker, sprøyter, formann | QR-kort. Ingen Firebase-konto. | Bare via et godkjent nettbrett, og bare funksjonene rollen gir. Tidsavbrudd etter 15 minutter. |

Passord alene gir aldri tilgang. Det håndheves både i appen og i Firestore-reglene (`sign_in_second_factor` i tokenet).


## Testet automatisk

**Firestore-regler** (27 tester mot emulatoren, `npm run test:rules`), blant annet:

- med bare passord (uten andre faktor) eller ubekreftet e-post får en administrator ingen tilgang
- en administrator kan ikke lese eller skrive en annen kundes data, og kan ikke gjøre seg selv til superadministrator
- uten tofaktor er også superadministrator stengt ute
- et nettbrett kan ikke endre personer, satser eller jorder, ikke slette data fysisk og ikke registrere seg selv som enhet
- en eldre versjon kan ikke overskrive en nyere, og servertid kan ikke forfalskes
- en stengt enhet får ingen tilgang; uinnloggede og ukjente brukere får ingenting
- en anonym bruker kan ikke utgi seg for administrator ved å legge til et e-postfelt

**Synk mellom enheter** (Playwright mot Firebase-emulatorene, `npm run test:sync`). Enhetene er egne nettleserøkter på samme maskin, ikke fysiske nettbrett:

- en enhet kan ikke endre oppsett (jorder); endringen når aldri serveren
- en stengt enhet mister tilgangen, og de lokale dataene slettes
- enheter på lokalt nett godtar bare hverandre med gårdens felles nøkkel

**I nettleseren** (Playwright, `npm run test:e2e`):

- HTML og skript i navn på personer og jorder vises som tekst og kjøres ikke
- appen nekter å kjøre inne i en ramme på en annen side (beskyttelse mot clickjacking)
- sperrede kort og kort fra en annen gård avvises
- krypterte sikkerhetskopier kan bare åpnes med riktig passord


## Tiltak i koden

- **QR-kort**: 128 bit tilfeldig nøkkel. Bare SHA-256 av (kunde-id + nøkkel) lagres, så den som får lese databasen kan ikke lage gyldige kort. Kort kan sperres og erstattes.
- **Sikkerhetskopier**: krypteres i nettleseren med AES-256-GCM. Nøkkelen avledes fra passordet med PBKDF2-SHA256 og 600 000 runder.
- **LAN-synk mellom enheter**: enhetene beviser for hverandre at de hører til samme gård med HMAC over en tilfeldig utfordring, med en nøkkel som bare gårdens enheter har.
- **Innholdssikkerhet (CSP)**: bare egne skript; nettverk bare til Firebase, MET, kartflisene, Enhetsregisteret (data.brreg.no) og Kartverkets adresse-API (ws.geonorge.no). Til registrene sendes bare det brukeren selv søker på (organisasjonsnummer eller adresse).
- **Ingen innerHTML med brukerdata**: all tekst settes som tekst. innerHTML brukes bare for egne ikoner og QR-koder som appen genererer selv.
- **CSV-eksport**: celler som starter med `=`, `+`, `-`, `@` får en apostrof foran, så regneark ikke tolker dem som formler.
- **Ingen sporing**: Google Analytics er ikke lastet.
- **Biblioteker** ligger i repoet (ikke CDN), så en kompromittert CDN kan ikke endre appen.


## Kjente begrensninger og anbefalinger

1. **GitHub Pages kan ikke sende sikkerhetshoder** (HTTP-headere). CSP er derfor satt som `<meta>`, som ikke støtter `frame-ancestors`. Det er erstattet av en sjekk i JavaScript. Flytting til en vert som kan sende headere (for eksempel Firebase Hosting eller Cloudflare Pages) vil gi sterkere beskyttelse.
2. **Firebase App Check er ikke slått på.** App Check gjør det vanskeligere å bruke prosjektets API fra andre steder enn appen. Anbefales før åpning for mange kunder. Det krever reCAPTCHA Enterprise og må testes sammen med offline-bruk.
3. **Et QR-kort kan kopieres** (for eksempel fotograferes). Det er en iboende svakhet ved kort uten PIN. Tiltak: kortet er personlig, kan sperres med ett klikk, og alle registreringer lagres med hvilken enhet de kom fra.
4. **Enheter på samme lokale nett stoler på hverandre.** Alle godkjente enheter har gårdens felles nøkkel, og endringer som kommer fra en annen enhet over lokalt nett tas imot, også oppsett (personer, satser, jorder). Det er nødvendig for at en administrator skal kunne legge inn en ny plukker uten internett. Serveren godtar likevel aldri oppsett fra en enhet uten innlogget administrator, så et nettbrett som er tuklet med kan bare påvirke andre nettbrett lokalt, ikke serveren. Steng enheter du ikke har kontroll på.
5. **Et stjålet nettbrett** har tilgang til gårdens data til det stenges under Enheter. Bruk skjermlås på nettbrettene.
6. **Demomodus** lagrer bare lokalt og bruker oppdiktede data. Den har ingen tilgang til Firebase.
7. **Oversettelser av personvernerklæringen** er ikke kontrollert av morsmålsbrukere, se [oversettelser.md](oversettelser.md).
8. **Databehandleravtale**: før bruk med ekte personopplysninger må det finnes en avtale mellom gården (behandlingsansvarlig) og Tryggdigital (databehandler).


## Slik melder du et sikkerhetsproblem

Kontakt eieren av Tryggdigital direkte. Ikke legg sårbarheter i offentlige issues.
