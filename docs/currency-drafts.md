# Currency phase 1: EUR drafts with explicit DKK amounts

Implemented on the isolated test Worker using the existing extended create/update tools. No new tool schemas or connection refresh are required to call the fields. Discovery descriptions reflect the restricted phase when refreshed.

Each EUR line requires a positive two-decimal `amount` in EUR and a positive two-decimal `baseAmount` in DKK. Both are capped at 1,000,000. Balance is validated using DKK base amounts and ordinary DKK line amounts. Neither current exchange-rate metadata nor an inferred historical rate is substituted. The caller supplies both amounts. Header currencyId remains DKK; currency is selected on each line.

No line in a draft containing EUR may contain a tax code. USD and other foreign currencies are refused. Existing unsupported payment/contact links remain refused. Account ownership, active state and DKK account checks remain in place. Updating an existing draft revalidates its original lines; readback verifies EUR baseAmount as well as currency and amount. Booking and bank matching remain blocked by their existing DKK checks.

## Live evidence

- Created synthetic draft with expense 100 EUR / 747.36 DKK and an offline-bank counterline of 747.36 DKK. Billy preserved the explicit baseAmount.
- Replaced lines with 100 EUR / 750 DKK and a 750 DKK counterline. Billy preserved the changed baseAmount rather than using the current currency-table rate.
- Booking was refused before mutation, as required for this phase.
- Draft deleted after testing; no financial postings were created.
- 264 automated tests pass, with typecheck and Worker build. Tests include missing/invalid/unbalanced baseAmount, unsupported currencies and EUR VAT rejection.

## Remaining phases

Next: verify native booked EUR amount/baseAmount/exchangeRate behavior, with a matching reversal path and exact cleanup, before enabling normal EUR booking. Then validate VAT conversion/rounding/report periods, payment exchange differences and bank matching. Currency-table rates are not evidence of historical invoice rates. OSS remains a separate unsupported workflow.

Reference: https://www.billy.dk/api/ (daybook lines and currency definitions). Explicit baseAmount write preservation is based on the live tests above; the published daybook line documentation does not fully describe that behavior.
