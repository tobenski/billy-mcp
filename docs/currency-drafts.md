# Currency support — current status, 2026-10-31

The isolated test Worker supports DKK and source lines in EUR, USD, GBP, SEK and NOK. Every foreign-source line requires an explicit positive two-decimal `amount` and DKK `baseAmount`, each at most 1,000,000. Header currency and accounts remain DKK. Balance uses DKK base amounts. No exchange rate is chosen or looked up automatically.

Create/update, booking and full reversal support the 15 validated native standard VAT codes, including KR, reverse charge, EU sales and zero-rate codes. VAT input is explicitly gross. The native standard configuration is revalidated; custom codes are refused. Billy retains source currency/amount/baseAmount but posts DKK to DKK accounts. Native ledger verification checks this representation and integer-cent VAT rounding. Reports remain unchanged native Billy data.

Exact single DKK bank-posting matching, approval, reopen and unlink work for foreign-source entries. The bank posting must equal the line amount and side exactly. Fees, split/partial payments, payment exchange differences and foreign-currency bank accounts remain unsupported. Unlink before reversing a VAT/foreign-source entry. Replacement corrections are still limited to DKK without VAT.

## Live matrix

| Transactions | Scenario | Evidence |
|---|---|---|
| 83–86 | EUR without VAT | Explicit base preserved; full reversal, zero account net |
| 87–90 | EUR Danish purchase/sales K/S | 935.79 DKK gross → 748.63 net + 187.16 VAT |
| 91–92 | EUR EU goods/services reverse charge | Native input/output tax and Rubrik A; exact reversal |
| 93–94 | EUR non-EU services, domestic reverse charge, imported goods invoice | Native standard-code postings/report |
| 95–96 | EUR mixed S/SVE/SYE/SVU/SYU/SOB/SF | Seven-code booking/reversal and native B/C report |
| 97–98 | EUR representation KR and no-deduction KF | Native deduction/rounding preserved |
| 99–100 | USD purchase K | Explicit DKK amount; native report and reversal |
| 101–102 | GBP sale S | Explicit DKK amount; native report and reversal |
| 103–104 | SEK purchase K | Explicit DKK amount; native report and reversal |
| 105–106 | NOK without VAT | Explicit DKK amount; full reversal |
| 107–108 | EUR K, exact offline DKK bank line | Link/approve/unlink; original bank subject restored |
| 109/112, 113/116 | Prior-period sales/purchase VAT | Positive/negative settlement, reopen and full reversal |
| 117–120 | Open Q3→Q4 reversal and cleanup | Native +150/−150 VAT in selected periods; both restored |

All matrix financial effects were neutralized. Q3 and Q4 complete VAT-period revisions match their starting revisions. Bank cleanup preserves the original bank line, subject and approved state; association IDs and approval timestamps change natively when recreated. One clearly named synthetic German contact remains as a nonfinancial fixture with its synthetic registration number cleared.

Unit coverage includes invalid currencies/base amounts, unbalanced bases, wrong native currency/rate, VAT rounding, source preservation, foreign-source bank lifecycle, fiscal-lock boundaries, and refusal in settled periods. A live settled-period booking was refused before native mutation; its draft was deleted and the period restored.

## Separate future functions

Historical rates, payment FX differences, invoice/bill payment allocation, foreign bank accounts and OSS are not established by these tests. New reserved contracts are listed in `autonomous-completion.md`; stubs perform no API calls. Standard EU Rubrik B is not an OSS report or a customer-level EU-sales list.
