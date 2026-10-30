# EU-salg: kladde, Rubrik B og bankafstemning

Implementeret og live-testet 30. oktober 2026 på `billy-mcp-test`. Ingen nye værktøjer eller inputfelter; de eksisterende værktøjer er udvidet.

## Omfang

| Kode | Native tag | Krævet rapportfelt |
| --- | --- | --- |
| SVE | `s_dk_eu_goods_rubrik_b` | `dk_rubrik_b_goods` — varer, der indberettes til EU-salg uden moms |
| SYE | `s_dk_eu_services` | `dk_rubrik_b_services` — ydelser |

Begge koder skal være aktive, prædefinerede, tilhøre testorganisationen, have sats 0 og gruppe `eu`, gælde salg og ikke køb samt have nul momskomponenter. Rapportfeltet skal være prædefineret og tilhøre samme organisation. Den anden Rubrik B for varer (`dk_rubrik_b_goods_none`) accepteres ikke.

Kladder bruger DKK, balancerede linjer og eksplicit `amountBasis: "gross"` på linjer med momskode. Her er bruttobeløbet lig fakturabeløbet. Billy bogfører beløbet uden momsben og bevarer momskoden på salgslinjen. Native posteringer kontrolleres mod beløb, konto, side, valuta, momskode og tilstedeværelse af momsperiode; Billys egne rapportdata returneres uændret.

Understøttet: opret/opdater kladde, genbrug eksisterende bilagsfiler, særskilt bogføring, bankmatch af én bogført transaktion, godkendelse, genåbning/frigørelse og fuld tilbageførsel. Tilbageførslen bevarer momskoder og filer. VAT-koder understøtter fortsat ikke erstatningskorrektioner, gruppeafstemning eller bankmatch af ubogførte kladder.

## Validering

`npm run check:worker`: **230 tests bestået**, TypeScript og Worker-build bestået. Nye tests dækker begge Rubrik B-felter, forveksling med andre rubrikker, forkert anvendelse/sats/gruppe, uventede momsben, beløbsafvigelser og tilbageførsel. Banktestene gennemfører match/godkendelse/genåbning/frigørelse for begge EU-salgstyper og kontrollerer højst 49 upstream-kald pr. handling i en-sides fixtures.

Live i testregnskabet:

| Test | Bogføring | Beløb | Observeret rapport |
| --- | --- | --- | --- |
| SVE varer | 39 | 50 DKK | Rubrik B varer +50 |
| SYE ydelser | 40 | 50 DKK | Rubrik B ydelser +50 |
| Fuld tilbageførsel SVE | 41 | 50 DKK | Neutraliserer varesalg |
| Fuld tilbageførsel SYE | 42 | 50 DKK | Neutraliserer ydelsessalg |

Begge salg blev afstemt, godkendt og frigjort mod samme syntetiske 50 DKK-banklinje på offlinebank 5710. Oprindelig association og godkendelse blev gendannet; banklinjens og den oprindelige bankposterings felter blev sammenlignet uændret. Salg + tilbageførsel giver nul pr. konto/momskode/momsperiode. Alle momsopgørelsens beløbsfelter var igen nul efter tilbageførslerne, og bilagsfilreferencer var bevaret. De genbrugte PDF'er er tekniske fixtures, ikke dokumentation for reelt EU-salg. Bogførte testposter forbliver i revisionssporet.

Deployment: `2a0c3d547f414aa3b1770e2d179c1efe`.

## Afgrænsning

Dette er en teknisk test af kassekladde og momsopgørelse. Den afgør ikke, om et konkret salg opfylder betingelserne for momsfrit EU-salg; kundens land/momsnummer, VIES, varetransport og fakturakrav kontrolleres ikke her.

Billys separate EU-salgsoversigt kræver ifølge [Billys vejledning](https://www.billy.dk/support/article/eu-salg-uden-moms/) salg via fakturamodulet med korrekt kunde- og produktopsætning. Et korrekt Rubrik B-beløb dokumenterer derfor ikke, at den separate EU-salgsoversigt/CSV er udfyldt. Ingen indberetning, momsafregning eller faktura blev sendt i testen. Fakturaforløb og separat EU-salg skal udvikles/testes særskilt.

Ikke med i denne del: salg uden for EU, OSS, andre nulmomskoder, delvist fradrag eller repræsentation.
