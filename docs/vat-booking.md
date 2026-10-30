# Momsbogføring og fuld tilbageførsel i testregnskabet

Implementeret og live-testet 2026-10-30. 222 automatiske tests består. Samme værktøjer og inputskemaer; ingen nye værktøjer.

## Kontrakt

- `book_test_daybook_draft`: testoprettede DKK-kladder med ingen moms eller standard dansk 25 % købsmoms/salgsmoms. Frisk revision og forventet beskrivelse kræves. Aktive momskoder og fuldt fradrag valideres før skrivning.
- Billy modtager de oprindelige bruttolinjer og godkendelsesstatus. MCP indsender ikke beregnede finans- eller momsposter.
- Readback kontrollerer kladdens linjer inklusive momskoder, bilagslinks, dato og beskrivelse. Native posteringer kontrolleres mod forventet net/momsfordeling i hele øre: moms = afrundet bruttoøre / 5; netto = brutto minus moms, pr. linje.
- Kontrollen sammenholder beløb pr. konto, debet/kredit, momskode og tilstedeværelse af momsperiodereference. Den kontrollerer valuta, eventuel baseAmount/exchangeRate, ejerskab og dato. Den er en skrivekontrol, ikke en regnskabsanalyse eller rapportberegning. Native posteringer returneres uændrede.
- `propose_test_reversal`: opretter en separat tilbageførselskladde fra originale bruttolinjer med modsatte sider og bevarede momskoder. Den bogføres særskilt efter kontrol. Originalen ændres eller slettes ikke, og bilagsfiler genbruges via nye links.
- `get_transaction`: momsposter kan få `correctionMode: reversal_only`, `correctionEligible: false` (erstatningsrettelser) og `reversalEligible: true`. En allerede eksisterende tilbageførsel afvises ved forslagsoprettelse; eligibility er ikke garanti for, at intet forslag findes.
- Journalens pending-lås ved timeout/readback-fejl er uændret. Ingen automatisk gentagelse med ny operationId. Bogføring er ikke en atomisk transaktion med efterkontrollen.

## Live-resultat

| Syntetisk case | Billys oprindelige posteringer | Fuld tilbageførsel |
| --- | --- | --- |
| Køb inkl. moms 125,01 DKK | Udgift debet 100,01; købsmoms debet 25,00; offlinebank kredit 125,01 | Samme beløb, modsatte sider |
| Salg inkl. moms 125,03 DKK + linje uden momskode 10,00 | Omsætning kredit 100,02 med S-kode; salgsmoms kredit 25,01; omsætning kredit 10,00 uden momskode; offlinebank debet 135,03 | Samme beløb, modsatte sider |

De fire bogførte transaktioner er bevaret som testspor. Hvert original/tilbageførselspar summerer til nul pr. konto, momskode og konkret momsperiode. Begge par bevarede de syntetiske bilagsfiler; originalernes bilag blev ikke flyttet. Replay af bogføring og tilbageførselsbogføring gav ingen nye posteringer. Et ekstra tilbageførselsforsøg blev afvist.

Salgstesten kørte med den endelige kontrol af momskode og momsperiodereference. Købets originale posteringer blev også efterkontrolleret med denne version. Ingen reelle bankkonti blev brugt. Ingen momsangivelse blev godkendt eller indsendt.

## Afgrænsning

Kun standard dansk 25 %, fuldt fradrag og DKK. Nettobeløbsinput, EU-moms, omvendt betalingspligt og delvist fradrag understøttes ikke. Bankafstemning af én bogført momspost er nu implementeret; se [match, godkendelse og genåbning](vat-bank-matching.md). Momskladder før bogføring og grupper af original/korrektion med moms er ikke understøttet af bankværktøjerne. Erstatningsrettelser og korrektion af korrektionsposter med moms er heller ikke understøttet.

Samme-dato-tilbageførsel er live-testet. Tilbageførsel i en anden momsperiode, lukkede perioder og ændring af indsendte momsangivelser er ikke valideret i denne pakke. Periodereferencens tilstedeværelse kontrolleres; værktøjet hævder ikke at have valideret en komplet momsangivelse. Samtidige UI-/opsætningsændringer kan stadig medføre readback-fejl.

## Regressionstest

Dækker momsafrunding begge veje og begge sider, blandede linjer, forkerte konti/beløb/koder/periodereferencer, fremmed valuta, tabt momskode, timeout/pending/replay, bevaret bruttomoms ved tilbageførsel og afvisning af momsbankafstemning/erstatningsrettelser. De tidligere tests for kladder, bilag, korrektioner og bankafstemning uden moms består fortsat.

Grundlag: [Billys kassekladdevejledning](https://www.billy.dk/support/article/billy-kassekladde/) og native API-readback i testregnskabet.
