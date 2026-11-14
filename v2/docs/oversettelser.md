# Språk og oversettelser

Kildespråket er norsk bokmål (`v2/js/lang/nb.js`). Mangler en tekst på et språk, vises den engelske.

| Språk | Fil | Omfang | Kontrollert av morsmålsbruker |
|---|---|---|---|
| Norsk bokmål | nb.js | Hele appen | Ja (kildetekst) |
| Engelsk | en.js | Hele appen | Nei |
| Polsk | pl.js | Det plukkere ser: kiosk, kasseregistrering, QR-kort, personvernerklæring | Nei |
| Litauisk | lt.js | Som polsk | Nei |
| Ukrainsk | uk.js | Som polsk | Nei |
| Rumensk | ro.js | Som polsk | Nei |
| Vietnamesisk | vi.js | Som polsk | Nei |

Plukkerspråkene har 171 tekster hver. Automatisk sjekk: alle plassholdere (`{name}`, `{n}` osv.) i hver oversettelse er de samme som i den norske teksten. Det sier ingenting om språklig kvalitet.

**Oversettelsene er laget av Claude (KI) og er ikke kontrollert av noen som har språket som morsmål.** Personvernerklæringen er den viktigste teksten å få kontrollert, fordi den skal gi plukkerne korrekt informasjon om hvordan opplysningene deres brukes. Inntil en kontroll er gjort, bør gården også kunne gi informasjonen muntlig eller på annen måte.

Sprøyte- og formannsvisningen er bare oversatt til norsk og engelsk, fordi sprøytere i Norge må ha autorisasjon og journalen føres for norske myndigheter.

Grunnlag for språkvalget: SSBs landbrukstelling 2020 viser at av utenlandske ansatte i hagebruket kom 47 % fra Polen, 13 % fra Litauen, 10 % fra Ukraina og 10 % fra Vietnam (https://www.ssb.no/jord-skog-jakt-og-fiskeri/landbrukstellinger/statistikk/landbruksteljing/artikler/utenlandsk-arbeidshjelp-er-viktig-i-hagebruksnaeringen). Rumensk er lagt til som ekstra språk og er ikke begrunnet i disse tallene.

## «Alle verdens språk»

Det er ikke realistisk å levere kvalitetssikrede oversettelser til alle språk. Appen er derfor laget slik at et nytt språk er én fil:

1. Kopier `v2/js/lang/pl.js` til `v2/js/lang/<språkkode>.js` og oversett tekstene.
2. Legg språket til i `v2/js/lang/index.js` (navn på eget språk, engelsk navn, locale og skriftretning `ltr` eller `rtl`).
3. Kjør `npm run build:sw` og testene.

Appen støtter høyre-til-venstre-språk (for eksempel arabisk) gjennom `dir`.

## Slik kontrollerer en morsmålsbruker

Åpne appen i demomodus, velg språket øverst til høyre og gå gjennom plukkerflyten (start dagen, lever kasse, avslutt dagen) og personvernerklæringen. Rettelser skrives direkte i språkfilen.
