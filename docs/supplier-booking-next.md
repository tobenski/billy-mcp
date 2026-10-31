> Live acceptance completed: see [document payments and supplier acceptance](document-payments.md). The remaining text records the preceding deployment checkpoint.

# Supplier correction lifecycle and missing payment contracts — 2026-10-31

## Current state

Supplier bill booking and full linked supplier-credit creation are implemented and tested locally. They are explicitly marked implemented_live_test_pending. Native ledger acceptance has NOT been performed; passing simulated API tests does not establish Billy's credit mapping or posting semantics.

A fresh native DKK supplier draft was created and read back: gross125.08, net100.06, purchaseVAT25.02, quantity1, paymentAccountId/paymentDate null and accountingBasis accrual. The expense account's native nature is expense. This draft was deleted without posting. No financial effect remains from this preparatory check.

The implementation accepts one DKK gross line with ordinary Danish purchase VAT, an active test supplier, an active expense account and the native payable account. It checks completed creation provenance, current revision, fiscal/VAT locks, exact native totals and ledger amounts. It rejects cash payments, cash accounting, foreign currency, changed originals, partial credits and existing allocations. Credit notes are copied from the full original with preserved source-file links. Source and credit balances must both become zero after credit booking.

Uncertain booking records preserve the complete pre-write evidence and pending lock. Repeating the identical operation can only complete its journal after the existing native booking is proved; no second PUT is made. Creation failures still require inspection; no speculative retry is enabled.

309 automated tests pass, together with TypeScript checking and the Worker build. This includes the original read-only discovery comparison (51 unchanged source tools), new contract counts, lost-response recovery and pre-write refusals.

## Missing contracts added together

| Contract | State | Purpose |
|---|---|---|
| create_test_bill_credit_note_draft | Implemented; live acceptance pending | Full supplier credit with explicit original and revision |
| get_test_document_payment | Reserved; no reads/writes | Native invoice/bill payment, allocation and ledger evidence with revision |
| void_test_document_payment | Reserved; no reads/writes | Reverse only a recorded synthetic payment; never a bank transfer |

The existing catalog had sales credits and payment creation contracts but omitted supplier credits and document-payment inspection/reversal. These three additions bring discovery from111 to114 tools in write-enabled test mode (102 when disabled). Production remains untouched.

A chat tool-list refresh is necessary to invoke the new supplier credit function for the full live acceptance test. Posting a supplier fixture before its credit function is callable would leave an avoidable outstanding balance. The refresh is a technical dependency, not a request to approve each development batch.

## Work policy and remaining queue

Continue through tested batches without asking for intermediate approval. A successful batch is a checkpoint, not completion of the overall task. Only request user action for an actual unavailable prerequisite or the authorized tool-list refresh.

After refresh: native supplier booking/full-credit acceptance and cleanup; extend verified document booking to additional amounts/currencies/lines; implement recorded payments together with inspection/reversal; verify VAT payment lifecycle; implement explicit FX adjustments and split-bank allocations. Historical rates, EU-sales and OSS require verified native sources and must remain reserved if those sources cannot be established. No MCP reconstruction of accounting analysis reports.
