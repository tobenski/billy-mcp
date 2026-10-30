# Currency: EUR drafts, booking and full reversal without VAT

Implemented on the isolated test Worker using the existing extended create/update tools. No new tool schemas or connection refresh are required to call the fields. Discovery descriptions reflect the restricted phase when refreshed.

Each EUR line requires a positive two-decimal `amount` in EUR and a positive two-decimal `baseAmount` in DKK. Both are capped at 1,000,000. Balance is validated using DKK base amounts and ordinary DKK line amounts. Neither current exchange-rate metadata nor an inferred historical rate is substituted. The caller supplies both amounts. Header currencyId remains DKK; currency is selected on each line.

No line in a draft containing EUR may contain a tax code. USD and other foreign currencies are refused. Existing unsupported payment/contact links remain refused. Account ownership, active state and DKK account checks remain in place. Updating an existing draft revalidates its original lines; readback verifies EUR baseAmount as well as currency and amount. Booking and full reversal without VAT are supported on DKK accounts. Bank matching and replacement corrections remain blocked for EUR sources.

## Live evidence

- Created synthetic draft with expense 100 EUR / 747.36 DKK and an offline-bank counterline of 747.36 DKK. Billy preserved the explicit baseAmount.
- Replaced lines with 100 EUR / 750 DKK and a 750 DKK counterline. Billy preserved the changed baseAmount rather than using the current currency-table rate.
- Booking was refused before mutation, as required for this phase.
- Draft deleted after testing; no financial postings were created.
- 264 automated tests pass, with typecheck and Worker build. Tests include missing/invalid/unbalanced baseAmount, unsupported currencies and EUR VAT rejection.

## Remaining phases

Next: validate VAT conversion/rounding/report periods, payment exchange differences and bank matching. Native no-VAT EUR booking/full reversal on DKK accounts is verified below. Currency-table rates are not evidence of historical invoice rates. OSS remains a separate unsupported workflow.

Reference: https://www.billy.dk/api/ (daybook lines and currency definitions). Explicit baseAmount write preservation is based on the live tests above; the published daybook line documentation does not fully describe that behavior.

## Phase 2 live booking evidence

Billy retains EUR `amount` and explicit DKK `baseAmount` on approved source lines, but posts the DKK base amount to the selected DKK accounts. Native postings have currency DKK, amount equal to baseAmount, exchangeRate 1 and no tax-period reference. The verifier checks exactly this representation; it does not infer the original EUR amount from the ledger.

The initial booking completed natively but failed our former EUR-posting assumption. Its pending journal was recovered only after matching the original full draft revision and native DKK ledger, with zero additional native writes.

- Transactions 83/84: original and reversal retain 100 EUR / 750 DKK on source lines. Each affected DKK account sums to zero; attachments copied.
- Transactions 85/86: independent post-fix booking/reversal with 100.01 EUR / 747.43 DKK. Both operations completed directly; each affected account sums to zero.
- Original source records are unchanged. Reversal uses original amount and baseAmount, never a current exchange rate.
- 266 automated tests pass, plus typecheck and Worker build. Tests cover DKK-native representation, incorrect conversion metadata, full EUR reversal and refusal of EUR replacement corrections/bank approval.

Still unsupported: EUR VAT, foreign-currency accounts, USD/other foreign currencies, exchange differences at payment, bank reconciliation, automatic historical exchange rates and OSS. Existing phase-1 evidence above remains historical: its booking refusal was expected before phase 2.
