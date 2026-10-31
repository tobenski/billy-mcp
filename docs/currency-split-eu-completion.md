# Currency, bank split and native EU-sales continuation — 2026-10-31

Validation:341 automated tests pass, TypeScript checking passes, and the test Worker bundle builds. All64 operation journals in groups b2300001–b2300009 are closed, including explicitly classified unsuccessful attempts; none remains pending.

This checkpoint supersedes older statements that document payments, bank splits or foreign document booking are reserved. Tool discovery remains114 names. Production and the connected bank5711 were not changed. Synthetic payments use only the fixed offline account5710.

## Implemented and verified

| Function | Delivered scope | Evidence |
|---|---|---|
| Invoice and bill booking/full credit | One ordinary25% VAT line; DKK/EUR/USD/GBP/SEK/NOK source with explicit preserved DKK-per-unit rate; native DKK ledger | DKK and EUR live lifecycles; source and ledger assertions |
| Document payment/void | Full source amount, explicit DKK cash amount; native FX gain/loss; original booked control evidence | EUR125.08 at7.5 books938.10DKK;940.00 cash gives1.90 gain for invoice and1.90 loss for bill; all reversed |
| FX adjustment contract | Duplicate-prevention guard returns draftCreated=false after proving native FX already posted or fully voided | Live active bill payment and voided invoice payment; no extra posting or draft |
| Bank split | Two or three complete journal-proven DKK bank postings, explicit side/amount, exact total; existing approve/group-unlink |75.00 bank line matched to25.00 VAT-bearing plus50.00 VAT-free postings; approved, unlinked, fixtures reversed |
| EU-sales list | Original salesWithoutVat response, explicit dates, no MCP aggregation | Native empty October and January–September reports; wrapper live-tested; nonempty response preservation tested locally |

Currencies other than DKK/EUR share validation and conversion paths but have not each had a separate native invoice/bill payment acceptance run. Partial/fee payments, discounted/multiline document booking, partial credits, foreign bank accounts and standalone manual FX drafts remain unsupported. The FX contract does not promise to create a draft: Billy already books FX for supported payments, so another adjustment would duplicate it.

## Native findings and corrections

Invoice approval must explicitly include the selected exchangeRate. The first foreign test approved with only state; Billy replaced the draft rate with7.4735. The verifier caught the mismatch and kept the journal pending. Native postings and unchanged source fields were inspected, the operation was closed with an explicit rate-mismatch outcome, and a full credit at the actual posted rate neutralized it. A fresh invoice at7.5 then preserved the selected rate exactly. Supplier approval also explicitly preserves the rate.

For these native invoice/bill bookings, exchangeRate means DKK per source unit. Source header net and VAT are independently rounded after conversion; their sum is the DKK control amount. A historical comment in the public API documentation describes the reciprocal for invoices; the implementation follows verified native ledger evidence. Test rates are synthetic, not claimed historical market rates.

Bank-payment cashExchangeRate accepts a maximum of six decimals. The implementation rounds to six and refuses before writing if that precision cannot preserve the exact source cents. Full payments verify source allocation, original booked DKK control, explicit cash amount, native FX account and all ledger sides. The automatic FX amount is never separately booked.

Three initial EUR-payment attempts made no native payment. The first two lacked retained upstream error details and were closed only after repeated unchanged invoice/payment/allocation readback, explicitly labelled no_native_effect_observed. The third exposed native422 cashExchangeRate precision validation and was closed as native_validation_rejected. These are not successful payment tests. The corrected request succeeded. Definite400/422 rejections now release the reservation only after unchanged source, unchanged complete payment collection and no active allocation are verified. Other failures retain evidence, classified diagnostics and their lock; recovery never repeats a native write.

## Cleanup evidence

Operation group b2300006 covers split link/approve/unlink and both source reversals. The75DKK bank-line revision returned exactly to its initial value. Groups b2300007–b2300009 cover the foreign rate discovery, EUR invoice payment/gain/void/full credit, and EUR supplier payment/loss/void/full credit. Every successful original/credit ledger pair nets to zero per account in integer cents. Payment original/reversal pairs are exact opposites and all postings are explicitly voided. Native Q4 VAT revision returned to1121855f98c33a52c5dfe615ae2c0cf7ae7ba3a2785008d41106754d890b092f.

Earlier groups b2300001–b2300005 completed supplier acceptance, DKK document payment/void and positive/negative VAT payment/void/reopen. Q3 retains two voided native VAT-payment audit records; its report and settlement/payment fields returned to baseline, but its full revision consequently differs. Source attachment files and booked audit trails are retained.

## EU-sales endpoint and remaining native dependencies

The public Billy web-client asset react-web-components.e95a214b4c4bda0d4baa.js identifies GET /v2/organizations/{organizationId}/salesWithoutVat with fromDate/toDate. The dedicated tool preserves the response and all native fields. Only page1/omitted is supported because native pagination is unverified. Date ranges are limited to366 inclusive days and malformed/missing results are errors, never fabricated empty success. Fixed-organization access checks allow this exact new path only. Billy's list is invoice/contact/product dependent; an empty list is not proof that no reportable EU sales exist, and daybook Rubrik B totals are not an equivalent customer/VAT-number list. CSV export and authority submission are outside this tool.

Four contracts remain explicitly reserved:

- create_test_upload_link: normal byte upload is implemented; a presigned voucher-upload endpoint is unverified. A public KYC upload endpoint is unrelated and is not reused.
- get_test_historical_exchange_rate: native currency metadata has no verified historical date contract; current rates are never relabelled historical.
- get_test_oss_configuration: no verified native OSS flag/country mapping. Arbitrary user-created accounts/rules cannot safely be inferred to mean OSS configuration.
- get_test_oss_report: no verified original OSS report endpoint; no reconstructed report is substituted.

Sources inspected: https://www.billy.dk/api/ ; https://www.billy.dk/support/article/eu-salg-uden-moms/ ; https://www.billy.dk/support/article/brug-af-moms-one-stop-shop-i-billy/ ; public scripts linked by https://mit.billy.dk/ . The OSS guide describes country-specific account/rule setup and manual reporting steps, not a documented dedicated report API. No support message was sent and no refresh is needed for the existing contracts. The27 Numina capability mappings remain covered by names, without claiming semantic parity. No additional contract was necessary in this audit.
