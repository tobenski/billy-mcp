# Udvidede kladder, fase 1

Aktuel EU-udvidelse: køb af varer og ydelser i EU med fuldt fradrag understøttes nu i DKK. Se [kontrakt, momsrapport og live-test](eu-purchase-vat.md). De oprindelige afgrænsninger nedenfor er historiske for første version.

Implementeret og live-testet 2026-10-30 i det isolerede testregnskab. De to inputskemaer er uændrede; der er 84 værktøjer. 220 automatiske tests består, inklusive additive bilag og første momsudvidelse.

## Understøttet

- create_test_extended_draft: fuld balanceret kladde i DKK med almindelig dansk 25 % købsmoms/salgsmoms eller uden moms; 2–50 linjer, positive beløb med højst to decimaler og eksplicit debit/credit.
- update_test_extended_draft: ændr dato, beskrivelse, bilagsnummer og/eller erstat samtlige linjer i én PUT. Kun testværktøjernes egne kladder må ændres; bogførte poster afvises.
- get_daybook_transaction: i testserverens skrivemodus returneres desuden alle linjer, bilagstilknytninger og revision. Send revision som expectedRevision ved opdatering.
- Reasoning gemmes i operationens journal og svar, ikke som påstået revisionshistorik hos Billy.
- Replays bruger samme operationId og identisk input. Et mistet svar eller en efterfølgende kontrolfejl bliver pending og må ikke gentages med en ny UUID.

## Afgrænsning

Valuta ud over DKK, andre momskoder end standard dansk 25 %, nettobeløb, null-konti, betalingslinjer, kontakt-/faktura-/banktilknytninger og reviewNote understøttes endnu ikke. Supplerende felter afvises eksplicit; de ignoreres ikke. Bilag kan nu tilknyttes direkte med attachmentIds ved oprettelse eller opdatering. En redigering bevarer eksisterende bilag.

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

## Moms, første del: kladder (2026-10-30)

`taxRateId` kan nu være en aktiv, prædefineret standardkode `p_dk_25` eller `s_dk_25` fra samme organisation. Satsen skal være 0,25, lokal og have præcis én fuld tax-komponent med share 1 og en aktiv momskonto i organisationen. Koder vælges eksplicit af klienten; MCP udleder ikke momsbehandlingen af kontonavn eller bilag. Kontrol af fradragsret og kontering sker i chatten.

Momslinjer kræver `amountBasis: "gross"`. Beløbet er inklusive moms, sendes uændret og skal sammen med de øvrige bruttolinjer balancere. `net` afvises; kladdeværktøjet omregner ikke beløbene. Bogføringsværktøjet kontrollerer efterfølgende Billys momsopdeling i hele øre. Linjer uden momskode kan blandes med momslinjer. Ingen momskode betyder ikke automatisk en specifik momsfritagelseskode.

Ved redigering valideres både eksisterende og nye momskoder. Headerændringer bevarer momskoder; fuld linjeerstatning kan eksplicit tilføje, ændre eller fjerne dem. Readback kontrollerer taxRateId ud over beløb og øvrige linjefelter. Svar inkluderer de anvendte native momskoder og komponenter som konfigurationsoplysninger, ikke beregnede eller bogførte momsbeløb.

Det oprindelige kladdetrin dokumenterede alene lagring. Bogføring og fuld tilbageførsel af standard dansk 25 % moms er siden implementeret og live-testet; se [momsbogføring](vat-booking.md). Rettelser med erstatningslinjer på momsposter er fortsat blokeret. EU-moms, omvendt betalingspligt og delvist fradrag afvises.

Grundlag: [Billys kassekladdevejledning](https://www.billy.dk/support/article/billy-kassekladde/) beskriver inklusive-moms-beløb; [API-dokumentationen](https://www.billy.dk/api/) beskriver taxRate-relationen på daybookTransactionLines. Live-afprøvning af kladder dokumenteres nedenfor.

Live-resultat for første momsdel: købskladde 125,00 DKK med K-kode; salgskladde 125,01 DKK med S-kode. Begge gemt som draft med uændrede bruttobeløb og korrekte native taxRateId. Købskladden blev ændret til 250,01 DKK med bevaret K-kode. Replay gav ingen ny mutation; gammel revision blev afvist. Nettobeløb og repræsentationskode blev afvist. Et eksplicit negativt bogføringsforsøg blev afvist før skrivning. Begge kladder blev slettet efter testen. Ingen finans- eller momsposteringer blev oprettet; decimaltesten beviser beløbsbevaring, ikke momsafrunding ved bogføring.
