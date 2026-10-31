# Partial payments and multiline documents — 2026-10-31

This is a development checkpoint, not a declaration that the whole roadmap is finished. No discovery refresh is needed: existing tool names and schemas cover these changes. Only the isolated test Worker was deployed.

## Delivered

Document payment tools now accept partial or full payments, with at most four active journal-proven payments per document. Existing allocations, payment headers, transactions and ledger amounts are checked before another payment. Unknown allocations and credits are refused. Reversals must proceed newest first. Final foreign payments consume the remaining original booked DKK control amount, preserving the last rounding cent. Native FX gains/losses are verified rather than duplicated. Lost-response recovery proves the existing native write and never repeats it.

Supplier booking and full credits now support up to20 ordinary25% purchase-VAT lines in DKK, including different expense accounts. Foreign supplier booking remains single-line until conversion aggregation is verified. Invoice booking/full credits support up to5 ordinary25% sales-VAT lines and3 products on one revenue account. Partial credit notes, discounts and mixed VAT codes remain outside these handlers. Full-credit verification compares complete line multisets, preserving duplicate counts even if native ordering differs.

Billy's native rounding differs between document types: two gross125.08 DKK lines yield supplier net200.12/VAT50.04 but invoice net200.13/VAT50.03. Separate checks and regression tests preserve this distinction.

## Live evidence

- b2400001: EUR invoice7gVFUyx1RO9qnXMjVfiZFA,125.08 EUR at7.5. Payment40 EUR/301 DKK then85.08 EUR/637.10 DKK. Native receivable300+638.10 DKK and opposite1 DKK FX differences verified. Balance125.08→85.08→0; newest-first reversals restored125.08. Full creditIBQ7CEFVT6ucrmdPIZwjrg booked; both document balances0.
- b2400002: two-line DKK bill6XvNkOZLRbaIdHTY5QZwzw,250.16 total,50.04 VAT. Payments100 and150.16, both reversed. Full two-line creditzUv8xKq8QNeYDVhDqSMnsQ booked with exact opposite account postings; both balances0.
- b2400003: two-line DKK invoice5Wm3HY8EQCqXIuSczaElXw,250.16 total,50.03 VAT. Full credit0mpC0kPbSLeUmIOTCWRW8w booked; both balances0.

Q4 VAT total is0 and its complete revision is restored to1121855f98c33a52c5dfe615ae2c0cf7ae7ba3a2785008d41106754d890b092f. Offline test account5710 was used; connected bank5711, production, messages and real bank transfers were untouched.

366 automated tests, TypeScript checking and the Worker build pass. Tests cover DKK/EUR partial invoice/bill sequences, newest-first reversal, lost-response recovery, complete multiline credits and rejection of the other document type's rounding.

## Still open

Fees, standalone manual FX drafts, foreign bank accounts, multiline foreign supplier conversion, invoice allocation across multiple revenue accounts, discounts, partial credits and broader document VAT codes remain restricted. A dedicated native OSS report and presigned voucher-upload contract remain unverified reserved tools. OSS configuration evidence does not establish OSS status. Positive EU-sales and custom-account-group fixtures remain acceptance gaps. These restrictions must not be presented as completed features or as a need for the user to approve another development batch.

## Publication status

The test Worker is deployed. Publication initially required explicit authorization for public test-environment details. The user has now authorized this and future publications within this development project. The source, tests and report are being synchronized to cloudflare/test-regnskab-api.
