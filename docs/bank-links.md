# Banklinjer og kladdetilknytning, fase 1

Implementeret 2026-10-30 på den isolerede testserver. 133 automatiske tests består. Inputskemaerne er uændrede; 82 værktøjer i alt. De tre nye funktioner har status implemented_awaiting_live_test. Positiv integration med Billy er IKKE verificeret: bankkontoen har nul banklinjer i både pending/booked og nul bankLineMatches.

## Funktioner

- get_test_bank_line: læser banklinje, konto, match, matchens linjer og tilknytninger samt revisionskode. Kontoejerskab kontrolleres via account.organizationId. Matchens linjer læses for både pending og booked.
- reconcile_test_bank_line: opretter én bankLineSubjectAssociation med matchId og subjectReference. Kræver eksisterende, udtrykkeligt ikke-godkendt match med præcis én banklinje; én balanceret DKK-testkladde med præcis én linje på bankkontoen og identisk beløb og side. Kun daybookTransaction-understøttelse er forsøgt implementeret. Ingen matchoprettelse, ingen fee/difference, ingen faktura-/regningsbetaling, ingen delbeløb eller endelig godkendelse.
- unlink_test_bank_line: sletter præcis én eksisterende association til en testkladde. Match, banklinje, kladde og andre associationer bevares og kontrolleres efterfølgende. Godkendte matches afvises.

Kilde: https://www.billy.dk/api/ — bankLines, bankLineMatches, bankLineSubjectAssociations. Generisk CRUD og felter er dokumenteret; den konkrete accept af daybookTransaction-reference i dette flow kræver stadig live-test. En dokumenteret ressource er ikke i sig selv bevis for alle kombinationer af reference og tilstand.

## Sikkerhed og grænser

Skrivninger journalføres med operationId/reasoning, samme UUID/input afspiller resultatet, og et usikkert udfald låser matchmålet som pending. Revision kontrolleres før og lige inden skrivning. Kladden kontrolleres lige inden og efter. Kontrollerne er optimistiske og låser ikke Billys UI eller andre integrationsklienter atomisk.

Senere kladdeændringer kan gøre en tilknytning beløbsmæssigt forkert. Tilknytning er derfor ikke godkendelse. Fjern linket før beløbsændringer; beløb skal valideres igen, når godkendelsesværktøjet implementeres. Det nuværende kladderedigeringsværktøj blokerer ikke automatisk på banklinks.

Allerede tilknyttet samme kladde genbruges uden dublet, hvis beløb stadig stemmer. Link til et match med andre subjects afvises i fase 1. Unlink bevarer andre eksisterende subjects. Ukendt isApproved accepteres ikke som false. Multi-line matches, udenlandsk valuta, ikke-testkladder og bogførte kladder afvises.

## Nødvendig live-test

Importér én tydeligt syntetisk banklinje i testregnskabets konto 5710 Bank, ikke i en rigtig bankforbindelse:

| Dato | Tekst | Beløb |
|---|---|---|
| 2026-10-01 | TEST BANKLINK abonnement - ingen rigtig betaling | -299,00 DKK |

Den kan matches mod den eksisterende TEST-2026-001-kladde på 299,00 DKK. CSV-eksempel ligger i tests/fixtures/bank-import.csv; formatet er en generisk datakilde, ikke verificeret som en automatisk Billy-importprofil. Vælg dato/tekst/beløb ved import, hvis brugerfladen kræver kolonnemapping. Importér kun én gang.

Derefter: læs banklinje og revision; kontrollér det eksisterende match; link til kladden; gentag samme UUID; læs tilbage; prøv stale revision; fjern linket med frisk revision; gentag fjernelse; kontrollér banklinjen, kladden og andre links. Afslut uden at godkende. Hvis Billy ikke accepterer kladdereferencen, behold operationen til inspektion og tilpas implementeringen — kald ikke testen bestået.

## Automatiske tests

Lokal integration med simuleret Billy dækker link/unlink, replay, dubletforebyggelse, forkert beløb/side, godkendt/ukendt matchstatus, bogført kladde, flere banklinjer, anden organisation, ugyldige ID'er, stale revision, delbeløb, ikke-understøttede subject-typer, bevaring af andre links, uventet tab af links og timeout med pending-lås. Disse tests erstatter ikke positiv live-verifikation.
