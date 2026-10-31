# Exact foreign partial credits

Existing supplier and customer credit tools now accept up to four sequential foreign credits for a single source line. Supplier bills retain ordinary purchase VAT. Customer invoices preserve explicit gross or net basis and require quantity one, with the existing uniform supported sales VAT validation. Source currency and the explicitly recorded exchange rate are preserved. Multiline foreign documents still require a full credit.

Before creating or booking a credit, the verifier checks the original native ledger, all prior journal-proven credit ledgers and native allocations. Proposed and remaining credits must conserve original source net/VAT totals and converted DKK expense or revenue, VAT and control amounts exactly. Nonconserving rounding is refused before creation. No residual adjustment or inferred exchange rate is introduced.

Supplier conversion uses gross control and a VAT rounding remainder; customer conversion rounds net and VAT separately. These document-specific rules remain distinct.

Native EUR acceptance covered both supplier and customer originals, a first partial credit, a final rest credit and a nonconserving amount refused before creation. All affected native ledger accounts summed to zero in integer cents after the credits; the complete VAT-period baseline was restored. No customer delivery or bank transfer occurred.

Automated tests cover sequential foreign credits, unsafe rounding, earlier-credit validation, exact remaining budgets and lost-response recovery. The complete suite is checked together with TypeScript and the Worker build. Existing tool names and schemas are unchanged.

Net-price extension: an unsent EUR invoice was credited in two steps using prices excluding VAT. Both native credit ledgers exactly offset the original receivable, revenue and VAT; source balances and the VAT-period baseline were restored. Nonconserving rounding was refused before creation. The full suite contains 402 passing tests, including lost-response recovery and wrong-basis refusal.
