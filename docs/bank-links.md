# Bank reconciliation: current support and historical verification

## Current support (2026-10-30, grouped corrections)

The historical sections below describe earlier checkpoints. Current tools support
single draft links, single booked-entry links, reopening a single-posting approved
match, and linking/approving an original entry together with its booked correction.
The grouped path accepts exactly two native transaction IDs: a test-created original
and its explicitly marked correction. All 2–3 bank postings must be unmatched,
on the same DKK bank account, and their signed sum in cents must exactly equal
one bank line. No partial allocation, fees, differences, unrelated entries, invoices
or foreign currency are supported. Approval is separate from linking.

Grouped approved matches can now be reopened and fully unlinked with an explicit
`group:MATCH_ID` subjectReference, as verified below. Corrections of corrections
remain unsupported. Pending writes require inspection, never a retry
with a new operation ID. Concurrent Billy UI edits cannot be locked atomically.

### Live verification

Synthetic A was reopened and corrected from 120 to 125; synthetic B from 125 to120.
Both correction drafts were booked separately. A's original/correction pair was
linked to the existing 125 bank line, B's pair to the existing120 bank line.
Billy approved both matches and marked all three bank postings in each matched.
Fresh reads verified exact associations, unchanged original source revisions and
bank lines, preserved file links, and signed group totals of -125 and -120 DKK.
Approval replay returned the saved outcome without duplicate writes. A negative
125-versus120 link was rejected with BANK_DIFFERENCE and identical bank revision.
The missing-document fixture G remains an unapproved bank match and unbooked draft.
These are synthetic functional tests; retained original documents are history,
not business evidence for the changed amounts. Earlier E2E totals are checkpoints.

187 automated tests, TypeScript checking and the Worker build passed. Tests cover
exact grouped linking/approval, differences, stale revisions, invalid provenance,
missing bank legs, pending writes, replay and the Free Worker request budget.
Only the test Worker was deployed; schemas and tool count are unchanged.

## Historical phase 1

Implementeret 2026-10-30 på den isolerede testserver. 133 automatiske tests består. Inputskemaerne er uændrede; 82 værktøjer i alt. De tre funktioner har nu status implemented_phase1. Positiv integration er verificeret efter brugerens import af en syntetisk banklinje.

## Funktioner

- get_test_bank_line: læser banklinje, konto, match, matchens linjer og tilknytninger samt revisionskode. Kontoejerskab kontrolleres via account.organizationId. Matchens linjer læses for både pending og booked.
- reconcile_test_bank_line: opretter én bankLineSubjectAssociation med matchId og subjectReference. Kræver eksisterende, udtrykkeligt ikke-godkendt match med præcis én banklinje; én balanceret DKK-testkladde med præcis én linje på bankkontoen og identisk beløb og side. Kun daybookTransaction-understøttelse er forsøgt implementeret. Ingen matchoprettelse, ingen fee/difference, ingen faktura-/regningsbetaling, ingen delbeløb eller endelig godkendelse.
- unlink_test_bank_line: sletter præcis én eksisterende association til en testkladde. Match, banklinje, kladde og andre associationer bevares og kontrolleres efterfølgende. Godkendte matches afvises.

Kilde: https://www.billy.dk/api/ — bankLines, bankLineMatches, bankLineSubjectAssociations. Generisk CRUD og felter er dokumenteret; den konkrete daybookTransaction-reference er accepteret i live-testen på en ikke-godkendt afstemningsgruppe. En dokumenteret ressource er ikke i sig selv bevis for alle kombinationer af reference og tilstand.

## Sikkerhed og grænser

Skrivninger journalføres med operationId/reasoning, samme UUID/input afspiller resultatet, og et usikkert udfald låser matchmålet som pending. Revision kontrolleres før og lige inden skrivning. Kladden kontrolleres lige inden og efter. Kontrollerne er optimistiske og låser ikke Billys UI eller andre integrationsklienter atomisk.

Senere kladdeændringer kan gøre en tilknytning beløbsmæssigt forkert. Tilknytning er derfor ikke godkendelse. Fjern linket før beløbsændringer; beløb skal valideres igen, når godkendelsesværktøjet implementeres. Det nuværende kladderedigeringsværktøj blokerer ikke automatisk på banklinks.

Allerede tilknyttet samme kladde genbruges uden dublet, hvis beløb stadig stemmer. Link til et match med andre subjects afvises i fase 1. Unlink bevarer andre eksisterende subjects. Ukendt isApproved accepteres ikke som false. Multi-line matches, udenlandsk valuta, ikke-testkladder og bogførte kladder afvises.

## Genkørsel af live-test

Importér én tydeligt syntetisk banklinje i testregnskabets konto 5710 Bank, ikke i en rigtig bankforbindelse:

| Dato | Tekst | Beløb |
|---|---|---|
| 2026-10-01 | TEST BANKLINK abonnement - ingen rigtig betaling | -299,00 DKK |

Den kan matches mod den eksisterende TEST-2026-001-kladde på 299,00 DKK. CSV-eksempel ligger i tests/fixtures/bank-import.csv; formatet er en generisk datakilde, ikke verificeret som en automatisk Billy-importprofil. Vælg dato/tekst/beløb ved import, hvis brugerfladen kræver kolonnemapping. Importér kun én gang.

