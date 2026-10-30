# Udvidede kladder, fase 1

Implementeret og live-testet 2026-10-30 i det isolerede testregnskab. De to inputskemaer er uændrede; der er 84 værktøjer. 210 automatiske tests består, inklusive den additive bilagsudvidelse.

## Understøttet

- create_test_extended_draft: fuld balanceret kladde i DKK uden moms; 2–50 linjer, positive beløb med højst to decimaler og eksplicit debit/credit.
- update_test_extended_draft: ændr dato, beskrivelse, bilagsnummer og/eller erstat samtlige linjer i én PUT. Kun testværktøjernes egne kladder må ændres; bogførte poster afvises.
- get_daybook_transaction: i testserverens skrivemodus returneres desuden alle linjer, bilagstilknytninger og revision. Send revision som expectedRevision ved opdatering.
- Reasoning gemmes i operationens journal og svar, ikke som påstået revisionshistorik hos Billy.
- Replays bruger samme operationId og identisk input. Et mistet svar eller en efterfølgende kontrolfejl bliver pending og må ikke gentages med en ny UUID.

## Afgrænsning

Valuta ud over DKK, moms, null-konti, betalingslinjer, kontakt-/faktura-/banktilknytninger og reviewNote understøttes endnu ikke. Supplerende felter afvises eksplicit; de ignoreres ikke. Bilag kan nu tilknyttes direkte med attachmentIds ved oprettelse eller opdatering. En redigering bevarer eksisterende bilag.

Revisionskoden er SHA-256 af en kanonisk snapshot af header, alle linjer og bilag. Den kontrolleres ved starten og igen lige før mutation. D1 serialiserer MCP-skrivninger til samme kladde, men giver ingen atomisk lås mod ændringer i Billys brugerflade mellem kontrollen og PUT. Undgå samtidig redigering i UI. Readback er heller ikke et atomisk snapshot af flere API-kald.

## API-grundlag og live-resultater

Kilde: https://www.billy.dk/api/ — relationships og daybookTransactions. Generel dokumentation beskriver erstatning af has-many med indlejret array; ressourcetabellen markerer samtidig entryDate og lines som immutable. Den konkrete live-test viser, at dato og indlejrede linjer kan opdateres for den afprøvede draft-type. Dette beviser ikke understøttelse for bogførte poster eller andre bilagstyper.

1. Oprettede en midlertidig kladde med to linjer på 100 DKK og læste revision tilbage.
2. Tilknyttede en eksisterende syntetisk PDF og hentede en frisk revision.
3. Ændrede dato, beskrivelse og konti/beløb: tre linjer, debet 150+100 og kredit 250 DKK.
4. Readback bekræftede præcis tre nye linjer, korrekt dato og samme bilagstilknytning.
5. Samme UUID/input gav replay uden yderligere mutation.
6. Ny UUID med gammel revision blev afvist med STALE_REVISION.
7. EUR-input blev afvist uden oprettelse.
8. Fjernede kun testens nye bilagstilknytning og slettede testkladden. Den delte fil blev bevaret.

Automatiske regressionstests dækker fuld erstatning, bilagsbevaring, revisionsændring, replay, stale input, bogførte poster, ugyldig dato, ubalance, null-konti, små decimalbeløb, moms/valuta, append-fejl og timeout med pending-lås.

## Additive bilag ved oprettelse og opdatering (2026-10-30)

`attachmentIds` accepterer højst fem eksisterende bilags-ID'er i samme organisation. Værktøjet genbruger filen via en ny tilknytning til målkladden. Kildebilaget flyttes eller ændres ikke. Gentagne ID'er og flere kilder til samme fil opretter ikke ekstra filtilknytninger. Eksisterende dubletter ryddes ikke automatisk op.

Udeladt felt eller en tom liste fjerner aldrig bilag. Brug `remove_test_draft_attachment` til eksplicit fjernelse. En opdatering kan alene tilføje bilag; den sender da ingen tom kladde-PUT. En tom liste uden andre ændringer afvises.

Kildens organisation, ID og filreference valideres før skrivning, og kilden læses igen før og efter. Eksisterende målbilag og de nye tilknytninger kontrolleres efter skrivning. Kladdeændring og bilagstilknytning er flere API-kald og ikke atomiske. Fejl efter første mutation efterlader operationen pending; opret aldrig en ny UUID som automatisk retry.

Live-test med syntetiske filer: oprettelse med ét bilag; ændring fra 7 til 8 DKK samtidig med tilføjelse af et andet bilag; gentaget kilde-ID; replay; afvisning af gammel revision; bilagsopdatering med allerede tilknyttet fil uden dublet. Kildebilagene var uændrede. Begge nye tilknytninger blev fjernet med filbevaring, og den midlertidige kladde blev slettet. Ingen bogføring indgik i testen.
