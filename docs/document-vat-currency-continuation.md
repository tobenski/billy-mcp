# Document VAT and currency continuation

This public note describes software behavior and automated validation. It contains no organization, account, document, transaction or VAT-period identifiers.

## Changes

- Foreign supplier bills support multiple lines and expense accounts with ordinary purchase VAT. The verifier groups source amounts by account before conversion and checks the exact VAT remainder against the converted control amount.
- Sales invoices and full credits support multiple revenue accounts and a uniform supported sales VAT code. Source-document totals and native ledger grouping are checked separately. Product-to-account relationships are preserved and verified on credit creation.
- Zero-rate sales codes can be booked and fully credited. EU-sales reporting continues to return the original native response without generating an MCP calculation or submitting anything to an authority.
- DKK supplier bills support mixed standard purchase VAT codes, including representation, reverse charge and no deduction. Every line requires an explicit native VAT code.
- A dedicated supplier VAT verifier checks exact grouped postings. A mathematically determined rounding residual may be assigned to one input-VAT component; there is no general amount tolerance. Expense, output VAT, control, code, period and ownership checks remain strict. The result identifies any applied rounding correction.
- A definite native validation rejection can close a pending supplier-booking journal as abandoned only after proving an unchanged draft and absence of a source transaction. Ambiguous outcomes remain locked. Recovery of already-approved documents verifies the existing transaction without repeating the native write.

## Validation

376 automated tests pass. TypeScript checking and Worker build pass. Tests cover rounding boundaries, full-credit reversal, changed evidence, malicious posting alterations, mixed VAT groups and recovery without repeated native writes.

The isolated test deployment was updated. The production deployment was not changed. Native acceptance and cleanup were also performed; detailed internal evidence is not included in this public note.

## Remaining scope

Partial credit notes, invoice discounts/mixed sales codes, document-payment fees, standalone manual FX drafts, foreign bank accounts and broader foreign purchase-VAT booking remain restricted. Dedicated native OSS-report and signed voucher-upload contracts remain reserved. These limitations are not completed functionality.
