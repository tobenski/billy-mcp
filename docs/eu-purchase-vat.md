# EU-køb med fuldt fradrag – første EU-pakke

Implementeret og live-testet 2026-10-30. 224 automatiske tests består. Eksisterende inputskemaer og værktøjer er bevaret.

## Kontrakt

EU-varekøb bruger Billys aktive prædefinerede kode p_dk_eu_goods_full (KVE); EU-ydelseskøb bruger p_dk_eu_services_full (KYE). Begge kræver DKK, fuldt fradrag, nul leverandørmoms og eksplicit valgt momskode. Fakturabeløbet sendes uændret med amountBasis: gross. Her er leverandørens brutto- og nettobeløb ens, fordi leverandørmomsen er nul. Værktøjet tilføjer ikke 25 % til betalingen.

Kladdens oprettelse/redigering, bilag, separat bogføring, fuld tilbageførselskladde og separat bogføring af denne understøttes. Bankafstemning gælder præcis én bogført EU-post mod én banklinje med samme bankkonto, beløb og side, inklusive godkendelse, genåbning og fjernelse.

## Kontroller

Momskoden skal høre til testorganisationen, være aktiv/prædefineret, have rate=0, EU-gruppe og køb som eneste anvendelse. To komponenter kræves: +0,25 og -0,25 af netAmount, på forskellige konti. Indgående konto skal have rollen purchaseTax; modgående rolle skal være euTaxGoods eller euTaxServices. Kontiene skal være aktive, tilhøre organisationen og være uden bankfunktion. Rubrik A-referencen skal pege på den tilsvarende prædefinerede vare-/ydelsesrubrik i organisationen.

Native posteringer kontrolleres mod uændret købsbeløb og to momsben på 25 % af beløbet, afrundet til hele øre. Ved tilbageførsel vendes siderne på de oprindelige bruttolinjer med bevarede momskoder, så Billy også tilbagefører moms og rapporteringsgrundlag. Readback kontrollerer konti, sider, momskoder og momsperiodereferencer. Begge EU-momsben skal have samme periodereference. Netto- og bankposten må ikke have momsperiodereference. Originale bilag bevares og genbruges via nye links.

MCP's beløbsberegning bruges kun til kontrol af et skriveforløb. Billy bogfører og leverer rapportværdierne. Valg af momsbehandling og vurdering af fradragsret sker i chatten. Rapporter læses uden at blive erstattet af en MCP-beregning.

## Live-test og rapportkontrol

| Syntetisk case | Køb/betaling | Indgående moms | Modsatrettet EU-moms |
| --- | ---: | ---: | ---: |
| EU-varer | 240,00 DKK | 60,00 DKK | 60,00 DKK |
| EU-ydelser | 999,95 DKK | 249,99 DKK | 249,99 DKK |

Begge cases fik et syntetisk bilag og blev bogført. Billys native momsopgørelse blev læst før bogføring, efter begge køb og efter tilbageførsel. Udgangspunktet var nul i alle felter. Efter købene returnerede Billy følgende hele-kroner-værdier:

| Rapportfelt | Native værdi |
| --- | ---: |
| Købsmoms (indgående moms) | 310 |
| Moms af varer købt i udlandet | 60 |
| Moms af ydelser købt i udlandet | 250 |
| Rubrik A – varer | 240 |
| Rubrik A – ydelser | 1.000 |
| Samlet moms til betaling | 0 |

Finansposteringerne beholdt ørebeløbene; rapportværdierne er Billys egne afrundede værdier. Efter fuld tilbageførsel var samtlige rapportfelter igen nul. Ingen momsangivelse blev godkendt eller indsendt.

For begge køb blev en eksisterende syntetisk banklinjes oprindelige match midlertidigt fjernet. EU-posten blev tilknyttet, godkendt, genåbnet og fjernet igen. Kun bankposten blev matchet. Oprindelig posting-reference og godkendelse blev genskabt. En frisk afsluttende læsning bekræftede uændret banklinje og original postering. Ingen reelle bankkonti indgik.

EU-posteringerne var uændrede gennem bankforløbet og blev derefter tilbageført. Hvert original/tilbageførselspar summerer til nul pr. konto, momskode og momsperiode. Testspor og bilagslinks er bevaret. Replay af fjernelsen ændrede ikke det genskabte match.

## Afgrænsning

Ingen valutaomregning, udenlandsk fakturamoms, delvist fradrag, EU-salg, dansk omvendt betalingspligt eller køb uden for EU. Erstatningsrettelser med moms og grupper af momsposter i bankafstemning er ikke omfattet. Momskladder skal bogføres før bankafstemning. Bankmatch skal fjernes særskilt før tilbageførsel. Lukkede/indsendte momsperioder og tilbageførsel på tværs af perioder er ikke valideret.

Rubrik A-opsætningen valideres i værktøjet; rapporteffekten er dokumenteret ved live-test. Hvert bogføringskald henter ikke en komplet momsrapport og kan derfor ikke garantere rapportens samlede indhold eller samtidige UI-ændringer. Pending/replay-beskyttelsen er uændret. Banktests kontrollerer requestbudgettet for ét-sides testdata; større datamængder kan stadig ramme Workers grænse.

## Regressionstests

Begge EU-koder, to momsben og modsatte sider ved tilbageførsel, øreafrunding inklusive halv øre, forkerte momskontoroller, forkert Rubrik A/organisation, inaktive koder, manglende/ændrede komponenter, delvist fradrag, manglende momsben, forskellige momsperioder samt EU-bankforløb og requestbudget. De tidligere danske momstests består fortsat.

Grundlag: native momskoder, komponenter, konti, Rubrik A-definitioner og posteringer samt [Billys vejledning om udenlandske køb i momsopgørelsen](https://www.billy.dk/support/article/k%C3%B8b-i-udlandet-paa-momsopg%C3%B8relsen/).
