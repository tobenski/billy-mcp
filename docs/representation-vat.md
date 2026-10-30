# KR: repræsentationsmoms og øreafrunding

Implementeret og live-testet 30. oktober 2026 i `billy-mcp-test`. Eksisterende værktøjer er udvidet uden nye inputfelter.

## Understøttet

Billys prædefinerede `p_dk_representation_full` (KR) med sats 0,25, lokal gruppe, kun køb, ingen omsætningsrubrik og præcis én komponent med `source: tax`, `share: 0.25` til en aktiv DKK-konto med rollen `purchaseTax`. Koden skal være aktiv og tilhøre organisationen. Andre fradragsprocenter og brugerdefinerede koder afvises fortsat.

Kladder kræver DKK og eksplicit `amountBasis: gross` på momslinjer. Kontrollen følger Billys observerede beregning i hele øre:

1. Fuld moms = afrund(bruttobeløb i øre / 5).
2. Fradragsmoms = afrund(fuld moms i øre / 4).
3. Udgift inklusive ikke-fradragsberettiget moms = brutto minus fradragsmoms.

Beløbet og momskoden sendes uændret til Billy. Beregningen bruges kun til at kontrollere native posteringer; rapporter erstattes ikke af beregnede data.

Oprettelse/opdatering, bilagsgenbrug, særskilt bogføring, enkeltpost-bankmatch, godkendelse, genåbning/frigørelse og fuld tilbageførsel anvender samme kontrol. Momsfri erstatningskorrektioner og grupper er uændrede; KR tillader kun fuld tilbageførsel, og bankmatch kræver bogføring først.

## Testresultat

`npm run check:worker`: **232 tests bestået**, TypeScript og Worker-build bestået. Testene afviser forkert sats, anvendelse, gruppe, fradragsandel, konto og rapportfelt. Både debet/kredit, minimale beløb, øreafrunding og for stort momsfradrag dækkes. Bankforløbet testes også inden for højst 49 upstream-kald pr. handling for en-sides fixtures.

| Testpost | Brutto DKK | Udgift DKK | Købsmoms DKK | Tilbageførsel |
| --- | ---: | ---: | ---: | --- |
| 43 | 240,00 | 228,00 | 12,00 | 47 |
| 44, første afrundingstest | 125,08 | 118,82 | 6,26 | 48 |
| 45, ny selvstændig kontrol efter rettelse | 125,08 | 118,82 | 6,26 | 49 |
| 46 | 125,07 | 118,82 | 6,25 | 50 |

Post 43 blev matchet/godkendt/frigjort mod en syntetisk 240 DKK-banklinje på offlinebank 5710. Oprindelig association og godkendelse er gendannet. Banklinjen og den oprindelige bankpostering blev sammenlignet uændret.

Alle fire køb er fuldt tilbageført; summen er nul pr. konto/momskode/momsperiode. Bilagsfilreferencerne er bevaret. Momsopgørelsen viste under testen 31 DKK købsmoms (native helkronerapport, finansposteringerne var i alt 30,77 DKK) og nul i de øvrige felter. Efter tilbageførsler var alle felter igen nul. PDF-bilaget er en genbrugt teknisk fixture, ikke dokumentation for et reelt restaurantbesøg.

### Fund og bevaret operationsspor

Første kontrol forventede én afrunding direkte fra bruttobeløbet og dermed 6,25 DKK for 125,08 DKK. Billy bogførte 6,26 DKK, hvorefter efterkontrollen fejlede. Den eksisterende sikkerhedsmekanisme beholdt operationen som `pending`.

Operation `b1200002-1030-4000-8000-000000000002` blev inspiceret via operationsopslag, godkendt kladde og native finansposteringer. Koden blev rettet til Billys to afrundinger. Post 44 blev derefter verificeret med den rettede kontrol og neutraliseret ved post 48. Den oprindelige bogføring blev ikke gentaget, og journalstatus blev ikke omskrevet eller låsen fjernet. Den historiske `pending`-markering består; den er ikke en ubogført kladde eller en resterende økonomisk effekt. Sikker afslutning af inspicerede pending-operationer er et særskilt næste udviklingstrin.

Endelig deployment: `ec6c5d0689ab4919b94acb0cd0009cd2`.

## Afgrænsning

Dette er støtte til den konkrete KR-konfiguration, ikke vilkårlig delvis fradragsret ved blandede aktiviteter. Programmet afgør ikke, om udgiften berettiger til KR eller skattemæssigt fradrag. Se [Skattestyrelsens vejledning om forplejning og hotel](https://skat.dk/erhverv/moms/fradrag-for-moms/udgifter-du-kan-faa-momsfradrag-for/momsfradrag-for-forplejning-og-hotel) for den konkrete vurdering. Ingen moms blev indberettet eller afregnet.
