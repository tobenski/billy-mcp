# Resterende standardmomskoder: Rubrik C, momsfrit salg og køb uden fradrag

Implementeret og live-testet 30. oktober 2026 i `billy-mcp-test`. De eksisterende kladde-, bogførings-, tilbageførsels- og enkeltpost-bankværktøjer er udvidet uden nye inputfelter.

## Koder og validering

| Kode | Native tag | Gruppe | Anvendelse | Krævet omsætningsrubrik |
| --- | --- | --- | --- | --- |
| SVU | `s_dk_non_eu_goods` | world | Salg af varer uden for EU | `dk_rubrik_c_all` |
| SYU | `s_dk_non_eu_services` | world | Salg af ydelser uden for EU | `dk_rubrik_c_all` |
| SOB | `s_dk_0` | local | Dansk salg med omvendt betalingspligt | `dk_rubrik_c_all` |
| SF | `s_dk_vat_exempt` | local | Momsfrit salg | Ingen |
| KF | `p_dk_no_deduction` | local | Køb uden momsfradrag eller uden moms | Ingen |

Alle fem skal være aktive, prædefinerede, tilhøre testorganisationen, have sats nul og præcis nul momskomponenter. Salgskoder skal gælde salg og ikke køb; KF skal gælde køb og ikke salg. Rubrik C skal være et prædefineret rapportfelt i samme organisation. Forkert gruppe, anvendelse, rubrik, sats eller komponent afvises før skrivning.

Kladder kræver DKK, balancerede linjer og eksplicit `amountBasis: gross` på linjer med momskode. Hele bruttobeløbet bevares på salgs-/udgiftskontoen; der må ikke dannes momsben. Kontrollen verificerer native konti, beløb, sider, valuta, momskoder og momsperiodereferencer. Rapporter returneres fortsat som Billys egne data.

Disse koder er ikke indbyrdes udskiftelige: Et nulbeløb på momskontoen dokumenterer ikke korrekt Rubrik C. SF og KF afvises derfor, hvis de er konfigureret med et omsætningsrapportfelt.

## Testresultat

`npm run check:worker`: **242 tests bestået**, TypeScript og Worker-build bestået. Nye testcases dækker alle fem konfigurationer, fejl i rubrik/applicabilitet/sats/gruppe, uventede momsben, beløbsafvigelser og omvendt side ved tilbageførsel. Banktesten omfatter alle fem koder med match, godkendelse, genåbning og frigørelse samt højst 49 upstream-kald pr. handling for en-sides fixtures.

| Live-test | Bogføring | Brutto DKK | Rubrik C efter bogføring | Tilbageførsel |
| --- | --- | ---: | ---: | --- |
| SVU | 51 | 50 | 50 | 56 |
| SYU | 52 | 50 | 100 | 57 |
| SOB | 53 | 50 | 150 | 58 |
| SF | 54 | 50 | 150 | 59 |
| KF | 55 | 240 | 150 | 60 |

Momsopgørelsen blev læst efter hver bogføring. Alle øvrige beløbsfelter forblev nul. Hver transaktion havde præcis to finansposteringer, og ingen momsposteringer.

Alle fem transaktioner blev bankmatchet, godkendt, genåbnet og frigjort. Salgene brugte en eksisterende syntetisk 50 DKK-banklinje, og KF-købet en syntetisk 240 DKK-banklinje, begge på offlinebank 5710. Oprindelige associationer og godkendelser er gendannet; banklinjernes og de oprindelige bankposteringers felter blev sammenlignet uændret.

Hvert køb/salg og dets fulde tilbageførsel giver nul pr. konto, momskode og momsperiode. Bilagsfilreferencer blev bevaret. Alle momsopgørelsens beløbsfelter var igen nul efter tilbageførslerne. Bilagene er genbrugte tekniske PDF-fixtures, ikke dokumentation for reelle handler. Bogføringerne forbliver i revisionssporet.

Ingen nye uafklarede skriveoperationer blev observeret i denne test. Den historiske KR-pending-operation fra den tidligere pakke er ikke ændret.

Deployment: `da6619501e0d4155828e3f907e8f1bdf`.

## Dækning og afgrænsning

Efter denne pakke er alle 15 prædefinerede momskoder, der blev læst i testregnskabet, understøttet i de afgrænsede DKK-forløb. Det er ikke en påstand om, at alle momssituationer eller alle brugerdefinerede koder understøttes.

Koden afgør ikke ud fra en faktura eller kundeadresse, om en konkret handel er momsfri, har leveringssted i udlandet eller er omfattet af omvendt betalingspligt. Dokumentation, kundetype og konkret momsretlig vurdering er stadig nødvendige. [Billys eksportvejledning](https://www.billy.dk/support/article/salg-af-vare-til-lande-udenfor-eu/) beskriver kontrollen af Rubrik C i momsopgørelsen.

Fortsat uden for denne pakke: vilkårlige delvise fradragsprocenter, valutaomregning, OSS, separate EU-salgsindberetninger, momsafregning/indberetning og momsbelagte erstatningskorrektioner/gruppematches. KF er nulfradrag, ikke en variabel fradragsprocent. Tilbageførsler er hele oprindelige transaktioner; bankmatch kræver først bogføring.

Næste momsdel: konkrete delvise fradragsprocenter og derefter samlet regression med blandede momskoder.
