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

Foreign partial credit notes, invoice discounts/mixed sales codes, document-payment fees, standalone manual FX drafts, foreign bank accounts and broader foreign purchase-VAT booking remain restricted. Dedicated native OSS-report and signed voucher-upload contracts remain reserved. These limitations are not completed functionality.

## Sequential DKK credits

Customer and supplier documents now support up to four sequential partial/full DKK credits. Remaining amounts are checked per product/VAT or expense/VAT group against all earlier verified credits and native allocations. Original and earlier credit ledgers are reverified; unapproved credits and unexplained payments block further credits. Over-crediting is rejected before native writes. Foreign credits remain full-only.

Invoice credit creation can recover an uncertain response by finding the exact operation-marked draft and verifying its header, lines, original source revision and attachment set. Recovery completes only the journal, with zero native writes.

Configuration reads are memoized within one invocation. Documents, lines, allocations, postings and period locks remain fresh. Financial snapshots of earlier posted credits avoid unrelated attachment reads while retaining ownership and stability checks. A four-credit native acceptance flow completed without interruption after this reduction. All synthetic source balances and VAT effects were restored.

381 automated tests, TypeScript checking and Worker build pass at this checkpoint.
