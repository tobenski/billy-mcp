# Supplier drafts, contacts and product dependency — 2026-10-31

## Delivered and live-tested

- `archive_test_contact`: archive/restore with fresh revision and narrow `isArchived` write. Existing foreign test contact restored to the exact original revision, preserving contact persons and all other fields.
- `create_test_bill_draft`, `update_test_bill_draft`, `delete_test_bill_draft`: native supplier draft lifecycle, with all lines/attachment links and a fresh revision from `get_bill`. Only journal-proven test bills and active test suppliers qualify. No booking or payment.
- DKK standard purchase VAT, EUR with explicit native exchangeRate, and a mixed eight-code purchase draft were created/read back/deleted. Original technical file links were reused and preserved. The update test replaced all lines, changed due date and reused the same attachment without duplication.

Foreign draft currency can be EUR/USD/GBP/SEK/NOK; an explicit positive native exchangeRate is required. EUR was live-tested; other currencies share local validation but have not had an independent supplier-bill live test. The code preserves the supplied rate and never chooses a current/historical rate. Currency, rate and contact are immutable for these draft tools; use a new draft if they need to change.

Bill lines currently require quantity 1, explicit gross amounts, no productId and at most 20 lines/eight accounts/eight tax codes. Unsupported mappings fail before writes. `description` is an operation-journal audit note, not a native bill header field; native line descriptions are separate. Existing supplier invoice numbers are not repurposed for notes. The native voucher number contains the immutable test-operation marker; the marker alone is insufficient without the matching completed creation journal.

Native bill tax fields must not be interpreted as final deductible ledger VAT. The mixed draft includes ordinary K and representation KR with full tax in the bill's tax field; deduction components are a separate posting concern. `book_test_bill_draft` stays reserved until posting verification and a complete correction/cleanup lifecycle are implemented. No approved bill was created during these tests.

## Product contracts — live acceptance completed

Product create/update/archive/restore has now been verified live. Names/descriptions changed as requested, existing prices were preserved, and restore returned the exact pre-archive revision. The synthetic product remains as a reusable fixture. All 111 tool names are available; this batch adds implementations behind existing contracts and requires no new names.

## Invoice lifecycle — latest batch

See [invoice-lifecycle.md](invoice-lifecycle.md) for the full acceptance record. Invoice draft create/update/delete, native product/rule verification, stable revisions, single-line DKK booking and full linked credit notes are implemented and live-tested. EUR domestic and EU sales were verified at draft level only. Booking foreign invoices, partial credits, payment allocation, supplier bill booking, historical exchange-rate lookup, EU-sales lists and OSS remain outside the delivered phase.

## Validation and operation safety

The preceding supplier/product package had 287 automated tests; the latest invoice package has 301 automated tests. TypeScript checking and Worker build also pass.  The automated suite covers contact archive/restore, full bill draft lifecycle/replay, foreign rates, stale revisions, forged provenance, approved-state refusal, wrong contact/account/attachment ownership, uncertain create outcomes and unrelated-field drift. Product tests cover duplicate names, account/ruleset validation, stale price revisions, preserved prices, archive/restore, uncertain writes and pending locks.

All successful live operations in the preceding supplier batch use prefix `b20000`; fourteen operations completed and no synthetic supplier bill remains. Existing attachment files and nonfinancial fixtures remain. That supplier batch performed no financial ledger posting, real bank operation, production write or message. The later invoice batch has a fully offset approved invoice/credit pair, documented separately.
