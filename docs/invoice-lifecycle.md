# Invoice lifecycle acceptance — 2026-10-31

This test-only batch implements existing contracts; discovery remains 111 tools. Product lifecycle, invoice drafts, single-line DKK booking and full linked credit notes were exercised against Billy. Production and real bank integration were not changed. No documents were sent and no payments were initiated.

## Delivered scope

- Product create/update/archive/restore, with journal provenance and preserved prices. Restore reproduced the original revision.
- Invoice draft create/update/delete: up to five lines, three products and three source attachments, uniform gross/net basis, explicit active test product/revenue account/native sales VAT code. Description maps to contactMessage; due date maps to net payment days. Contact/date/currency/rate cannot change after creation.
- DKK and EUR/USD/GBP/SEK/NOK draft currencies; foreign rates must be explicit. DKK domestic, EUR domestic and EUR German-company goods drafts were tested live. The last resolved native SVE, without claiming VIES verification or legal eligibility. Other foreign currencies have validation coverage, not independent invoice acceptance tests.
- Booking: one DKK line, ordinary Danish 25% sales VAT, unsent journal-proven invoice or full linked credit. Fiscal/VAT period checks and exact receivable/revenue/VAT ledger verification. No discounts, partial credits or payment allocations.
- Full linked credit creation copies the source's file links and checks all supplied line fields, totals and file identities. Source must remain unchanged, unpaid and without another credit. Original is rechecked before credit booking; both document balances must become zero.
- Pending booking recovery verifies saved pre-write content and native ledger, then completes only the journal. It never resubmits the native booking.

## Native details corrected during acceptance

Billy rotates invoice downloadUrl between reads. It is excluded from the revision hash; native accounting fields, line data and attachment metadata remain covered. A regression test distinguishes URL rotation from a real payment-term change.

Billy rejects paymentTermsMode on credit notes. Credit creation therefore omits both payment-term fields; the observed credit has null paymentTermsMode. Ordinary invoice due-date mapping remains explicit.

A native POST /invoices HTTP400 is treated as a no-effect rejection only after independent native queries show no exact invoice-number record, no linked credit and an unchanged original. Network errors and ambiguous effects retain the pending lock. Two earlier HTTP400 attempts were inspected explicitly and closed in the journal as rejected_without_creation; they were not successful creations. No blind retry or duplicate credit was performed.

## Live accounting acceptance

Operation group b2100005 created and booked a 125.08 DKK synthetic invoice, then created and booked a full credit. Native amounts were net100.06, VAT25.02 and gross125.08. The six native postings sum to zero independently on sales1110, accountsReceivable and salesVAT. Original and credit both have balance0 and isPaid=true (native credit offset, not a bank payment).

Q4 VAT return revision after the credit exactly matches the saved baseline:
`1121855f98c33a52c5dfe615ae2c0cf7ae7ba3a2785008d41106754d890b092f`.
All report fields, payment list and total are unchanged. The approved pair remains as an audit trail; other invoice drafts from groups b2100002–b2100004 were deleted and original source files preserved. The test product remains reusable.

One verification read received transient HTTP403; a repeated read succeeded. No write was retried because of that read failure.

## Validation and remaining work

301 automated tests, TypeScript checking and Worker build pass. Tests cover stale revisions, foreign rates, native rule priority and EU group membership, line replacement, attachments, rotating URLs, rejected writes, ambiguous bookings, journal-only recovery, incorrect ledger postings and intervening original payments.

Still reserved: supplier bill booking, recorded invoice/bill/VAT payments and payment reversal, payment FX adjustments, split bank allocation, historical exchange-rate lookup, native EU-sales report and OSS configuration/reporting. Invoice booking is deliberately narrower than invoice drafting; foreign/multi-line booking and partial credits need additional verified correction lifecycles. Partial credit-creation or attachment failures retain their lock for inspection; automated creation recovery is not implemented.
