# Isoleret Billy-testforbindelse

Branch: `cloudflare/test-regnskab-api`, oprettet fra `cloudflare/read-only-mcp`
commit `08de229`. Den aktive læseforbindelse bruger fortsat sin egen branch og Worker.

Denne branch deployer som standard **kun** `billy-mcp-test`. Brug ikke dens
deploykommando på den aktive læseforbindelse. API-klient, MCP-transport og
Cloudflare Access-identitetskontrol genbruges fra læseforbindelsen.

Forbindelsen eksponerer `get_test_organization` (Vis testregnskab),
`list_accounts` (kontoplan) og `list_daybooks` (kassekladder).
De to listefunktioner genbruges fra læseforbindelsen med dens filtre og paginering.
Før data læses, kaldes `/organization` med testnøglen, og det fastlåste test-ID kræves.
Kontrollen deles kun inden for den enkelte MCP-anmodning; næste kald verificeres igen.
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

Bekræft de to listefunktioner fra ChatGPT og vælg gyldige testkonti og kassekladde. Udvid derefter med
én skrivefunktion ad gangen, først kladdeoprettelse. Ingen skriveværktøjer,
generisk raw API eller scripts eksponeres i dette trin. Alle kommende operationer
skal kontrollere tokenets regnskabs-ID før adgang; både positive og negative
tests skal dække denne kontrol. Eksisterende læseværktøjer kan indføres gradvist.
Analyse og konteringsvurderinger forbliver i chatten.
