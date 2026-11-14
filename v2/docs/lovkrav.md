# Regelverk som appen støtter – teknisk kartlegging

Dette er en teknisk oversikt over hvilke krav funksjonene i Tryggdigital er laget for å støtte. **Det er ikke juridisk rådgivning.** Gården er selv ansvarlig for å oppfylle kravene. Kontroller alltid gjeldende tekst hos kilden.

Status per kilde:

- **Lest**: kildeteksten er lest og innholdet er sjekket.
- **Funnet, ikke lest**: kilden er funnet (riktig dokument og adresse), men teksten kunne ikke åpnes fra arbeidsmiljøet. Innholdet må kontrolleres manuelt.

Sist oppdatert: 14. november 2026.


## Plantevern og sprøytejournal

| Krav | Hva appen gjør | Kilde | Status |
|---|---|---|---|
| Profesjonelle brukere skal føre journal over bruk av plantevernmidler | Sprøytejournal per jorde: dato, start- og sluttid, middel, dose, areal, formål, utstyr, vær og hvem som sprøytet. Utskrift og CSV. | Forskrift om plantevernmidler (FOR-2015-05-06-455), https://lovdata.no/forskrift/2015-05-06-455. Mattilsynets veileder: https://www.mattilsynet.no/planter-og-dyrking/plantevernmidler/veileder-til-forskrift-om-plantevernmidler/journalforing-ved-bruk-av-plantevernmidler/krav-til-sproytejournalen | Funnet, ikke lest. Kontroller hvilke felt og hvor lang oppbevaringstid som kreves. |
| EU: elektronisk, maskinlesbar journal med middel og godkjenningsnummer, dato, dose, sted og areal, kultur (EPPO-kode) | Lagrer reg.nr., dose per areal, areal i daa, jordet som polygon (GeoJSON), kultur med EPPO-kode. | Forordning (EU) 2023/564, vedlegg. https://eur-lex.europa.eu/eli/reg/2023/564/oj | Lest (13.11.2026). Utsettelse til 1.1.2027 i EU er funnet tidligere, men er ikke lest på nytt i dag. |
| Gjelder dette i Norge fra 2027? | Appen er klar for det, men knappen «Send til myndighetene» er ikke koblet til noe ennå. | Europalov: https://europalov.no/rettsakt/plantevernmiddelforordningen-endringsbestemmelser-om-elektronisk-format-av-registre-over/id-34150 og EØS-notat: https://www.regjeringen.no/no/sub/eos-notatbasen/notatene/2022/jan/elektronisk-sproytejournal/id3171409/ | Ikke bekreftet. Per 13.11.2026 sto rettsakten som «under vurdering» for EØS. Mattilsynet har hatt en høring om krav til elektronisk sprøytejournal: https://www.mattilsynet.no/hoeringer?bId=4000 |
| Mattilsynets format for innlesing | Feltene appen lagrer er valgt slik at de kan mappes til dette formatet (areal i daa, EPPO-koder, GeoJSON i EPSG:4326, startTid, middel). Organisasjonsnummer for eier legges inn under Innstillinger. | https://github.com/Mattilsynet/plantevernjournal-innlesing-api | Lest (13.11.2026). |
| Karenstid (tid fra sprøyting til høsting) | Beregner tidligste høstedato per jorde, sperrer eller varsler ved kasseregistrering og varsler formann. | Karenstid står på etiketten til hvert middel. Appen har ikke en offisiell, åpen kilde for preparatregisteret, så administrator legger inn karenstid selv. | Brukeren må kontrollere verdiene mot etiketten. |
| Lager av plantevernmidler | Beholdning trekkes automatisk fra sprøytejournalen; innkjøp og telling registreres. | Mattilsynets veileder om oppbevaring: https://www.mattilsynet.no/planter-og-dyrking/plantevernmidler/veileder-til-forskrift-om-plantevernmidler/oppbevaring-og-rester | Funnet, ikke lest. Appen er en hjelp til oversikt, ikke en kontroll av lagringskrav. |


## Arbeidstid og lønn

