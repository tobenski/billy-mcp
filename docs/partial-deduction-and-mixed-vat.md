# Delvist fradrag og samlet momsregression

Afprøvet 30. oktober 2026 i `billy-mcp-test`. **252 automatiske tests består**, inklusive TypeScript og Worker-build. Endelig deployment: `cc7a427d3fc540cd8338a21070eea605`.

## Delvist fradrag: eksplicit bogføringsforløb

Denne pakke dokumenterer og tester delvist fradrag med eksplicitte beløb i de eksisterende kladdeværktøjer. Den opretter ikke nye procentmomskoder, og MCP beregner eller godkender ikke fradragsprocenten. Det er en væsentlig forskel fra en automatisk splitmomskode.

Billy beskriver konfiguration af egne fradragskomponenter i [vejledningen om blandede aktiviteter](https://www.billy.dk/support/article/momsfradrag-ved-blandede-aktiviteter/). [API-dokumentationen](https://www.billy.dk/api/) oplyser samtidig, at egne momskoder ikke kan oprettes for alle kontoplaner. Oprettelse af egne momskoder er ikke forsøgt eller implementeret i denne pakke. De eksisterende 15 prædefinerede koders validering er uændret.

Forløbet er:

1. Fastlæg i chatten det relevante bilag, momsbeløbet, den konkrete fradragsprocent og eventuel afrunding. Procenten må ikke udledes alene af et kontonavn. Brug bilagets faktiske moms; testens momsberegninger er kun syntetiske eksempler.
2. Angiv udgiften inklusive ikke-fradragsberettiget moms i debet, det fradragsberettigede momsbeløb på den verificerede købsmomskonto i debet og betalingen på bank i kredit. Alle tre linjer er uden momskode, så der ikke beregnes moms igen.
3. Opret kladde med bilag, læs den tilbage og bogfør særskilt.
4. Kontroller både de native finansposteringer og momsopgørelsen. Kontroller købsmomskontoens rolle og den konkrete momsperiode.
5. Bankafstem den samlede betaling. En eventuel fuld tilbageførsel sker særskilt efter frigørelse af bankmatch.

Værktøjerne håndhæver almindelig balance, ejerskab, revision, bilagsbevaring og eksakt readback af de angivne finanslinjer. De håndhæver ikke, at de angivne beløb svarer til en bestemt procent eller til bilagets moms, og generelle finanslinjer uden momskode har ikke standardmomskodernes automatiske rubrikvalidering. Derfor indgår den eksplicitte rapportkontrol i forløbet. Dette er ikke delvist fradrag for EU/reverse-charge-koder eller en automatisk årsregulering.

| Test | Brutto DKK | Fuld moms i testen | Fradrag | Købsmoms DKK | Udgift DKK | Bogføring / tilbageførsel |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Eksplicit fradrag | 240,00 | 48,00 | 23 % | 11,04 | 228,96 | 61 / 68 |
| Eksplicit fradrag | 999,95 | 199,99 | 37 % | 74,00 | 925,95 | 62 / 69 |
| Eksplicit fradrag | 240,00 | 48,00 | 50 % | 24,00 | 216,00 | 63 / 70 |

Alle tre blev bankmatchet, godkendt, genåbnet og frigjort på syntetiske offlinebanklinjer. Købsmomsposteringerne fik den forventede native momsperiodereference. Rapporten viste 109 DKK købsmoms for de 109,04 DKK i finansposteringerne; Billy rapporterer hele kroner. Alle andre rapportfelter var nul på dette tidspunkt.

## Blandede momskoder

| Kladde | Indhold | Bogføring / tilbageførsel |
| --- | --- | --- |
| Danske køb | K 125 DKK + KR 100 DKK + KF 15 DKK | 64 / 71 |
| EU-køb | KVE 100 DKK + KYE 140 DKK | 65 / 72 |
| Andre køb | KYU 100 DKK + KOB 100 DKK + KVU 40 DKK | 66 / 73 |
| Alle salgskoder | S 20 DKK + SVE, SYE, SVU, SYU, SOB og SF hver 5 DKK | 67 / 74 |
| Ny kontrol efter rettelse | Samme syv salgskoder i et selvstændigt forløb | 75 / 76 |

Dermed indgår alle 15 prædefinerede koder i blandede kladder. K/KR/KF-kladden blev desuden bankafstemt; EU-/andre køb og syv-kode-salg blev kontrolleret via finans, momsrapport og fuld tilbageførsel, ikke bankafstemt i denne pakke. De enkelte koder er banktestet i tidligere pakker.

Efter de første syv originale testtransaktioner viste Billy:

| Rapportfelt | Native rapport DKK |
| --- | ---: |
| Købsmoms | 249 |
| Salgsmoms | 29 |
| Moms af varer købt i udlandet | 25 |
| Moms af ydelser købt i udlandet | 60 |
| Rubrik A varer / ydelser | 100 / 140 |
| Rubrik B varer med EU-salgsindberetning / ydelser | 5 / 5 |
| Rubrik B varer uden EU-salgsindberetning | 0 |
| Rubrik C | 15 |

De native outputs fra transaktion 64-67 er gemt som automatiske regressionstest-fixtures. Identifikatorer er erstattet med stabile aliaser; beløb, sider, koder og momskomponenter er bevaret. Testene kontrollerer også manglende poster, beløbsfejl, mistede momskoder, manglende momsperiode og omvendte sider.

## Fund: mange momskoder i tilbageførsler

Syv-kode-forløbet afslørede, at gentagen indlæsning af momsopsætningen overskred Workerens requestbudget under efterkontrol. Først blev tilbageførselskladden oprettet korrekt, men operationsloggen blev stående som pending. Det blev efterfølgende muligt at verificere og genoprette journalen for netop denne eksisterende kladde uden native skriverier. Derefter blev tilbageførslen bogført som post 74; også bogføringens efterkontrol ramte requestbudgettet.

Rettelsen genbruger den allerede validerede momsopsætning inden for samme operation og bruger den allerede hentede transaktion, mens kildekladde, bilag og finansposteringer stadig genlæses. Testene måler særskilt højst 49 upstream-kald for både oprettelse og bogføring af en syv-kode-tilbageførsel i en-sides fixtures. Den efterfølgende live-test 75/76 gennemførte alle fire operationer uden fejl: opret kladde, bogfør, foreslå tilbageførsel, bogfør tilbageførsel.

### Snæver genopretning af en tilbageførselskladde

Efter inspektion kan det nøjagtigt samme `propose_test_reversal`-kald genoprette en pending-journal, hvis der findes præcis én komplet, ubogført tilbageførselskladde. Inputfingeraftryk, target, originalrevision, header, konti, modsatte linjer og bilagsfiler skal passe. Kilde og kladde genlæses inden en betinget journalopdatering. Genopretningen har ingen Billy-skriveklient og opretter, ændrer eller bogfører ingen native records. Manglende, ændret, dubleret eller allerede bogført kladde afvises. Dette er ikke generel genopretning af alle pending-operationer.

Journalen for forslag `b1400014-1030-4000-8000-000000000003` blev genoprettet og indeholder `recovery.nativeWrites: 0`. Bogføringsoperation `b1400014-1030-4000-8000-000000000004` står fortsat historisk pending, men native post 74 er læst særskilt og verificeret som nøjagtig tilbageførsel. Den er ikke genudført. Den tidligere KR-operation `b1200002-1030-4000-8000-000000000002` er også fortsat historisk pending og økonomisk neutraliseret. Generel afslutning af bogføringsoperationers journalstatus er stadig en separat opgave.

## Slutkontrol og grænser

Alle testposter 61-76 er samlet neutrale pr. konto/momskode/momsperiode. Bilagsfiler er bevaret. Momsopgørelsens beløbsfelter er igen nul. De oprindelige associationer og godkendelser for de to anvendte offlinebanklinjer er gendannet; banklinjer og oprindelige bankposteringer er sammenlignet uændret. Testbilagene er tekniske fixtures.

Denne regression dækker de beskrevne DKK-kladdescenarier i samme åbne momsperiode. Det er ikke fuld dækning af al moms: egne procentmomskoder, automatisk fradragsberegning/årsregulering, delvist fradrag på reverse charge, lukkede eller indsendte perioder, periodeoverskridende korrektioner, valutaomregning, OSS, separat EU-salgsindberetning og myndighedsindberetning er ikke valideret her.
