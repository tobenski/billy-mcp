# VAT completion: next live-test gate

Four tools are added on the isolated test Worker. Production remains unchanged.

| Tool | Implemented behavior | Live status |
| --- | --- | --- |
| `get_test_vat_period` | Native return, payments and revision; does not calculate a replacement report | Awaiting connection refresh |
| `set_test_vat_return_settlement` | Set/reopen an ended, unpaid period without payment records; optimistic revision, journal, native readback | Awaiting past-period fixture and live test |
| `create_test_partial_vat_rate` | Native custom 25% purchase VAT rate with explicit deduction percentage and embedded component | Awaiting native API capability test |
| `close_test_booking_operation` | Verify approved content against original pending booking revision and actual ledger; complete journal only | Awaiting live recovery of two historical operations |

## Boundaries

Custom code creation does **not** enable custom code booking. The predefined-code validator remains unchanged until actual rounding, tax-period mapping and reversal behavior are verified. Billy documents restrictions for custom tax rates with predefined charts. A rejection must not be bypassed by changing the chart.

Settlement changes the recorded Billy flag only. It is not a tax authority receipt, authority submission or payment tool. Current/future periods, paid periods and periods with payment records are refused. Native side effects outside the expected flag cause an uncertain/pending result that requires inspection. Revision checks are optimistic, not a native transaction lock.

Booking recovery has no native write client. It reconstructs the original draft revision from the approved entry, changing only state back to draft for the hash. If Billy changed another field, it refuses rather than weakening the proof. It verifies native postings twice, validates correction provenance where applicable, and conditionally updates the existing pending journal record without replacing its fingerprint. It never books again.

## Validation

261 automated tests pass, including custom-code duplicate/account/readback guards, period ownership and payment checks, ended-period settlement/reopen, stale revision rejection, uncertain-write retry protection, and evidence-based booking recovery. Typecheck and Worker bundle build pass. These are local tests; they do not establish native API support for new writes.

After deploying, refresh the Billy-test connection to discover the four new tools (88 total with writes enabled). Then read the current VAT period and test both recovery operations with fresh approved revisions. Test custom-code creation and ended-period settlement on synthetic records, inspecting uncertain writes before any further attempt.

## Still required before calling the entire VAT area complete

- Live tests and resolution of API constraints for the four new tools.
- Automatic custom-code posting, rounding, bank matching and reversal if native creation is available.
- Cross-period corrections, settled periods and fiscal locks, with native report verification.
- Separate EU-sales invoice/customer/VAT-number workflow and the native EU-sales listing; Rubrik B alone is not that listing.
- Foreign-currency and OSS scope: native capabilities and dedicated fixtures before implementation.
- VAT payment/settlement reconciliation, separately from authority submission. Actual authority submission requires explicit authorization and a supported channel.

Prior standard-code, explicit partial-deduction and mixed-code live tests are documented in `partial-deduction-and-mixed-vat.md`. No production records or connected real-bank fixtures are changed by this bundle.
