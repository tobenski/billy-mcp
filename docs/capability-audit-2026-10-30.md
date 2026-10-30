# Status mod Numina — 30. oktober 2026

Historisk checkpoint før rapportpakken. Tre rapportkontrakter er siden aktiveret;
se [native rapporter](native-reports.md). Bankens indberettede saldo er fortsat ukendt.

Kontrolleret mod de 27 aktuelt eksponerede Numina-værktøjer, Billy-tests live-status,
registreringen i test-worker.ts, handlerkode og dokumenterede testresultater.
Ingen regnskabsændringer eller nye skriveforsøg blev foretaget ved gennemgangen.
Live-status viser 84 eksponerede Billy-testværktøjer. Roadmap-delen består af
22 kontrakter: 18 implementerede i afgrænset fase 1 og 4 stubs. Dette er ikke
18 fuldt Numina-kompatible funktioner. 23 af de 27 Numina-funktioner har en aktiv
mapping; de resterende fire peger på stubs. En mapping er ikke semantisk lighed.

Seneste suite: 193 beståede automatiserede tests, typecheck og Worker-build.
Suiten blev ikke genkørt under denne dokumentationsgennemgang. Historiske live-tests
nedenfor bygger på tidligere verificerede forløb; hele pakken er ikke genkørt i dag.

## Dækning af alle 27 Numina-funktioner

| Numina | Billy-test | Status og væsentlig forskel |
| --- | --- | --- |
| get_company_info | get_test_organization | Aktiv læsning; låst testregnskab |
| list_accounts | list_accounts | Aktiv læsning; Billy-felter og konto-ID'er |
| list_vat_codes | list_tax_rates, list_sales_tax_rules | Aktiv læsning; ikke Numinas momskoder/beløbsgrundlag |
| get_account_balances | get_test_account_balances | Stub; NOT_IMPLEMENTED verificeret live ved gennemgangen |
| get_trial_balance | get_test_trial_balance | Stub; NOT_IMPLEMENTED verificeret live ved gennemgangen |
| get_bank_balances | get_test_bank_balances | Stub; NOT_IMPLEMENTED verificeret live ved gennemgangen |
| get_bank_transaction | get_test_bank_line | Implementeret/live-testet; native match, links og revision |
| search_bank_transactions | list_bank_lines | Aktiv native søgning; konto påkrævet, sidevisning, andre filtre/fortegn |
| get_contact | get_contact | Aktiv; revision og kontaktpersoner i testskrivemodus |
| search_contacts | list_contacts | Aktiv native liste/søgning; ikke identisk Numina-kontrakt |
| create_contact | create_test_contact | Live-testet; danske firmakontakter, dubletter afvises, ingen automatisk rollesammenlægning |
| update_contact | update_test_contact | Live-testet; kun testmarkerede DK-kontakter; domainName afvises |
| get_invoice | get_invoice | Aktiv native læsning; fuld Numina-feltlighed ikke dokumenteret |
| list_invoices | list_invoices | Aktiv native læsning; filtre/status følger Billy |
| get_transaction | get_transaction, get_daybook_transaction, list_postings, list_daybook_transaction_lines | Aktiv; bogførte data og kladder læses særskilt; revisions-/reviewoplysninger |
| search_ledger_entries | list_postings, list_daybook_transactions | Aktiv, men ingen samlet Numina-søgning med begge tilstande og alle filtre |
| get_document | get_test_document | Live-testet; Billy-bilag, filmetadata/URL; ingen OCR i værktøjet |
| search_documents | search_test_documents | Live-testet, begrænset: fakturanummer afvises; valuta filtreres på den hentede side; gemte annotationsfelter søges ikke |
| create_upload_link | create_test_upload_link | Stub; alternativt upload_test_file, højst 2 MiB base64, efterfulgt af særskilt tilknytning |
| set_document_ocr | set_test_document_facts | Live-testet alternativ; særskilte annotationer i testjournalen, ikke native Billy OCR-felter |
| create_draft | create_test_extended_draft | Live-testet; balanceret DKK uden moms; ingen null-konti eller indbyggede kontakt/faktura/bank/bilagslinks |
| update_draft | update_test_extended_draft | Live-testet; egne testkladder, fuld linjeerstatning; reviewNote og valgfrie links afvises |
| delete_draft | delete_test_daybook_draft | Live-testet; kun egne testkladder; ikke generel sletning af andres kladder |
| propose_booked_change | propose_test_booked_change | Live-testet; DKK-testposter, rettelseskladde og særskilt bogføring; rettelse af rettelser afvises |
| reconcile_bank_transaction | reconcile_test_bank_line | Live-testet; én banklinje, eksakt beløb; enkeltpost eller original/rettelsespar; ingen generelle delbetalinger/gebyrer/fakturaafvikling |
| unlink_bank_transaction | unlink_test_bank_line | Live-testet; kladdelink, bogført enkeltpost og eksplicit original/rettelsesgruppe; separat genafstemning |
| resolve_review | resolve_test_review | Live-testet; rådgivende noter i testjournalen, ikke native Billy-reviewflag eller automatisk bogføringsblokering |

