# Billy MCP på Cloudflare Workers — første fase med læseadgang

Denne vejledning opretter en **ny Worker, `billy-mcp-readonly`**, fra `tobenski/billy-mcp`, branch `cloudflare/read-only-mcp`. Den eksisterende `bif-billy-mcp`, dens domæne og dens secrets bevares. Alle nedenstående ændringer foretages på den nye Worker og dens egen Access-app.

Login følger den tidligere beslutning om **ChatGPT + Cloudflare Access med Managed OAuth**. Worker-koden bruger Cloudflares autentificerede `ctx.access` og kontrollerer brugerens mailadresse mod `ALLOWED_EMAILS`. Manglende Access-identitet eller tilladelse giver afvist adgang. Cloudflare dokumenterer denne identitetsadgang for direkte kald til en Worker; der kræves ikke egen JWT-parsing. [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## Hvad denne version indeholder

| Funktion | Adfærd |
| --- | --- |
| `/mcp` | Remote MCP over Streamable HTTP med 24 læseværktøjer. |
| `billy_raw_request` | Kun GET-kald til Billy. |
| `/health` | Beskyttet status, som viser `read-only` efter godkendt login. |
| Scripts, upload og skriveværktøjer | Eksponeres ikke af Worker-versionen. |
| Regnskab | Én Billy-nøgle til ét regnskab. Alle tilladte brugere får adgang til samme regnskab. |
| Lokal kontrol | Typecheck, tests med simuleret identitet/Billy-svar og Wrangler dry-run. |

Tests med mocks og en vellykket build dokumenterer kodeforløbene. De dokumenterer ikke, at login fra ChatGPT eller forbindelsen til et rigtigt Billy-regnskab virker. De kontrolleres særskilt efter deployment.

## 1. Opret den nye Worker fra GitHub

Åbn [Cloudflare-dashboardet](https://dash.cloudflare.com/), gå til **Workers & Pages**, og opret en ny Worker med GitHub-forbindelse. Vælg `tobenski/billy-mcp`. Hvis Cloudflare beder om GitHub-adgang, giv den adgang til dette repository.

Brug følgende indstillinger ved oprettelsen eller under den nye Workers **Settings > Build/Builds**:

| Felt | Værdi |
| --- | --- |
| Worker/project name | `billy-mcp-readonly` |
| Git repository | `tobenski/billy-mcp` |
| Root directory | `/` — repositoryets rod |
| Build command | `npm run check:worker` |
| Deploy command | `npm run deploy:worker` |

**Produktionsbranchen skal være `cloudflare/read-only-mcp`.** Oprettelsesskærmen viser ikke altid et branchfelt. Hvis feltet findes, vælg arbejdsgrenen dér. Ellers vælg **Deploy** med indstillingerne ovenfor og tomme buildvariabler, og skift derefter branch på det oprettede projekt:

1. Åbn **Workers & Pages > billy-mcp-readonly > Settings > Build/Builds > Branch control**.
2. Sæt **Production branch** til `cloudflare/read-only-mcp`.
3. Gem ændringen.

Cloudflare starter som udgangspunkt med repositoryets standardbranch. Så længe Worker-ændringerne ikke er flettet ind i `main`, mangler den branch kommandoen `check:worker`. Hvis første build stopper med `Missing script: "check:worker"`, kontrollér branchen og ret den som ovenfor. Fejlen betyder, at den valgte kode ikke indeholder buildkommandoen. [Branchindstillinger](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

Hvis oprettelsesskærmen viser **Connection blocked**, kontrollér først under **Workers & Pages**, om `billy-mcp-readonly` allerede findes, og om dens Git-forbindelse er gemt under **Settings > Build/Builds**. Projekt og forbindelse kan være oprettet, selv om skærmen viser en fejl. Fejlteksten alene fortæller ikke, om årsagen er GitHub-adgang, buildtoken eller noget andet; se projektets faktiske indstillinger og eventuelle buildlogs, før du ændrer rettigheder eller opretter projektet igen.

**Efter branchskiftet skal der startes et nyt build fra arbejdsgrenen.** Push en ny ændring til `cloudflare/read-only-mcp`, efter at indstillingen er gemt. Med Builds API kan et nyt build også startes med den konkrete branch og eventuelt et commit-SHA. Brug ikke **Retry** på det gamle `main`-build som metode til at skifte kode: en retry genkører den oprindelige commit, selv om aktuelle buildindstillinger anvendes. [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/), [retry af builds](https://developers.cloudflare.com/changelog/post/2025-03-17-rerun-build/) og [buildindstillinger](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Cloudflare installerer projektets afhængigheder og kører build før deployment. Kontrollér, at et build fra `cloudflare/read-only-mcp` består og deployer den rigtige Worker, før du fortsætter til loginopsætningen. Git-forbindelsen kan efterfølgende deploye nye commits fra den valgte branch automatisk. [GitHub-integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/).

Repositoryets `wrangler.jsonc` angiver:

| Indstilling | Værdi |
| --- | --- |
| `name` | `billy-mcp-readonly` |
| `compatibility_date` | `2026-10-28` |
| `compatibility_flags` | `["nodejs_compat"]` |
| `workers_dev` | `true` |
| `preview_urls` | `false` |

**Deploy først uden Billy-nøgle og uden `ALLOWED_EMAILS`.** Konfigurationen har bevidst ingen `secrets.required`, så den første deployment kan gennemføres uden secrets. Koden afviser adgang, når den nødvendige identitet eller konfiguration mangler. Denne tilstand kaldes *fail-closed*.

Notér den **nye** `workers.dev`-adresse, som Cloudflare viser. Resten af vejledningen bruger `https://<ny-worker-adresse>` som pladsholder for netop den adresse.

## 2. Beskyt hele den nye Worker med Access

1. Åbn **Workers & Pages > billy-mcp-readonly > Access**.
2. Vælg **Protect this Worker behind Access** og derefter **All traffic**.
3. Tilknyt en politik, som tillader de ønskede mailadresser, og vælg **Apply Access**.
4. Åbn den tilhørende app under **Zero Trust > Access controls > Applications**. Tilpas om nødvendigt dens politik til **Allow**, **Include > Emails**, med de konkrete mailadresser. Sørg for, at øvrige politikker ikke giver bredere adgang.

Worker-beskyttelsen omfatter både `/mcp`, `/health` og Workers tilknyttede adresser. Opsætningen bruger direkte HTTP-adgang til Worker uden Static Assets eller et mellemliggende service binding, da disse ikke viderefører `ctx.access`. [Worker Access og begrænsninger](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## 3. Aktivér Managed OAuth på den nye Access-app

1. Find **den nye Workers Access-app** under **Zero Trust > Access controls > Applications**.
2. Vælg **Edit > Advanced settings**.
3. Aktivér **Managed OAuth**, og gem.
4. Under **Allowed redirect URIs** tilføjes den præcise callback-adresse, som ChatGPT viser for den nye forbindelse i trin 6. Kopiér adressen fra ChatGPT, når den er tilgængelig.

Access leverer OAuth-discovery og den relevante `WWW-Authenticate`-udfordring til MCP-klienten. Denne Worker implementerer derfor ikke sin egen OAuth-server. Et almindeligt browserlogin alene beviser ikke, at OAuth virker fra ChatGPT. [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).

## 4. Tilføj runtime-secrets til den nye Worker

Åbn **Workers & Pages > billy-mcp-readonly > Settings > Variables and Secrets > Add**. Vælg typen **Secret** for de to obligatoriske værdier:

| Navn | Indhold |
| --- | --- |
| `BILLY_ACCESS_TOKEN` | Billy API-nøglen til det valgte regnskab. |
| `ALLOWED_EMAILS` | Tilladte mailadresser adskilt med komma, eksempelvis `ejer@example.com,bogholder@example.com`. Brug samme personer som i Access-politikken. |

Valgfrit kan du tilføje `BILLY_ORGANIZATION_ID` for regnskabets organisations-id og `BILLY_LOCALE` for sproget. Disse almindelige konfigurationsværdier kan gemmes som runtime-variabler. Organisationen er fælles for denne Worker; opsætningen har ingen separat Billy-konto pr. bruger.

Indtast secrets direkte i Cloudflare. De skal aldrig i Git, chat, screenshots eller buildlogs. De hører til Workers **runtime**; buildmiljøets secrets er et andet sted og bliver ikke automatisk runtime-bindings. [Build- og runtime-variabler](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Vælg **Deploy** for at tage ændringerne i brug. Dette ændrer den kørende Worker. Hvis du senere bruger CLI, opretter `wrangler secret put` også en version og deployer den straks; det er ikke blot en passiv klargøring. [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 5. Kontrollér login og status

Åbn `https://<ny-worker-adresse>/health` i et privat browservindue. Log ind med en adresse, som er tilladt både i Access-politikken og i `ALLOWED_EMAILS`. Status skal vise `read-only`.

En bruger uden tilladelse skal få afvist adgang. En direkte anmodning uden en autentificeret Access-kontekst skal også afvises. At kunne åbne `/health` kontrollerer login og Worker-status; det bekræfter ikke Billy-nøglens gyldighed.

## 6. Tilslut ChatGPT med OAuth

Brug ChatGPT på web. Åbn **Plugins > + > Add custom MCP server**, og opret forbindelsen:

| Felt | Værdi |
| --- | --- |
| Name | `Billy read-only` |
| Server URL | `https://<ny-worker-adresse>/mcp` |
| Authentication | `OAuth` |

Brug OAuth-registrering via Access. Kopiér den præcise **production redirect URI** fra forbindelsens administrationsside til den nye Access-apps **Allowed redirect URIs**. ChatGPT kan anvende forskellige callback-adresser afhængigt af OAuth-serverens metadata; brug den viste adresse. Billy API-nøglen skal blive i Workerens secret og skal ikke indtastes som OAuth client secret. [ChatGPT MCP-opsætning](https://developers.openai.com/api/docs/guides/custom-mcp-server) og [OAuth og redirect URI](https://developers.openai.com/plugins/build/auth).

Gennemfør login, og kontrollér først, at forbindelsen viser **24 læseværktøjer**, uden `execute_script`, upload eller skriveværktøjer. Et efterfølgende kald til et læseværktøj er den første kontrol mod det rigtige Billy-regnskab. Vælg et afgrænset opslag, eksempelvis organisationens oplysninger.

Hvis OAuth fejler, kontrollér den nye Workers adresse, den tilhørende Access-app, Managed OAuth og den præcise callback-adresse. Et `401`-svar til en ikke-logget-ind MCP-klient bør indeholde Access' OAuth-udfordring; følg discovery-adressen fra svaret ved fejlsøgning. Fejlen kan ikke afgøres ud fra lokale mocks alene. [Access' OAuth-forløb](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).

## Lokal kontrol for udviklere

Kør fra repositoryets rod:

```sh
npm ci
npm run check:worker
```

`check:worker` samler typecheck, tests og Wrangler dry-run. Testene bruger mocks og kræver ingen rigtig Billy-nøgle. En dry-run deployer ikke Worker. Den egentlige deployment-kommando er `npm run deploy:worker`.

**Status for denne vejledning:** Cloudflare- og OpenAI-dokumentationen er gennemgået 28. oktober 2026. Deployment, live Billy-kald og ChatGPT-login er særskilte trin; de er ikke verificeret alene ved at tilføje denne kode og vejledning.
