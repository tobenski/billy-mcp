# Bankafstemning af bogførte momsposter

Aktuel EU-udvidelse: køb af varer og ydelser i EU med fuldt fradrag understøttes nu i DKK. Se [kontrakt, momsrapport og live-test](eu-purchase-vat.md). De oprindelige afgrænsninger nedenfor er historiske for første version.

Implementeret og live-testet 2026-10-30. 222 automatiske tests består. Eksisterende værktøjsnavne og inputskemaer er uændrede.

## Understøttet forløb

1. Bogfør en testoprettet DKK-kladde med standard dansk 25 % købsmoms eller salgsmoms.
2. Læs `get_test_bank_line` og brug den friske revision i `reconcile_test_bank_line` med præcis én `transaction` som subject.
3. Match kræver en tom, ikke-godkendt gruppe med præcis én banklinje. Den ene native bankpostering skal have samme konto, bruttobeløb og side. Moms- og nettobeløb kontrolleres med den eksisterende standardmomskontrol.
4. Godkend separat via `approve_test_bank_match` med ny revision. Kun bankposteringen skal få isBankMatched=true.
5. `unlink_test_bank_line` med den præcise `posting:ID` kan genåbne det godkendte match og fjerne tilknytningen. Banklinje, bogføring og bilag bevares; en ny godkendelse kræver et separat kald.

Der udføres ingen ny momsberegning til bogføring under bankafstemningen. De eksisterende native finans- og momsposteringer valideres, og match ændrer kun banktilknytning/status. Native posteringer må ikke ændres for at passe til banklinjen. Journal/replay, revisioner, beløbskontrol og pending ved usikre writes gælder uændret.

## Live-test

To eksisterende syntetiske banklinjer i offline-testbanken blev brugt midlertidigt. Deres oprindelige godkendte association blev læst og gemt før ændringer.

| Case | Bruttobankpost | Netto | Moms | Afstemning |
| --- | --- | --- | --- | --- |
| Køb | Kredit 999,95 DKK | Debet 799,96 | Debet 199,99 | Kun bankposten blev matchet |
| Salg | Debet 50,00 DKK | Kredit 40,00 | Kredit 10,00 | Kun bankposten blev matchet |

For begge cases: opret med syntetisk bilag, bogfør, fjern oprindeligt syntetisk match, tilknyt momsposten, godkend, genåbn/fjern momsmatchet, genindsæt den oprindelige post og godkend igen. Original banklinje og matchgruppe blev bevaret; den nye associations tekniske ID kan være anderledes. Begge oprindelige posting-referencer og godkendelsesstatus blev genskabt.

De nye momsposters native posteringer var byte-for-byte ens i JSON-readback før og efter afstemningsforløbet. Derefter blev de fuldt tilbageført. Hvert original/tilbageførselspar summerer til nul pr. konto, momskode og momsperiode. Testsporene og bilagene forbliver i regnskabet. Ingen reelle bankkonti blev brugt.

Replay af fjernelsen efter genskabt afstemning returnerede den gemte historiske operation og ændrede ikke det genskabte match. Et replay-resultat er ikke en frisk statuslæsning.

## Begrænsninger og test

- Kun én bogført post mod én banklinje, med standard dansk 25 % moms eller uden moms.
- Tilknytning af en momskladde før bogføring er fortsat afvist. Bogfør først og brug transaction-ID.
- Grupper af original/korrektion med moms, delbetalinger, gebyrer, differencer, valuta og særlige momskoder understøttes ikke.
- Bankmatchede momsposter kan ikke tilbageføres, før match er fjernet separat. Erstatningsrettelser med moms er fortsat blokeret.
- Enhedstesten gennemfører link/approve/reopen/unlink og kontrollerer under 50 upstream-kald pr. operation for ét-sides testdata. Større datamængder/paginering kan stadig ramme Worker-grænsen.
- Forkert native momskonto afviser både tilknytning og godkendelse før skrivning. Tidligere tests dækker beløbsafvigelse, forkert side, fremmed organisation, stale revision, timeout og replay.