De brede nedarvede læseværktøjer er implementeret. Denne gennemgang har ikke
live-genafprøvet hver faktura-, moms- eller søgevariant og fastslår ikke fuld
lighed med Numina. Se de enkelte kontrakter før anvendelse.

## Øvrige funktioner og dokumenteret evidens

- PDF/PNG-upload, bilagstilknytning, download og kladdearbejde er verificeret i
  E2E-forløbet. PNG kan blive omskrevet af Billy; original byteidentitet påstås ikke.
- Bogføring, tilbageførsel, bankbevarende omkontering, beløbsrettelse samt genåbning
  og genafstemning af original/rettelsesgrupper er live-verificeret.
- Operationseftersyn viser historisk resultat og aktuelle bankdata. Det retter ikke
  pending-journaler og frigiver ikke låse. Delvise fejl er simuleret i tests.
- Kontonavne er live-testet. Positive navneændringer på brugeroprettede kontogrupper
  mangler live-test; prædefinerede grupper afvises. Se account-names.md.
- Bankimport kræver fortsat import i Billy. Der findes ikke et importværktøj her.
- Ingen af ovenstående aktiverer skrivning i produktion.

## Prioriteret næste pakke

1. **Afklar rapport- og saldoadgang.** De tre rapportstubs er vigtigst for
   afdelingsregnskaber og budgetopfølgning. Find og verificér native Billy-data for
   periodebevægelser, primo/ultimo, regnskabsår og lagret banksaldo/synkronisering.
   Manglende saldo må ikke blive nul. Tidligere undersøgelse fandt ikke sikre
   endpoints; det beviser ikke, at de ikke findes. Hvis native rapporter ikke kan
   hentes, dokumentér hullet og brug posteringer til beregninger i chatten.
   Implementér ikke en skjult saldo-/rapportmotor i MCP.
2. **Udvid almindelig bilags- og kladdebrug.** Afklar direkte/større upload og
   kontakt-/fakturatilknytning, bilagssøgning i gemte oplysninger og afvikling af
   betalinger. De nuværende separate bilagsværktøjer virker allerede for små filer.
3. **Udvid kun efter konkret behov.** Moms, valuta, delbetalinger, gebyrer og
   rettelseskæder kræver nye afgrænsninger og testdata. For de hidtidige momsfri
   foreningsforløb er de ikke første prioritet.

Færdigkriteriet for rapportpakken er dokumenterede kilder/semantik og afstemning mod
Billys egen visning eller eksport på kendte testdata — eller en tydeligt dokumenteret
API-begrænsning. Et værktøj må ikke markeres implementeret alene fordi navnet findes.

## Dokumentationsfejl fundet

Roadmap-kontrakternes gamle statuslinjer kaldte implementerede værktøjer reserverede,
og roadmap-teksten sagde fortsat, at tilbageførsel manglede. Disse dokumentationsfelter
er opdateret ved gennemgangen. Ældre scenarier/testtal er historiske checkpoints.
E2E-dokumentet er markeret som før-bankimport-checkpoint; dets tabeller er ikke
aktuelle saldi efter de senere rettelser. Live-statusværktøjets korte apiSupport-
tekster beskriver endnu ikke alle nyere gruppefunktioner; handlerne og bank-links.md
er mere præcise. Ingen runtimeændring/deployment er lavet under denne gennemgang.

## Kilder i projektet

- src/test-roadmap.ts, src/test-worker.ts og de respektive test-handlere.
- docs/bank-links.md, docs/corrections.md, docs/operation-inspection.md.
- docs/contacts.md, docs/document-facts.md, docs/document-search.md.
- docs/extended-drafts.md, docs/account-names.md, docs/e2e-test-package.md.
- Live get_test_tool_status og de tre rapportstub-kald under denne gennemgang.
