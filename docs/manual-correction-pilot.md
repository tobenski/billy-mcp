# Manual daybook correction pilot

The isolated test Worker now supports correction proposals for explicitly authorized, manually created DKK daybook entries. Production is unchanged. No new tool names or input fields were added.

`BILLY_TEST_MANUAL_CORRECTION_IDS` is a deployment-only comma-separated allowlist of up to 100 native daybook IDs. The scope is bound to the request's read client and locked organization. It is never inferred from descriptions, voucher numbers or caller arguments. Keep this binding when redeploying. Records outside the allowlist remain ineligible; existing tool-created record rules remain in place.

Native single-line contra-account entries are expanded into two gross lines for financial verification and correction preparation. The original header, native lines, files and original snapshot revision remain preserved. Foreign currencies, contra-account VAT and linked payments are rejected in this pilot. Approved bank-matched VAT sources remain unsupported. No existing record is retagged as tool-created.

Authorized manual sources can receive one correction draft containing the full reversal and explicit full replacement, including validated gross VAT codes. Booking is a separate operation with source revision/provenance checks and native net/tax posting verification. The original entry is never deleted or overwritten. This is not general permission to edit arbitrary accounting records.

Validation: typecheck, bundle and all 421 automated tests pass. Added tests cover missing/foreign scope, native contra expansion, VAT reversal/replacement, preserved source, and unsupported contra fields. Live tests passed for account reclassification, introduction of purchase VAT, amount correction and a multiline text change. Original records and file links were unchanged; all eight proposal/booking operations completed. The requested draft edit/delete tests remain untested because those user-created records were already approved.

Private record IDs and accounting evidence are excluded from this public document.
