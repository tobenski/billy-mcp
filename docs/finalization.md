# Bogføring og bankgodkendelse, fase 1

Aktuel momsudvidelse: standard dansk 25 % moms kan bogføres og fuldt tilbageføres. Bankafstemning med moms og erstatningsrettelser med moms er fortsat afgrænset fra. Se [kontrakt og live-test](vat-booking.md). De tidligere testforløb nedenfor er historiske.

Implementeret 2026-10-30, kun i Test Regnskab API. 138 automatiske tests består. Inputskemaer og værktøjsantal er uændret (82).

## book_test_daybook_draft

Kræver en testværktøjsoprettet, balanceret DKK-kladde uden moms, valutaomregning eller betalingslinjer. Hent revision fra get_daybook_transaction og send den sammen med expectedDescription. Konti, beløb, balance og revision kontrolleres før én PUT med state=approved. Derefter kontrolleres header, alle linjer, bilag samt én native transaction og dens postings. Reasoning gemmes i journalen, ikke som påstået native Billy-historik. Bogførte poster kan ikke slettes/redigeres med kladdeværktøjerne.

## approve_test_bank_match

Kræver ét ikke-godkendt DKK-match, én banklinje og ét subject, som kan føres til en allerede godkendt test-dagbogspost. Værktøjet bogfører ikke kladder automatisk. Beløb, side, bankkonto og de faktiske bogførte postings kontrolleres igen. Den relevante posting må ikke allerede være bankmatched. Ingen gebyrer, differencer, flere banklinjer eller delbetalinger.

Revision kommer fra get_test_bank_line. Én PUT sætter match.isApproved=true. Billy konverterer ved denne handling daybookTransaction-tilknytningen til en posting-tilknytning. Efterkontrollen kræver derfor præcis én reference til den verificerede bankposting, isApproved=true og posting.isBankMatched=true — ikke at det gamle association-ID bevares.

Alle operationer bruger den eksisterende D1-journal. Samme UUID/input afspiller resultatet. Usikkert udfald efter skrivning forbliver pending; ingen automatisk gentagelse med ny UUID. Revisioner er optimistiske, ikke atomiske låse mod Billys brugerflade. API-grundlag: https://www.billy.dk/api/ (daybookTransactions, transactions, postings, bankLineMatches).

## Live-test og fund

1. Oprettede særskilt TEST-FINAL-01 med 299 DKK debet abonnement / kredit bank og genbrugte syntetisk PDF. De fem eksisterende testkladder blev bevaret.
2. Tilknyttede den importerede syntetiske banklinje til den nye kladde.
3. Bogføring lykkedes. Native transactionNo=1 og to postings verificeret, dato 2026-10-01. PDF-tilknytning bevaret. Gentagelse af bogføringsoperation gav replay.
4. Bankgodkendelse lykkedes i Billy, men den oprindelige efterkontrol forventede uændret kladdetilknytning og lod derfor operationen stå pending. Ingen ny godkendelse blev sendt.
5. Friske læsninger viste isApproved=true, korrekt posting-reference og isBankMatched=true. Den bogførte kladde, linjer og PDF var uændrede. Efterkontrollen blev rettet, og en regressionstest dækker overgang til den korrekte posting samt afvisning af en forkert posting-reference.
6. Den præcise pending-journalpost blev afsluttet efter disse uafhængige kontroller med recoveredAfterInspection=true og forklaring. Gentagelse gav derefter replay med godkendt resultat. Dette var en engangsafklaring af det konkrete testforløb, ikke en automatisk recovery-funktion.

Den rettede efterkontrol er automatisk testet mod den observerede API-adfærd; der er ikke udført endnu en ny godkendelse efter rettelsen, fordi den eneste testbanklinje allerede var godkendt.

## Sluttilstand og afgrænsning

Fem oprindelige kladder er bevaret. Én yderligere testpost på 299 DKK er bogført, med PDF og godkendt bankafstemning. Den importerede banklinje er nu brugt/godkendt og kan ikke genbruges til en ny link/unlink-test uden en særskilt tilbageførselsproces eller ny testlinje.

Tilbageførsel/korrektionsforslag er endnu ikke implementeret. Dette er testregnskabets afgrænsede bogføringsforløb, ikke frigivelse til produktionsbogføring. Moms, valuta, faktura-/regningsbetalinger og flerlinjede bankmatches er fortsat uden for fase 1.
