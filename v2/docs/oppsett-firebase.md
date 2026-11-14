# Oppsett av Firebase for Tryggdigital v2

Prosjekt: `tryggdigital-3f5a9`. Dette er gjort allerede:

- Prosjektet er opprettet, og nettappens konfigurasjon ligger i `v2/js/config.js` (uten Google Analytics, med vilje av personvernhensyn).
- Innloggingsmetodene **E-post/passord** og **Anonym** er slått på.
- Prosjektet er oppgradert til **Identity Platform** (nødvendig for tofaktor med autentiseringsapp, TOTP).

Stegene under gjør du én gang. Alt foregår i nettleseren, i Firebase-konsollet og Google Cloud Shell. Du trenger ikke installere noe på egen maskin.

Viktig: Del aldri passord, gjenopprettingskoder eller hemmelige nøkler i chat eller e-post. Nettappens `apiKey` i `config.js` er ikke hemmelig; den identifiserer bare prosjektet. Tilgangen styres av sikkerhetsreglene og innloggingen.


## 1. Opprett Firestore-databasen (hvis den ikke finnes)

1. Åpne https://console.firebase.google.com/project/tryggdigital-3f5a9/firestore
2. Velg **Create database**.
3. Velg **Standard edition** hvis du blir spurt, og database-ID `(default)`.
4. Lokasjon: **europe-north1 (Finland)**. Lokasjonen kan ikke endres senere, så sjekk den før du går videre.
5. Velg **Start in production mode**. Da er alt stengt til vi legger inn reglene i steg 4.


## 2. Slå på tofaktor med autentiseringsapp (TOTP)

TOTP kan ikke slås på i konsollet, bare via API. Slik gjør du det:

1. Åpne https://console.cloud.google.com/?project=tryggdigital-3f5a9 og klikk ikonet **Activate Cloud Shell** (`>_`) øverst til høyre.
2. Lim inn denne kommandoen og trykk Enter:

```
curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/tryggdigital-3f5a9/config?updateMask=mfa" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: tryggdigital-3f5a9" \
  -d '{"mfa":{"providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":5}}]}}'
```

3. Svaret skal inneholde `"state": "ENABLED"` og `"totpProviderConfig"`. Får du feil om tilgang, sjekk at du er logget inn med kontoen som eier prosjektet.

Kilde: Firebase-dokumentasjonen «Add TOTP multi-factor authentication to your web app» (https://firebase.google.com/docs/auth/web/totp-mfa).


## 3. Godkjenn domenet tryggdigital.no

1. Åpne https://console.firebase.google.com/project/tryggdigital-3f5a9/authentication/settings
2. Under **Authorized domains**, klikk **Add domain** og legg til `tryggdigital.no`.
3. Legg også til `www.tryggdigital.no` hvis du bruker den adressen.


## 4. Legg inn sikkerhetsreglene og indeksen

Reglene ligger i `firebase/firestore.rules` i repoet og er testet automatisk (27 tester mot Firestore-emulatoren).

Viktig: Reglene ble utvidet 14. november 2026 med tre nye samlinger (gjødsling, kjøpere og leveranser). Har du publisert reglene før dette, må du lime inn og publisere dem på nytt. Til det er gjort, virker alt annet som før, men gjødsling og leveranser blir liggende på enheten og synkes ikke.

Enkleste måte, i konsollet:

1. Åpne https://console.firebase.google.com/project/tryggdigital-3f5a9/firestore/rules
2. Slett alt i editoren, lim inn hele innholdet i `firebase/firestore.rules` og klikk **Publish**.
3. Åpne fanen **Indexes**, velg **Single field** og klikk **Add exemption**:
   - Collection ID: `admins`
   - Field path: `email`
   - Kryss av for **Collection group** med **Ascending**, og behold **Collection** med **Ascending**.
   - Lagre. Det tar noen minutter før indeksen er klar.

Alternativ med kommandolinje i Cloud Shell (gjør det samme):

```
git clone https://github.com/janeriksandberg/tryggdigital.git
cd tryggdigital
npx -y firebase-tools login --no-localhost
npx -y firebase-tools deploy --only firestore:rules,firestore:indexes --project tryggdigital-3f5a9 --config firebase/firebase.json
```

Er repoet privat, ber `git clone` om innlogging. Bruk da konsoll-metoden over.


## 5. Lag din egen administratorkonto

1. Gå til https://tryggdigital.no/v2/#/login
2. Velg **Opprett konto**, bruk din e-post og et sterkt passord du velger selv (gjerne fra en passordbehandler).
3. Bekreft e-postadressen via lenken du får.
4. Logg inn og følg veiviseren for tofaktor: skann QR-koden med en autentiseringsapp (for eksempel Google Authenticator, Microsoft Authenticator eller 1Password) og skriv inn koden.


## 6. Gjør deg selv til superadministrator

Superadministrator kan bare opprettes manuelt i konsollet. Det er med vilje.

1. Åpne https://console.firebase.google.com/project/tryggdigital-3f5a9/authentication/users og kopier **User UID** for kontoen din.
2. Åpne https://console.firebase.google.com/project/tryggdigital-3f5a9/firestore/data
3. Klikk **Start collection**, skriv `superadmins`.
4. Document ID: lim inn UID-en. Legg til ett felt, for eksempel `note` (string) med verdien `eier`. Lagre.
5. Logg ut og inn igjen i appen. Du ser nå **Superadministrator** i menyen.


## 7. Første kunde og første nettbrett

1. Under **Superadministrator → Kunder**, opprett en kunde (gård) og skriv inn e-posten til gårdens administrator. Den personen lager sin egen konto som i steg 5.
2. Administratoren går til **Enheter** og kobler til nettbrettet ved innleveringen. Nettbrettet logger inn anonymt og blir godkjent av administratoren. Plukkere og sprøytere får aldri egne Firebase-kontoer; de logger inn med QR-kortet sitt.


## Ting du ikke skal slå på

- **Automatisk opprydding av anonyme kontoer** (Authentication → Settings). Den sletter anonyme kontoer etter 30 dager, og da mister nettbrettene tilgangen.
- **Google Analytics**. Appen trenger det ikke, og personvernerklæringen nevner det ikke.


## Kostnader

Prosjektet kan kjøre på gratisplanen (Spark). Med Identity Platform på gratisplanen er det en grense på antall daglig aktive brukere. Bare administratorer og nettbrett er brukere; plukkere teller ikke, fordi de ikke har egne kontoer. Sjekk gjeldende grenser på https://firebase.google.com/pricing før du får mange kunder.
