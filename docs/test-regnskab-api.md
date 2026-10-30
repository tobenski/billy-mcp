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
Ingen endelig bogføring, tilbageførsel, bilagsupload eller bankafstemning er aktiveret.

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
