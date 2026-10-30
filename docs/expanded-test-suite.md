# Udvidet Billy-testpakke

Kørt 2026-10-30 i det isolerede testregnskab. Ingen bogføring eller godkendelse.
111 automatiske tests består; TypeScript og Worker-build består.
20 integrationsscenarier: 19 bestået live, 1 kendt fejl.

## Genkørsel

1. Kør `npm ci`, `npm run typecheck`, `npm test`, `npm run build:worker`.
2. Kontrollér `get_test_organization` og at kladdeskrivning er slået til.
3. Læs dagbog, aktive DKK-konti og testbilag fra den aktuelle forbindelse. Brug aldrig produktions-ID'er eller credentials i fixtures.
4. Gem operationernes UUID'er og svar lokalt for kørslen. Genbrug samme UUID og input ved mistet svar. Ved ny uafhængig kørsel bruges nye UUID'er og et nyt testpakkepræfiks; opret ikke nye dubletter, hvis formålet kun er at læse de eksisterende testdata.
5. Gem baseline: alle kladder, linjer og bilagstilknytninger. Kontrollér dem igen ved slutningen.
6. Kør nedenstående i rækkefølge. Kladderne A og B bevares til manuel inspektion, C slettes. Sletning af C efterlader et indbakkebilag; det er observeret Billy-adfærd.
7. Markér kun et scenarie bestået efter kontrol af det faktiske svar og efterfølgende læsning. Et `pending`-svar må aldrig automatisk gentages med nyt UUID.

A: dato 2026-10-20, to debetlinjer 299,00 og 375,50 DKK, kredit 674,50 DKK, med to syntetiske PDF-bilag. Konti vælges fra testregnskabet.
B: samme dato, debet 0,10 og 0,20 DKK, kredit 0,30 DKK. PNG laves med `python tests/fixtures/make-receipt.py` (Pillow kræves).
C: midlertidig kopi af A med tydeligt andet testnavn og en genbrugt PDF.

| Nr. | Handling og forventning | Resultat 2026-10-30 |
|---|---|---|
| 01 | Læs og bevar tre eksisterende testkladder og deres bilag | Bestået |
| 02 | Opret A med tre linjer og balance 674,50 | Bestået |
| 03 | Gentag oprettelse med samme UUID/input: replay, ingen ny kladde | Bestået |
| 04 | Samme UUID med ændret input: afvis uden skrivning | Bestået |
| 05 | Ubalancerede linjer: afvis | Bestået |
| 06 | Nulbeløb: afvis | Bestået |
| 07 | Negativt beløb: afvis | Bestået |
| 08 | Umulig kalenderdato: afvis | Bestået |
| 09 | Ukendt konto: afvis uden oprettelse eller efterladt pending-lås | Fejl fundet, rettet og genprøvet: bestået |
| 10 | Opdater med forældet expectedDescription: afvis | Bestået |
| 11 | Opdater A med korrekt expectedDescription og læs tilbage | Bestået |
| 12 | Tilknyt to forskellige PDF-filer til A, bevar begge | Bestået |
| 13 | Genbrug samme PDF på A og oprindelig kladde, bevar begge links | Bestået |
| 14 | Gentag tilknytning med samme og nyt UUID: intet dubletlink | Bestået |
| 15 | Opret B med 0,10 + 0,20 = 0,30 og tilknyt PNG | Bestået |
| 16 | Download PNG, sammenlign originale bytes/hash og saml chunks | FEJL: download afvises på ændrede bytes, chunks ikke gennemført |
| 17 | Opret C, tilknyt delt PDF, slet C, gentag sletning; bevar andre links | Bestået; C's link bliver indbakkebilag |
| 18 | Læs alle kladder med pageSize=2 og datofilter | Bestået: 2+2+1, fem unikke kladder; datofilter giver A+B |
| 19 | reuse_test_inbox_attachment: behold kilde i indbakke, opret ét link, replay | Bestået live kl. 20.31 dansk tid; inkl. replay |
| 20 | remove_test_draft_attachment: fjern kun valgt link, behold fil/andre links, replay | Bestået live kl. 20.31 dansk tid; inkl. replay |

## Nye funktioner

`reuse_test_inbox_attachment` tager operationId, attachmentId, daybookTransactionId og expectedDescription. Kilden skal være ubehandlet og tilhøre testorganisationen. Funktionen genbruger filen; den flytter eller forbruger ikke indbakkeposten.

`remove_test_draft_attachment` tager samme felter. Den sletter kun en specifik tilknytning på en kladde oprettet med testværktøjerne. Den kontrollerer bagefter filens eksistens og bevaring af andre links. Den opretter ikke en ny indbakkepost.

Begge er publiceret og live-verificeret 2026-10-30 kl. 20.31 dansk tid efter opdatering af appforbindelsen. Et eksisterende indbakkebilag blev genbrugt på A; kilden og de to eksisterende links blev bevaret. Gentagelse med samme UUID gav replay, og nyt UUID genbrugte det eksisterende link uden dublet. Det nyoprettede link blev derefter fjernet, mens filen og øvrige links blev bevaret. Gentagen fjernelse med samme UUID gav replay. Slutkontrollen af alle otte bilagsposter var identisk med kontrollen før testen (ID, fil, ejer og øvrige returnerede metadata).

## Fund og resterende arbejde

- Ukendt konto gav tidligere generisk usikker-operation-fejl før POST. Preflight-fejl frigiver nu journalreservationen og siger eksplicit, at der ikke blev skrevet. En lokal regressionstest dækker gentagelse. Den gamle testreservation blev fjernet efter kontrol af kodevejen og nul kladder med operationens apiType. Samme UUID blev genprøvet live: klar afvisning og `not_found` i journalen.
- PNG upload: 7.026 bytes; Billy-filmetadata: 3.311 bytes; download-hash matcher ikke originalen. Det tyder på billedbehandling i Billy, men årsagen er ikke bevist. Den strenge kontrol er bevaret. Næste ændring bør skelne original upload fra Billys gemte repræsentation og aldrig markere ændrede bytes som originalt verificerede. PDF-download med original SHA-256 består.
- Enkelte kald fik 403 Access denied; efterfølgende sekventielle læsninger lykkedes. Årsagen er ikke isoleret.
- Sluttilstand: fem kladder, seks tilknyttede bilagsposter og to indbakkeposter (otte tilknytninger, ikke otte forskellige filer). De tre oprindelige kladder og links er bevaret.
- Momshåndtering, valuta og bogføring ligger uden for denne kladdepakke.
