# Correction drafts, phase 1

`propose_test_booked_change` creates a draft with exact opposite sides of the original native postings, followed by the supplied full replacement. `propose_test_reversal` creates only the opposite postings. Both preserve the original, copy links to existing files and require separate `book_test_daybook_draft`. These are compensating entries, not Billy native void operations.

Use the native transaction ID and revision from `get_transaction`. Only active, unbankmatched, test-tool-created DKK daybook entries without tax or linked payments are supported. Corrections of corrections are refused. Dates cannot precede the source date. One active proposal or booked correction is allowed per source. Operation UUID replay returns the same result.

Booking validates the saved proposal provenance and rechecks its source revision. Changed proposals must be deleted while unbooked and regenerated. Revision checks are optimistic; Billy UI edits cannot be atomically locked. Failed writes remain pending for inspection rather than automatic duplication.

## Verification, 2026-10-30

TypeScript checks, worker build and all 143 automated tests passed. New tests cover replacement and reversal-only drafts, file links, replay, duplicate rejection, stale revisions, bank-matched sources, invalid dates/amounts/accounts, provenance changes and a file-copy timeout.

Live in the isolated test company: created and booked synthetic TEST-CORR-01 for DKK 10 subscription debit/bank credit with a reused PDF. Created its four-line correction: inverse DKK 10 lines plus DKK 12 office debit/bank credit. Verified copied PDF link, unchanged original revision, replay without duplication, duplicate-source rejection and stale-revision rejection. Separately booked the correction and verified all four native postings. Net effect of this isolated pair is DKK 12 office debit/bank credit; original remains visible. The previously bank-approved test transaction was rejected as a correction source without mutation.

Standalone reversal-only is covered by automated tests and deployed but was not called through the live connector: its newly added tool needs an app tool-list refresh. Existing correction and booking tool schemas were unchanged. Production was not modified.
