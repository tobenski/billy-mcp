# Isoleret Billy-testforbindelse

Branch: `cloudflare/test-regnskab-api`, oprettet fra `cloudflare/read-only-mcp`
commit `08de229`. Den aktive læseforbindelse bruger fortsat sin egen branch og Worker.

Denne branch deployer som standard **kun** `billy-mcp-test`. Brug ikke dens
deploykommando på den aktive læseforbindelse. API-klient, MCP-transport og
Cloudflare Access-identitetskontrol genbruges fra læseforbindelsen.

Forbindelsen eksponerer alle 51 læseværktøjer fra læseforbindelsen samt
`get_test_organization` (Vis testregnskab), i alt 52 værktøjer.
Den bruger samme registerfunktion, schemas, filtre og paginering som læseforbindelsen.
`billy_raw_request` er fortsat kun GET og går gennem samme identitetskontrol.
Eksplicitte organisations-ID'er i organisationsopslag og query-parametre
afvises, hvis de peger på et andet regnskab.
Før data læses, kaldes `/organization` med testnøglen, og det fastlåste test-ID kræves.
Kontrollen deles kun inden for den enkelte MCP-anmodning; næste kald verificeres igen.
Navnet alene er ikke en identitetskontrol.
Det fastlåste ID ligger i runtime-binding `BILLY_TEST_ORGANIZATION_ID`, ikke i koden.
Manglende ID afviser adgang; MCP-kald kan ikke ændre det.
Nøglen ligger i Worker-secret `BILLY_API_KEY`; den findes ikke i repositoryet.
`ALLOWED_EMAILS` og en separat Cloudflare Access-app med Managed OAuth kræves.
Uden godkendt Access-identitet afviser Worker alle ruter.

MCP-adresse: test-Workerens egen adresse med stien `/mcp`.
Den tidligere midlertidige `/verify/...`-rute erstattes af beskyttet MCP og health.

## Kontrol og deployment

Kør `npm run check:worker`. Det omfatter typecheck, tests og en build uden deployment.
`npm run deploy:worker` deployer den separate test-Worker. Bevar dens eksisterende
secret ved deployment; kopier aldrig BIF-nøglen eller produktionsbindings.
Automatisk Git-build skal i givet fald kobles til denne branch og denne Worker.

## Kladdefunktioner (valgfri aktivering)

`BILLY_TEST_DRAFT_WRITES=enabled` og D1-binding `TEST_WRITE_JOURNAL` aktiverer
fire ekstra værktøjer: `create_test_daybook_draft`, `update_test_daybook_draft`,
`delete_test_daybook_draft` og `get_test_write_operation`. I alt 56 værktøjer.
Uden aktiveringen er de oprindelige 52 tilgængelige. Manglende journal ved
aktivering afviser alle kald. Kør `migrations/0001_test_write_journal.sql` først.
Bevar runtime-bindings ved deployment; database-ID og regnskabs-ID er ikke kildekode.

Oprettelse kræver balancerede linjer, gyldig dato, eksplicit kassekladde og
konti fra testregnskabet. Første trin understøtter regnskabets basisvaluta,
positive beløb med højst to decimaler og ingen momskoder eller modkontogenveje.
Der oprettes altid draft. Genlæsning returnerer hoved og alle linjer.
Rettelser omfatter beskrivelse, udvidet beskrivelse og bilagsnummer. Dato, beløb
og konti er dokumenteret immutable i Billy API og ændres ikke. Sletning og
rettelser kræver draft, korrekt organisation og værktøjets `mcp-test:`-mærke.
Ingen endelig bogføring, tilbageførsel eller bankafstemning er aktiveret.
Bilagsfunktionerne beskrives nedenfor.

Hvert skrivekald skal have et nyt UUID `operationId`; et genforsøg skal bruge
præcis samme UUID og input. D1 reserverer UUID før skrivning og gemmer resultatet.
Et gentaget afsluttet kald returnerer det gemte resultat (ikke en ny live-læsning).
Samme UUID med andre data afvises. En unik databaseindeks-lås blokerer samtidige
ændringer af samme kladde. Et timeout eller en fejl efter mulig skrivning beholder
status pending og blokerer genforsøg. `get_test_write_operation` viser input
og status. Pending er ikke bevis for, at Billy intet har gemt. Undersøg Billy
via apiType `mcp-test:<operationId>` og læseværktøjerne; opret aldrig bare et nyt
UUID for at omgå en uafklaret handling. Manuel afklaring af journalen kræves
ved uafklaret udfald. Der findes endnu ikke et automatisk afklaringsværktøj.

De lokale tests bruger syntetiske Billy-svar. Live-test skal efter opdatering
af MCP-værktøjslisten udføre create → read → update → read → delete → list
samt gentagelse med samme UUID. Registrer live-resultatet separat.
Analyse og konteringsvurderinger forbliver i chatten.

## Bilag: upload, tilknytning og genhentning

Med kladdeskrivning aktiveret er yderligere tre værktøjer tilgængelige (59 i alt):

- `upload_test_file`: PDF, PNG, JPEG eller GIF som canonical base64, højst 2 MiB.
  Filnavn, MIME-type og filsignatur kontrolleres. Filindhold gemmes ikke i journalen;
  den gemmer fil-ID, størrelse og SHA-256. Ingen OCR eller automatisk bilagsoprettelse.
- `attach_test_file_to_draft`: bruger uploadens operations-ID og en eksisterende
  testkladde. Tilknytningen oprettes separat via attachments og genlæses. Eksisterende
  bilag bevares. Samme fil på samme kladde genbruges frem for at oprette dubletter.
- `download_test_file`: genhenter filen via Billy-metadata uden API-nøgle på download-
  anmodningen. Kontrollerer SHA-256 og størrelse mod uploaden. Som standard returneres
  kun kontrolresultat; `includeContent` giver base64 i bidder på højst 65536 bytes.
  `nextOffset` viser, om flere bidder skal hentes. Arbitrære URL'er og redirects afvises.

Upload og tilknytning har hver sit operations-ID. En vellykket upload må genbruges
ved en ny tilknytning. Uafklarede uploads må ikke gentages med et nyt operations-ID.
Der er ingen funktion til at slette selve filen; syntetiske testfiler kan blive i Billy.
Kladder kan stadig slettes med kladdeværktøjet. Kontrollér bilagsrelationerne bagefter.

Live-kladdetest 2026-10-30: tre linjer 60+40 debet/100 kredit, genlæsning, gentagelse
uden dublet, tekstrettelse, afvisning af ubalance og ændret input med samme UUID,
samt sletning bestod. Efter testen var der ingen kladder eller bogførte transaktioner.
Bilagsværktøjerne har lokale tests, men afventer live-test efter MCP-opdatering.

