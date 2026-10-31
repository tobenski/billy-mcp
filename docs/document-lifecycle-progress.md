# Supplier drafts, contacts and product dependency — 2026-10-31

## Delivered and live-tested

- `archive_test_contact`: archive/restore with fresh revision and narrow `isArchived` write. Existing foreign test contact restored to the exact original revision, preserving contact persons and all other fields.
- `create_test_bill_draft`, `update_test_bill_draft`, `delete_test_bill_draft`: native supplier draft lifecycle, with all lines/attachment links and a fresh revision from `get_bill`. Only journal-proven test bills and active test suppliers qualify. No booking or payment.
- DKK standard purchase VAT, EUR with explicit native exchangeRate, and a mixed eight-code purchase draft were created/read back/deleted. Original technical file links were reused and preserved. The update test replaced all lines, changed due date and reused the same attachment without duplication.

Foreign draft currency can be EUR/USD/GBP/SEK/NOK; an explicit positive native exchangeRate is required. EUR was live-tested; other currencies share local validation but have not had an independent supplier-bill live test. The code preserves the supplied rate and never chooses a current/historical rate. Currency, rate and contact are immutable for these draft tools; use a new draft if they need to change.

Bill lines currently require quantity 1, explicit gross amounts, no productId and at most 20 lines/eight accounts/eight tax codes. Unsupported mappings fail before writes. `description` is an operation-journal audit note, not a native bill header field; native line descriptions are separate. Existing supplier invoice numbers are not repurposed for notes. The native voucher number contains the immutable test-operation marker; the marker alone is insufficient without the matching completed creation journal.

Native bill tax fields must not be interpreted as final deductible ledger VAT. The mixed draft includes ordinary K and representation KR with full tax in the bill's tax field; deduction components are a separate posting concern. `book_test_bill_draft` stays reserved until posting verification and a complete correction/cleanup lifecycle are implemented. No approved bill was created during these tests.

## Three additional implemented product contracts, awaiting live acceptance

The previous twenty-contract audit missed the product dependency of sales invoices. Native invoice lines require a product; the test company currently has no products. The following tools are now implemented and unit-tested, but require discovery refresh before this chat can call them:

- `create_test_product`: TEST-prefixed name, explicit active DKK revenue account and organization-owned existing sales-tax ruleset. No inferred default prices.
- `update_test_product`: change only supplied name/description/account/ruleset after revision and journal provenance checks; preserve all prices and unrelated fields.
- `archive_test_product`: reversible archive/restore with the same ownership/revision checks, preserving prices.

`get_product` now supplies all native product prices and an optimistic revision in test-write mode. Test discovery contains 111 tools with writes enabled, 99 when disabled; production's original 51 read-only tools are unchanged. Product status explicitly says `implemented_live_test_pending`. The new product contracts are implementations awaiting live acceptance, not stubs claimed as complete.

## Invoice preparation and remaining work

The invoice schema was checked against native documentation. ProductId is required natively, line taxRate is read-only, invoice dueDate is derived from native payment terms, and entryDate/contact cannot simply be replaced on an existing invoice. An implementation must verify product revenue account and resolved tax code against the requested account/tax, convert the explicit due date into validated native payment terms, and preserve unsent state. It must not silently create products or send email/e-invoices.

After product live acceptance, implement and test invoice drafts with known products, then invoice/bill booking and corrections before payment allocations. The sixteen remaining contracts from the original twenty stay reserved; historical exchange-rate, EU-sales-list and OSS reporting endpoints remain unverified. There is no claim that all accounting functionality is complete.

## Validation and operation safety

287 automated tests, TypeScript checking and the Worker build pass. The automated suite covers contact archive/restore, full bill draft lifecycle/replay, foreign rates, stale revisions, forged provenance, approved-state refusal, wrong contact/account/attachment ownership, uncertain create outcomes and unrelated-field drift. Product tests cover duplicate names, account/ruleset validation, stale price revisions, preserved prices, archive/restore, uncertain writes and pending locks.

All successful live operations in this batch use prefix `b20000`; fourteen operations completed and no synthetic supplier bill remains. Existing attachment files and nonfinancial fixtures remain. No financial ledger posting, real bank operation, production write or message was performed.
