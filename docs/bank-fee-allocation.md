# Separately booked bank fee validation

The split reconciliation tool accepts its existing optional `fee` field when it identifies one complete, separately booked DKK fee entry among the supplied allocations. It verifies the active expense account, exact bank credit and expense debit, absence of VAT, and the complete native ledger against the original booking journal. Approval and group unlink repeat that verification. No implicit fee booking is performed.

Bank results now return freshly verified posting match states after approval and unlink.

Validation: 384 automated tests passed, including successful fee link/approve/unlink and refusal of altered counterpart amounts, accounts, VAT, dates, void state, text and journal evidence. A synthetic native lifecycle completed on the offline test bank; the original bank revision was restored and both source entries were fully reversed.

Native automatic fee booking, fees in document payments and foreign bank accounts remain outside this implementation. Existing tool names and input schemas are unchanged.
