> Current scope: [partial payments and multiline checkpoint](partial-payments-multiline.md). Earlier counts and full-payment/single-line restrictions below are historical.

> Superseded scope: [foreign document payments, FX protection and bank splits](currency-split-eu-completion.md) are now implemented with documented restrictions.

# Supplier acceptance and recorded document payments — 2026-10-31

Supplier booking/full credit and recorded invoice/bill payment with reversal are now live-verified. No messages, real transfers, production changes or writes to connected bank5711 occurred. Discovery stays114 names. All 321 automated tests pass, with TypeScript checking and Worker build.

## Supplier lifecycle

Operation group b2300001 created/approved a125.08 DKK bill and full linked supplier credit, including reused source attachment files. Native net100.06, purchaseVAT25.02 and payable125.08 offset exactly by account. Both document balances are0. Q4 VAT report and revision exactly returned to their original state.

## Recorded payments

Existing record_test_invoice_payment, record_test_bill_payment, get_test_document_payment and void_test_document_payment are implemented. First phase: full exact DKK payments only, with explicit amount=baseAmount=outstanding gross and no fees, partial allocations, currency differences or credits. Mutations are restricted to the existing offline fixture account5710 by exact ID and configuration checks. No real transfer API is called.

The payment reader returns native payment, allocation, source document, transactions and postings plus a revision. Payment creation requires an approved journal-proven synthetic document, fresh revision, open fiscal date, no active allocations and no credits. Creation checks the exact native cash/control postings and fully paid document, while preserving its other content. Reversal additionally requires a completed payment-creation journal, current evidence, no bank matching and no other active allocation.

Native acceptance groups b2300002 (invoice) and b2300003 (bill) each created/approved a document, registered125.08 on offline account5710, voided the payment, then created/approved a full cleanup credit. All documents end at balance0. Payment pairs have no net ledger effect; all payment postings are voided. Q4 VAT report/revision is identical to the saved baseline.

## Native reversal correction and recovery

Billy retains the original transaction with isVoided=true/isVoid=false and adds a reversal transaction with isVoided=false/isVoid=true. Both transactions' postings have isVoided=true. The verifier requires both complete, opposite sets of cash/control postings; it does not merely trust the payment's flag or a zero sum.

The first invoice-payment void succeeded natively but the initial verifier expected one transaction. Its original operation remained pending. After observing the actual native records and correcting the verifier/tests, identical-operation replay completed only the journal with recovery.nativeWrites=0. No second native void request was sent. The subsequent supplier-payment void passed directly.

Creation and void operations save pre-write evidence. Lost responses can recover the journal only after a unique native payment and unchanged document are proved; ambiguity retains the lock. Creation candidate discovery excludes every pre-existing payment ID. No uncertain write is retried with a new operation ID.

Credit preflight now ignores explicitly voided historical allocations, while still refusing active or indeterminate allocations. This is required to credit a document after a verified payment reversal.

## Remaining scope

Foreign/partial/fee payments, payment FX adjustments, bank split allocations and broader invoice/bill posting support remain separate work. Native historical rates, EU-sales and OSS reports still require verified endpoints. Current-rate data and VAT-return totals are not substitutes. These limitations are not claims of full Numina parity.

VAT payment and refund registration/reversal are also live-verified; see [VAT payment lifecycle](vat-payment-lifecycle.md).
