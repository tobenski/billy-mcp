# Ikke-EU-køb, dansk omvendt betalingspligt og separat importmoms

Implementeret og live-testet 2026-10-30. 226 automatiske tests består. Ingen nye værktøjer eller inputfelter.

## Tre koder med forskellig virkning

| Billy-kode | Valideret konfiguration | Bogføring |
| --- | --- | --- |
| p_dk_non_eu_services_full (KYU) | world, rate 0; netAmount +0,25 på purchaseTax og -0,25 på euTaxServices | Uændret ydelsesbeløb og to momsben |
| p_dk_reverse_full (KOB) | local, rate 0; netAmount +0,25 på purchaseTax og -0,25 på salesTax | Uændret købsbeløb og to momsben |
| p_dk_non_eu_goods_full (KVU) | world, rate 0; ingen komponenter | Uændret varefaktura, ingen automatisk importmoms |

Alle tre koder skal være aktive, prædefinerede, tilhøre organisationen og kun gælde køb. Ingen må have netAmountMetaFieldId/Rubrik A-reference. Komponentkonti skal være aktive, i organisationen, i DKK og uden bankfunktion med præcis de forventede roller. Delvist fradrag og ændrede/ekstra momsben afvises.

Beløb angives i DKK med amountBasis: gross og nul leverandørmoms. Gross er leverandørens fakturabeløb; værktøjet tilføjer ikke moms til bankbeløbet. Vurdering af om købet faktisk er omfattet af den valgte behandling og fuldt fradrag ligger i chatten.

Kladder og bilag, særskilt bogføring, fuld tilbageførselskladde og separat bogføring af denne bruger de eksisterende værktøjer. De to reverse-charge-koder deler samme verifikation af modsatte momsben, øreafrunding og fælles momsperiodereference som EU-køb. KVU skal give nul momsben, og readback afviser ekstra beregnet importmoms.

## Importspecifikationen er en separat postering

Varefakturaen og importmomsen må ikke sammenblandes. Det konkrete momsbeløb fra importspecifikationen angives eksplicit i chatten. Det beregnes ikke som 25 % af varefakturaen.

Med fuldt fradrag bruges en separat kladde med debet på kontoen med systemRole purchaseTax og kredit på euTaxGoods, begge uden momskode. I testkontoplanen er det 7220 og 7230. Konto-ID'er skal findes i det aktuelle regnskab, ikke kopieres fra dokumentationen. Dato og bilag skal følge den konkrete importspecifikation. Denne post er ikke en bankbetaling og bankafstemmes derfor ikke mod leverandørens betaling.

Dette er et dokumenteret forløb med de eksisterende kladdeværktøjer, ikke en ny importassistent. MCP genkender ikke selv en importspecifikation og håndhæver ikke et særskilt importskema. Beløb, konti og bilag skal vælges eksplicit. Værktøjets almindelige ejerskabs-, balance-, revisions- og readback-kontroller gælder.

## Live-test

| Case | Faktura/angivet beløb | Native momsvirkning |
| --- | ---: | --- |
| Varefaktura uden for EU | 125,03 DKK | Ingen momsben; momsopgørelsen uændret |
| Ydelse uden for EU | 240,00 DKK | Købsmoms debet 60,00; moms af udenlandske ydelser kredit 60,00 |
| Dansk omvendt betalingspligt | 999,95 DKK | Købsmoms debet 249,99; dansk salgsmoms kredit 249,99 |
| Separat syntetisk importspecifikation | 37,13 DKK moms | Købsmoms debet 37,13; moms af udenlandske varer kredit 37,13 |

Testbeløbet 37,13 blev valgt særskilt og udgør ikke 25 % af varefakturaen. Alle cases brugte syntetiske data og eksisterende syntetiske bilagsfiler som tekniske fixtures; filerne er ikke faktiske udenlandske fakturaer eller importspecifikationer.

Momsrapporten blev læst før, efter varefakturaen, før/efter importposten og efter alle tilbageførsler. Efter varefakturaen var alle felter fortsat nul. Efter de to reverse-charge-køb returnerede Billy købsmoms 310, salgsmoms 250 og moms af udenlandske ydelser 60. Efter den separate importmoms returnerede Billy købsmoms 347 og moms af udenlandske varer 37; de øvrige beløb var uændrede. Det er Billys afrundede hele-kroner-værdier. Finansposteringerne bevarede ørebeløbene.

Rubrik A, B og C forblev nul, og totalAmount var nul. Efter særskilt tilbageførsel af alle fire cases var alle rapportfelter igen nul. Ingen momsangivelse blev godkendt eller indsendt.

Ydelseskøbet og det danske reverse-charge-køb blev begge live-testet med match, godkendelse, genåbning og fjernelse på eksisterende syntetiske offlinebanklinjer. Kun bankposteringen blev matchet. Oprindelige posting-referencer og godkendelser blev genskabt; afsluttende læsning bekræftede uændrede banklinjer og originale posteringer. Nye momsposteringer var uændrede gennem bankforløbet. Replay af fjernelse ændrede ikke det genskabte match.

Alle fire nye køb/importposter og deres tilbageførsler summerer til nul pr. konto, momskode og momsperiode. Bilag og bogførte testspor bevares. KVU-fakturaen blev ikke særskilt live-bankafstemt i denne pakke. Importmomsposten har ingen banklinje.

## Afgrænsning

Fuld fradragsret og DKK. Ingen valutaomregning, udenlandsk fakturamoms, delvist fradrag, EU-salg, told-/transportfordeling eller beregning af importgrundlag. Ingen særskilt automatiseret aflæsning af importspecifikationer. Lukkede/indsendte momsperioder og tilbageførsel på tværs af perioder er ikke valideret. Erstatningsrettelser med momskoder og grupper af momsposter i bankafstemning er fortsat afgrænset fra.

Rapporteffekten er live-testet, men hvert bogføringskald henter ikke en komplet momsrapport. Generelle direkte kontoposteringer uden momskode (herunder importmomskladden) kontrolleres som almindelige finanslinjer; de får ikke en særskilt automatisk kontrol af importmomskontoroller eller rapportfelter. Kontroller derfor den native momsopgørelse som del af det konkrete forløb.

Grundlag: Billys native momskoder, konti og komponenter samt [Billys vejledning om importspecifikation](https://www.billy.dk/support/article/importspecifikation/).
