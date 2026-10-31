> Update, 2026-10-31: the two native upload-link/OSS-report placeholders have now been removed. See [the renewed endpoint review](removed-native-placeholders.md). Reserved-contract and discovery counts below are historical.

> This filename is historical, not a final completion claim. See [current implementation and remaining work](partial-payments-multiline.md).

# Autonomous continuation and remaining contract boundaries — 2026-10-31

The user does not need to approve each development batch or refresh discovery for these changes. Existing names and input schemas are retained; discovery remains114 tools. The isolated test Worker is the only deployment changed.

## Additional functions completed

### Historical reference rates

get_test_historical_exchange_rate now reads official Danmarks Nationalbank data from Statistics Denmark's DNVALD table. This deliberately resolves the useful capability through a named official external source; it does not pretend that a historical Billy endpoint was discovered. The source value is preserved as DKK per100 source units, with requested date, actual observation date, publisher, table, query and original JSON-STAT response. No division, averaging, rate selection or accounting write occurs in MCP.

Supported currencies are EUR/USD/GBP/SEK/NOK. The table's DKK member is an effective-exchange-rate index and is explicitly rejected as a same-currency exchange rate. Currency/type/date dimensions and publisher are verified. Missing publication dates or null observations remain missing; no previous-day or current-rate fallback is applied. The data are indicative reference observations, not proof of actual cash conversion or a booked rate.

Live acceptance: EUR,GBP,SEK,NOK on2026-10-29; USD on2025-01-02; missing Saturday2026-10-31. All returned the requested source observations or explicit absence. The first deployed probe found that Cloudflare Workers does not support fetch redirect:error; this was corrected to redirect:manual with every non-success status refused. No credentials or organization data go to the public provider. Request timeouts, bounded response bodies and exact fixed endpoints apply.

### OSS configuration evidence

get_test_oss_configuration now reads the original account chart, VAT codes, sales-tax rulesets/rules, sales-rate account components and referenced country groups. Ownership, IDs, references and request/response bounds are verified. The tool does not assign OSS meaning to account names, calculate a report or determine legal VAT treatment. enabled and countryAccountMapping are explicitly null, with ossClassification=not_inferred. This preserves the user's requirement that analysis remains in chat.

Live acceptance returned98 accounts,15 tax codes,3 rulesets,6 rules,1 sales-tax account component and1 country group. These are source-configuration records, not a claim that OSS is configured.

### Error diagnosis and operation inspection

journalRun previously persisted a classified failure only when its result column was empty. Booking/payment tools preserve pre-write evidence in that column, so a later upstream failure could lose its diagnosis. The fix merges classified metadata while preserving the entire original evidence. A database compare-and-swap checks pending state and the exact previous result, preventing overwriting a concurrent update. Native bodies, credentials and free-text upstream details are not persisted by this diagnostic path. The pending lock remains in place.

get_test_write_operation now provides fresh read-only evidence for document booking, document payment/void, FX checks, VAT payment/void/settlement, daybook booking and split-bank operations. For document operations it returns original source records, allocations, related payment headers, transactions and postings, with ownership checks and bounded fan-out. A fresh observation never proves causation, completes a journal or authorizes retry. There is no writable client or database mutation in the evidence reader. Live checks covered the EUR supplier payment and a VAT refund operation.

## Verification of that checkpoint

355 automated tests pass. TypeScript checking, Worker bundle build and git whitespace checks pass. Regression tests cover preserved evidence, concurrent updates, ownership, malformed references, exact historical dates, missing observations, units, no credential forwarding, redirects and response limits. This continuation made no native Billy accounting writes. Earlier test accounting cleanup therefore remains intact; no new financial fixture needs reversal.

## Two retained reserved contracts

| Contract | Why it remains a stub | Usable existing route |
|---|---|---|
| create_test_upload_link | No verified native signed voucher-upload URL contract was found. Public KYC upload routes are unrelated. Creating a new upload relay would be a different product contract. | upload_test_file uploads and verifies actual file bytes; attachments can then be linked/reused. |
| get_test_oss_report | No verified dedicated native OSS return endpoint was found. A generic balance sheet or reconstructed calculation is not labelled an original OSS report. | Original OSS configuration evidence and native ledger/report readers provide the source data for analysis in chat. |

These stubs still return an error without network calls, journal reservations or writes. Their structured blocker states explicitly set requiresUserAction=false and identify the available alternative. Their retained names are the already requested placeholders; they are not a request for another user approval or discovery refresh. No support message was sent.

The remaining restrictions of implemented workflows are recorded in currency-split-eu-completion.md: for example full document payments, ordinary single-line document booking, complete bank-posting splits, no standalone manual FX draft and no foreign-bank transfers. This is not a claim of support for every Billy business scenario or semantic parity with Numina. The audit did not identify another missing Numina tool name requiring a new stub.

## Sources checked

- https://www.nationalbanken.dk/da/vores-arbejde/stabile-priser-pengepolitik-og-dansk-oekonomi/valutakurser
- https://www.dst.dk/da/Statistik/hjaelp-til-statistikbanken/api
- https://api.statbank.dk/v1/tableinfo/DNVALD?format=JSON&lang=da
- https://www.billy.dk/api/
- https://www.billy.dk/support/article/brug-af-moms-one-stop-shop-i-billy/
- Public script assets linked by https://mit.billy.dk/ (legacy app/core, React components, shared assets and vendors).

The public-client and documentation review supplied no verified historical Billy-rate or dedicated OSS-report contract. Historical reference rates instead use the explicitly identified official source above. Lack of a verified endpoint is not a claim that the vendor can never offer one.
