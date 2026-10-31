# VAT payment and refund lifecycle — 2026-10-31

record_test_vat_payment and void_test_vat_payment are implemented and live-verified for full settled native VAT amounts on the fixed offline test account5710. They register accounting entries only: no transfer, bank refresh, consent, or authority submission occurs. Discovery remains114 contracts. The complete suite has321 passing tests, with TypeScript checking and Worker build.

## Evidence and guards

The period must belong to the locked DKK test organization, have ended, be settled, have a nonzero total matching settledAmount, and have no active payment. Payment date must follow the period end and be outside the fiscal lock. Account5711 and all other accounts are refused. Payment amount/direction comes from Billy's native return: positive VAT uses cash credit; a refund uses cash debit. No amount is inferred from a report reconstructed in MCP.

Both mutations require the current get_test_vat_period revision. Void additionally requires a completed creation journal for the exact native payment, unchanged report evidence and unmatched postings. Native payment ownership is established through returnId and the verified parent VAT return; salesTaxPayments records do not contain organizationId. An explicitly present foreign organizationId is still refused. The earlier VAT-period reader's assumption that every payment had organizationId was corrected after the first native payment exposed it.

Creation and void preserve pre-write evidence. A lost/failed readback never triggers a second native write. The exact same operation may complete its journal only after a unique native payment, the unchanged report and the exact cash/VAT-payable postings are proved. Void requires the original and native reversal transactions and both opposite posting sets, with all postings flagged voided.

## Live acceptance and cleanup

Group b2300004: created/approved a synthetic Q3 sales-VAT fixture yielding+150; set settlement flag; recorded cash-credit150; voided payment; reopened period; created/approved the full original fixture reversal.

Group b2300005: independently repeated the complete lifecycle for a purchase-VAT fixture yielding-150 and a cash-debit refund. Both directions were accepted by Billy. Original fixture and reversal postings offset by account. Settlement/reopening and payment/void ledger pairs are native voided audit trails.

The first payment succeeded natively while the old ownership check rejected readback. After correcting the relationship validation, the original operation was recovered with nativeWrites0. There was no duplicate payment.

After both cleanup cycles, every Q3 salesTaxReturn field is identical to the saved baseline: total0, isSettledfalse, isPaidfalse, paymentDatenull, and the full report unchanged. Q4 was independently restored after the invoice/bill tests. The Q3 aggregate revision differs intentionally because its payment list now retains two voided150 records (one credit, one debit). No active VAT payment remains.

Settlement/reopen now permits explicitly voided payment history, while active or unknown-status payments still block it. History is preserved and compared during transitions; it is not deleted to manufacture the old revision.

## Remaining scope

Foreign/partial/fee document payments, explicit FX-adjustment work, bank splits and expanded invoice/bill currency/line support remain outside this phase. Native historical-rate, EU-sales and OSS endpoints remain unverified. Custom deduction-code creation stays retired.