| Krav | Hva appen gjør | Kilde | Status |
|---|---|---|---|
| Arbeidsgiver skal ha oversikt over hvor mye den enkelte har arbeidet | Inn- og utstempling per person, retting med logg over hvem som endret, eksport av arbeidstid (CSV). | Arbeidsmiljøloven § 10-7. https://lovdata.no/lov/2005-06-17-62/§10-7 og Arbeidstilsynets utgave av kapittel 10: https://www.arbeidstilsynet.no/regelverk/lover/arbeidsmiljoloven/10 | Funnet, ikke lest i dag. |
| Minstelønn i jordbruks- og gartnerinæringene | Appen viser timelønn og kasselønn per dag (det høyeste gjelder). Den kontrollerer ikke at satsene er over minstelønn. | Forskrift om allmenngjøring av tariffavtale for jordbruks- og gartnerinæringene: https://www.arbeidstilsynet.no/globalassets/regelverkspdfer/forskrift-om-allmenngjoring-av-tariffavtale-for-jordbruks--og-gartnerinaringene | Funnet, ikke lest. Gjeldende minstesats er ikke lagt inn i appen; sjekk den selv. |
| Oppbevaring av regnskapsmateriale | Lønnsgrunnlag kan skrives ut og eksporteres. Selve lønnskjøringen skjer i lønnssystemet. | Bokføringsloven § 13: https://lovdata.no/lov/2004-11-19-73/§13. Skatteetaten om endring fra ti til fem år: https://www.skatteetaten.no/nn/rettskjelder/type/kunngjoringer/oppbevaringstiden-for-regnskapsmateriale-endres-fra-ti-ar-til-fem-ar/ | Funnet, ikke lest. Kontroller gjeldende oppbevaringstid. |


## Sporbarhet og mattrygghet

| Krav | Hva appen gjør | Kilde | Status |
|---|---|---|---|
| Sporbarhet ett ledd bakover og ett ledd fremover for næringsmiddelvirksomheter | QR-etiketter på paller og kasser med jorde, dato og plukker; oppslag fra etikett til sprøytinger og karenstid. | Forordning (EF) 178/2002 artikkel 18: https://eur-lex.europa.eu/eli/reg/2002/178/oj | Dokumentet er bekreftet; artikkelteksten er ikke lest i dag. |
| GLOBALG.A.P. (sertifisering) | Revisjonsgrunnlag med jorder, midler, sprøytere, journal, lager, paller og varsler, som utskrift og CSV. | GLOBALG.A.P. IFA-standarden (krever innlogging/kjøp for full tekst). | Ikke lest. Revisjonsgrunnlaget er laget for å samle dokumentasjon, ikke for å dekke alle kontrollpunkter. |


## Personvern

| Krav | Hva appen gjør | Kilde | Status |
|---|---|---|---|
| Informasjon til den registrerte (GDPR art. 13) | Personvernerklæring på plukkerens eget språk vises første gang og hver gang innholdet endres. Bekreftelsen lagres med versjon, språk, tidspunkt og enhet. | Forordning (EU) 2016/679: https://eur-lex.europa.eu/eli/reg/2016/679/oj | Dokumentet er bekreftet; artikkelteksten er ikke lest i dag. |
| Behandlingsgrunnlag (art. 6 nr. 1 b og c) | Erklæringen bygger på arbeidsavtale og rettslig forpliktelse, ikke samtykke. «Jeg har lest» betyr at informasjonen er gitt. | Som over. | Vurderingen må gjøres av gården; teksten kan suppleres under Innstillinger. |
| Databehandleravtale | Tryggdigital behandler data på vegne av gården, og Google (Firebase) er underleverandør med lagring i EU/EØS (europe-north1). | Firebase: https://firebase.google.com/terms/data-processing-terms | Ikke lest i dag. En databehandleravtale mellom gården og Tryggdigital må på plass før bruk med ekte data. |


## Vær fra MET

| Krav | Hva appen gjør | Kilde | Status |
|---|---|---|---|
| Kreditering og lisens | Viser «Data fra MET Norge (api.met.no), NLOD 2.0 / CC BY 4.0» ved værverdiene. | https://api.met.no/doc/License og https://docs.api.met.no/doc/TermsOfService | Lest 14.11.2026. |
| Bruksvilkår | Maks fire desimaler i koordinater, respekterer «Expires», få forespørsler. | Som over. | Lest. |
| Varsel er ikke måling | Appen merker verdiene som varsel og krever at sprøyteren bekrefter eller retter dem. | Faglig valg i appen. | – |
