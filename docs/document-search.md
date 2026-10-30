# Bilagssøgning og bilagsoplysninger

Implementeret 2026-10-30 på den isolerede testserver. 127 automatiske tests består. Inputskemaerne er uændrede; samlet 82 værktøjer. Fire roadmap-funktioner er implementeret i fase 1, og 16 er fortsat reserverede.

## get_test_document

Tager attachmentId og valgfri includeFiles. Returnerer den originale attachment-record med alle Billy-felter, også null-værdier. Null betyder ukendt — ikke nul kroner eller ingen leverandør. includeFiles=true henter metadata og downloadadresse for den tilknyttede fil. Værktøjet downloader ikke filindhold og foretager ikke OCR. En filfejl fjerner ikke bilagsposten; svaret viser partial=true og en konkret fileErrors-post.

## search_test_documents

Returnerer én native side af bilagsposter med refererede filmetadata, deduplikeret inden for siden. Dokumentation: https://www.billy.dk/api/ — attachments/list filters.

| Input | Behandling |
|---|---|
| query | Billy q; mindst to tegn |
| vendor | Billy supplier |
| amount | Billy amount; ingen beregnet tolerance eller valutaomregning |
| fromDate / toDate | Billy documentDatePeriod: from, through eller dates |
| status | Billy handled/unhandled; kontrolleres i svaret |
| currencyId | Eksakt filter på den hentede sides currencyId |
| invoiceNumber | Afvises med UNSUPPORTED_FILTER; ikke verificeret understøttet |
| page / pageSize | Native sidenummer og sidestørrelse; standard 1/50 |

Søgningen bruger Billys gemte bilagsfelter, ikke en analyse af PDF-indhold eller kladdens bogføringsdato/beløb. Navnet på test-PDFen gav ikke et fritekstmatch i live-testen. Dato-, leverandør- og beløbsfiltre kan derfor udelukke bilag, hvor felterne endnu er null. Ingen manglende fakta udledes af filnavn eller posteringer.

Sortering er eksplicit createdTime DESC. Billys standardsortering gav gentagne poster på flere sider i første live-test. Efter rettelsen gav fire sider med to poster alle otte unikke ID’er uden gentagelser. Native sideinddeling er ikke et snapshot: samtidige ændringer og ens tidsstempler kan fortsat påvirke sidegrænser. Deduplikér ID'er ved længere gennemgange, og undgå samtidig ændring af bilagslisten.

Valutafiltrering sker kun på den aktuelle side. En tom side er derfor ikke nødvendigvis sidste side. Følg coverage.nextPage. meta.paging.total beskriver Billys resultater før valutafilteret, ikke et beregnet samlet antal valutamatches. Ukendt pagination returneres som hasMore=null; den kaldes ikke komplet. Bilagsposter er ikke en fuldstændig opgørelse over samtlige uploadede filer.

## Live-resultater

- Alle bilag: 8 poster, komplette filmetadata.
- Indbakke: 2 poster; tilknyttede: 6 poster.
- Hentning af en tilknyttet PDF: korrekt attachment, filnavn, fil-ID og filstørrelse; ingen bytes downloadet.
- Indbakkebilag uden includeFiles: ejer null og ingen filmetadata i svaret.
- EUR på første side med to DKK-poster: 0 returneret, men nextPage=2 og native total=8 bevaret.
- Dato, leverandør, beløb og filnavn som query: 0 matches på fixtures uden udfyldte kildefelter. Positive matches for udfyldte beløb/leverandører/datoer er ikke live-testet; parameterkortlægningen er dækket lokalt.
- invoiceNumber afvises eksplicit.
- Der er ikke ændret eller oprettet regnskabsdata i dette trin.

Regressionstests dækker organisation/ID, ugyldige stier, null-værdier, manglende filer, datoperioder, afviste filtre, statuskontrol, deduplikering af filmetadata, valutasider uden matches og ukendt pagination.