Testen er gennemført. Ved genkørsel: læs banklinje og revision; kontrollér det eksisterende match; link til kladden; gentag samme UUID; læs tilbage; prøv stale revision; fjern linket med frisk revision; gentag fjernelse; kontrollér banklinjen, kladden og andre links. Afslut uden at godkende. Hvis Billy ikke accepterer kladdereferencen, behold operationen til inspektion og tilpas implementeringen — kald ikke testen bestået.

## Automatiske tests

Lokal integration med simuleret Billy dækker link/unlink, replay, dubletforebyggelse, forkert beløb/side, godkendt/ukendt matchstatus, bogført kladde, flere banklinjer, anden organisation, ugyldige ID'er, stale revision, delbeløb, ikke-understøttede subject-typer, bevaring af andre links, uventet tab af links og timeout med pending-lås. Disse tests erstatter ikke positiv live-verifikation.

## Live-resultat 2026-10-30

- Den importerede banklinje var 299,00 DKK credit, dato 2026-10-01, med én eksisterende ikke-godkendt matchgruppe og ingen tilknytninger.
- Tilknytning til den eksisterende TEST-2026-001-kladde lykkedes; native readback viste én daybookTransaction-association.
- Gentaget operation med samme UUID/input gav replay.
- Ny operation med den gamle revision blev afvist med STALE_REVISION.
- Fjernelse med frisk revision slettede kun associationen. Gentagelse gav replay.
- Slutrevisionen for banklinje/konto/match/associationer var identisk med før testen. Kladdens revision inklusive linjer og PDF-bilag var også uændret.
- Match isApproved var false både før og efter. Banklinjens native status booked betyder her banklinjestatus, ikke at kladden blev bogført.
- Testbanklinjen er bevaret til videre test. Ingen godkendelse eller bogføring blev udført.


## Reopening an approved match and relinking booked entries (2026-10-30)

The existing `unlink_test_bank_line` now accepts an exact `posting:ID`
subjectReference for one native posting of an approved test-created DKK daybook
entry. The supplied bank revision and match ID are mandatory. Only a single bank
line, single association, exact amount/side, and no fees or differences are
supported. It performs native `PUT /bankLineMatches/:id` with `isApproved:false`,
verifies the match is open and the posting is unmatched, then deletes only that
association. Bank line, group, ledger entry and attachments are retained. The
completed journal result stores the prior approved match, timestamp and association.
Billy clears approvedTime on reopening; reapproval receives a new timestamp.

`reconcile_test_bank_line` also accepts one `type:transaction` native transaction
ID. It requires an empty unapproved match and one exact, unmatched bank posting.
The created association points to `posting:ID`. `approve_test_bank_match` accepts
this association and verifies the test daybook origin, exact posting, amount,
account and side before approving separately. Old draft-link behavior is retained.

Live roundtrip on synthetic E2E A (DKK 120): reopen/unlink succeeded, linking the
DKK 125 transaction was rejected without mutation, the original DKK 120 transaction
was relinked and approved. Source draft revision (including file associations),
posting IDs/amounts and bank line remained unchanged. Replay of the earlier unlink
returned the saved historical result and did not reopen the now-approved match.
Always use a fresh getter for current status, not a replay response.

180 automated tests passed, plus TypeScript checking and Worker build. New tests
cover the complete reopen/relink/reapprove flow, stale revision, foreign/non-test
sources, wrong posting, amount mismatch/partial allocation, unapproved unlink,
uncertain native writes and a one-page request-budget check. The active test Worker
has been live-verified; production is unchanged. Existing schemas/tool count are
unchanged; refreshing the connector updates descriptions only.

This step changes reconciliation associations, not accounting amounts. At this checkpoint, grouped correction reconciliation was not yet implemented;
the later verification below supersedes that limitation. Bank changes are never inferred from documents.

A timeout or unexpected readback leaves the journal pending; a two-write reopen
is not atomic. Do not retry with a new UUID or assume rollback. Inspect the exact
match, posting and journal before any recovery. Concurrent UI changes are not
atomically locked. The initial approved match is captured in the successful result;
for a pending operation, preserve the caller's preflight snapshot for investigation.


## Group reopen/unlink (2026-10-30)

`unlink_test_bank_line` accepts `subjectReference: group:MATCH_ID` with the exact
match ID, bank line ID and fresh revision. This explicitly requests removal of
all associations in a verified original/correction pair (2–3 bank postings).
A single `posting:ID` request still cannot delete its peers. Arbitrary groups,
missing/duplicate legs, unrelated transactions, stale evidence and differences
are refused before mutation. An already unapproved complete group may also be removed.

For an approved group, the handler first reopens the native match and verifies all
bank postings became unmatched. It then deletes the exact captured associations,
verifies an empty unapproved match and unchanged ledger postings/bank lines.
The completed journal retains the prior match and associations. This is not atomic:
a timeout after reopening or during deletion remains pending, and must be inspected
without a new operation ID. No automatic rollback or retry is performed.
Relinking and approval remain separate explicit operations.

Live synthetic roundtrip: reopened the 125 DKK group, removed its three associations,
relinked the same original/correction pair and approved it. Fresh reads confirmed
identical bank line, same three posting references, unchanged source review evidence
including postings/files, and approved native match. Replaying the old unlink
returned the historical result and left the newly approved group approved.
191 automated tests plus typecheck and Worker build passed, including approved and
unapproved unlink, incomplete groups, stale revisions, single-post protection,
pending reopen/delete failures, replay after reapproval and request-budget checks.
Only the isolated test Worker was deployed; existing schemas/tool count are unchanged.
