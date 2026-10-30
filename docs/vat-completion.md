# VAT implementation status

## Custom deduction codes: removed from scope

The user chose to drop own deduction codes. `create_test_partial_vat_rate` remains as a compatibility stub but always refuses before reads or writes. Its creation implementation is removed. Existing standard-code and explicit split-line workflows are unchanged.

The historical attempt is marked `disposition: abandoned`, retaining its original fingerprint and the observation that a complete native listing contains 15 predefined codes and no matching custom code. Its original error was not retained. This is not represented as a successful creation or proof that no write ever occurred. The underlying pending lock is intentionally retained to prevent retries. `get_test_write_operation` displays `state: abandoned`, `storageState: pending`, and `retryBlocked: true`.

## Failure diagnostics

Uncertain failures inside the test write journal now retain a classified diagnostic: Billy HTTP status, method and resource family when recognized, or network/internal classification. No raw error text, upstream body, credentials, record IDs or customer data are stored in this diagnostic. It never releases the pending lock or authorizes a retry. Existing partial-operation evidence is not overwritten. If diagnostic persistence fails, the original pending lock remains.

This applies to future failures that reach the journal's uncertain-outcome handler. It does not reconstruct historical errors or change the handling of preflight refusals that performed no write. Raw Billy business-error messages are deliberately not retained.

## Live validation

Both historical pending bookings were verified against their original revisions and native postings, and completed without native writes.

Synthetic transactions 77 and 78 created and reversed a Q3 purchase (100 expense, 25 VAT, 125 offline bank), leaving each affected account and the Q3 report net zero. The zero period was settled and reopened. Final state matches the original period revision, `isSettled=false`, `settledAmount=null`, with no payments. Current-quarter settlement was refused.

Billy sets `settledAmount` as well as the flag. The validator checks it separately. An exact-revision recovery path handles only the proven existing zero-period settlement without another native write. Nonzero settlements, settled-period corrections and authority submission are not validated by this test.

## Currency and OSS

- Supported write flows are DKK only. Foreign-currency lines and conversions are rejected; native currency data can be read, but this does not implement foreign-currency booking, payment exchange differences or VAT conversion.
- OSS has no implemented write/reporting workflow or validated tax-code mapping. Existing EU-sale Rubrik B tests do not establish OSS support.
- Unsupported tax codes are rejected by an explicit standard-code validator. Do not route OSS transactions through an ordinary EU code as a substitute.
- Next currency work requires native invoice/entry conversion evidence, rounding, payment differences, bank matching and reversals. OSS requires a separate capability investigation and test specification.

## Remaining VAT work

Cross-period corrections, settled periods and fiscal locks; nonzero settlement and payment reconciliation; separate EU-sales invoice/customer/VAT-number and listing workflow; currency and OSS. Actual authority submission is a separate explicitly authorized action, not a consequence of setting Billy's recorded settlement flag.
