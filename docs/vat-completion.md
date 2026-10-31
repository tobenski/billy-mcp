# VAT implementation status

## Custom deduction codes: removed from scope

The user chose to drop own deduction codes. `create_test_partial_vat_rate` remains as a compatibility stub but always refuses before reads or writes. Its creation implementation is removed. Existing standard-code and explicit split-line workflows are unchanged.

The historical attempt is marked `disposition: abandoned`, retaining its original fingerprint and the observation that a complete native listing contains 15 predefined codes and no matching custom code. Its original error was not retained. This is not represented as a successful creation or proof that no write ever occurred. The underlying pending lock is intentionally retained to prevent retries. `get_test_write_operation` displays `state: abandoned`, `storageState: pending`, and `retryBlocked: true`.

## Failure diagnostics

Uncertain failures inside the test write journal now retain a classified diagnostic: Billy HTTP status, method and resource family when recognized, or network/internal classification. No raw error text, upstream body, credentials, record IDs or customer data are stored in this diagnostic. It never releases the pending lock or authorizes a retry. Existing partial-operation evidence is not overwritten. If diagnostic persistence fails, the original pending lock remains.

This applies to future failures that reach the journal's uncertain-outcome handler. It does not reconstruct historical errors or change the handling of preflight refusals that performed no write. Raw Billy business-error messages are deliberately not retained.

## Current live validation — 2026-10-31

Standard-code VAT, explicit manual deduction splits, foreign source amounts and exact DKK-bank reconciliation are described in `currency-drafts.md`. Own deduction codes remain retired.

Ended unpaid periods were settled and reopened with native totals 0, +150 and -150 DKK. Nonzero settlement sets `isPayable=true` and `settledAmount=abs(totalAmount)`; reopening restores false/null. The validator handles those observed transitions and requires all other period/report/payment data to remain unchanged. Lost-response recovery reconstructs and hashes the exact pre-settlement evidence and re-reads the current evidence before completing the journal with zero native writes. Different/ambiguous evidence stays pending.

Billy generated settlement/reopening ledger entries (110/111 and 114/115). Reopening voided the native settlement entries; all test-created postings, including these native entries, must be included when auditing cleanup. Original purchase/sales tests were fully reversed. Q3 and Q4 native VAT-period revisions are restored, both unsettled and unpaid, with no payment records.

Open cross-period reversal was tested with +150 DKK in Q3 and -150 DKK in Q4; explicit cleanup restored both periods. A settled Q3 rejects new VAT booking before native writes. This applies to coded VAT and direct entries on native VAT-role accounts. Reopen explicitly after reviewing the period; the tool does not silently modify a filed period. Fiscal locking date is checked inclusively before booking, with local boundary tests; the organization's real lock was not changed for testing.

## Remaining separate capabilities

Actual authority submission is not implemented or performed. OSS configuration/reporting and customer-level EU-sales listing have reserved contracts, with no verified native reporting endpoint. Full DKK invoice/bill payments and settled VAT payments/refunds, including native void, are now live-verified on the fixed offline test account; see document-payments.md and vat-payment-lifecycle.md. Payment exchange differences and split bank allocations remain separate work. Stubs are not live implementations. Current rate metadata is not historical invoice-rate evidence.

Production and real bank integration accounts were not changed. Optimistic checks cannot lock out concurrent Billy UI edits; uncertain writes retain their journal lock.
