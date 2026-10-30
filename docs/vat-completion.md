# VAT completion: live test status

Four tools are added on the isolated test Worker. Production remains unchanged.

| Tool | Implemented behavior | Live status |
| --- | --- | --- |
| `get_test_vat_period` | Native return, payments and revision; does not calculate a replacement report | Live-tested on Q3 and Q4 |
| `set_test_vat_return_settlement` | Set/reopen an ended, unpaid period without payment records; optimistic revision, journal, native readback | Zero-balance Q3 settled, reopened and restored; nonzero amounts still untested |
| `create_test_partial_vat_rate` | Native custom 25% purchase VAT rate with explicit deduction percentage and embedded component | Attempt failed; full native rate list still contains only 15 predefined codes. Original operation remains pending; precise upstream reason unavailable |
| `close_test_booking_operation` | Verify approved content against original pending booking revision and actual ledger; complete journal only | Both historical bookings verified and journal completed without native writes |

## Boundaries

Custom code creation does **not** enable custom code booking. The predefined-code validator remains unchanged until actual rounding, tax-period mapping and reversal behavior are verified. Billy documents restrictions for custom tax rates with predefined charts. A rejection must not be bypassed by changing the chart.

Settlement changes the recorded Billy flag only. It is not a tax authority receipt, authority submission or payment tool. Current/future periods, paid periods and periods with payment records are refused. Native side effects outside the expected flag cause an uncertain/pending result that requires inspection. Revision checks are optimistic, not a native transaction lock.

Booking recovery has no native write client. It reconstructs the original draft revision from the approved entry, changing only state back to draft for the hash. If Billy changed another field, it refuses rather than weakening the proof. It verifies native postings twice, validates correction provenance where applicable, and conditionally updates the existing pending journal record without replacing its fingerprint. It never books again.

## Validation

263 automated tests pass, including custom-code duplicate/account/readback guards, period ownership and payment checks, ended-period settlement/reopen, stale revision rejection, uncertain-write retry protection, and evidence-based booking recovery. Typecheck and Worker bundle build pass. These are local tests; they do not establish native API support for new writes.

Live tests found that settlement also sets `settledAmount` from null to the return total. The readback validator now checks this value separately. An exact-revision recovery path completes only a proven existing zero-period settlement without another native write. Tests cover changed evidence and journal conflicts.

Both old pending booking operations are complete. Synthetic transactions 77 and 78 created and reversed a Q3 purchase (100 expense, 25 VAT, 125 offline bank), leaving every affected account and the Q3 VAT report net zero. Q3 settlement/reopen succeeded after the fix; final `isSettled=false`, `settledAmount=null`, no payments, and exactly the original period revision. Current-quarter settlement was refused before native writes.

Custom-code attempt `b1500001-1030-4000-8000-000000000001` remains pending. No custom rate appears in a complete native listing. This is not proof of a specific Billy restriction: the original upstream error was not retained. Do not retry under a new operation ID. Diagnostic retention and resolution of this pending operation remain necessary.

## Still required before calling the entire VAT area complete

- Live tests and resolution of API constraints for the four new tools.
- Automatic custom-code posting, rounding, bank matching and reversal if native creation is available.
- Cross-period corrections, settled periods and fiscal locks, with native report verification.
- Separate EU-sales invoice/customer/VAT-number workflow and the native EU-sales listing; Rubrik B alone is not that listing.
- Foreign-currency and OSS scope: native capabilities and dedicated fixtures before implementation.
- VAT payment/settlement reconciliation, separately from authority submission. Actual authority submission requires explicit authorization and a supported channel.

Prior standard-code, explicit partial-deduction and mixed-code live tests are documented in `partial-deduction-and-mixed-vat.md`. No production records or connected real-bank fixtures are changed by this bundle.
