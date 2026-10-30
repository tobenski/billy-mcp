# Isoleret Billy-testforbindelse

Branch: `cloudflare/test-regnskab-api`, oprettet fra `cloudflare/read-only-mcp`
commit `08de229`. Den aktive læseforbindelse bruger fortsat sin egen branch og Worker.

Denne branch deployer som standard **kun** `billy-mcp-test`. Brug ikke dens
deploykommando på den aktive læseforbindelse. API-klient, MCP-transport og
Cloudflare Access-identitetskontrol genbruges fra læseforbindelsen.

Første trin eksponerer kun `get_test_organization` (Vis testregnskab).
Kaldet læser `/organization` med testnøglen og kræver det fastlåste test-ID.
Navnet alene er ikke en identitetskontrol.
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

Bekræft OAuth-login og `get_test_organization` fra ChatGPT. Udvid derefter med
én skrivefunktion ad gangen, først kladdeoprettelse. Ingen skriveværktøjer,
generisk raw API eller scripts eksponeres i dette trin. Alle kommende operationer
skal kontrollere tokenets regnskabs-ID før adgang; både positive og negative
tests skal dække denne kontrol. Eksisterende læseværktøjer kan indføres gradvist.
Analyse og konteringsvurderinger forbliver i chatten.
