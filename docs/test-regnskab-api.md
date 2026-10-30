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

## Næste trin

Opdatér værktøjslisten i ChatGPT og bekræft repræsentative læsekald. Udvid derefter med
én skrivefunktion ad gangen, først kladdeoprettelse. Ingen skriveværktøjer,
raw API-skrivning eller scripts eksponeres i dette trin. Alle kommende operationer
skal kontrollere tokenets regnskabs-ID før adgang; både positive og negative
tests skal dække denne kontrol. En test sammenligner samtlige 51 læseværktøjers
schemas direkte med den oprindelige server og kontrollerer fravær af skriveværktøjer.
Analyse og konteringsvurderinger forbliver i chatten.
