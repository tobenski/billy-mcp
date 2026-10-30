# Correction drafts: replacement, reversal and bank-preserving reclassification

Aktuel momsudvidelse: standard dansk 25 % moms kan bogføres og fuldt tilbageføres. Bankafstemning med moms og erstatningsrettelser med moms er fortsat afgrænset fra. Se [kontrakt og live-test](vat-booking.md). De tidligere testforløb nedenfor er historiske.

`propose_test_booked_change` creates a draft with exact opposite sides of the original native postings, followed by the supplied full replacement. `propose_test_reversal` creates only the opposite postings. Both preserve the original, copy links to existing files and require separate `book_test_daybook_draft`. These are compensating entries, not Billy native void operations.

Use the native transaction ID and revision from `get_transaction`. Only active test-tool-created DKK daybook entries without tax or linked payments are supported. Unbankmatched entries allow full replacement/reversal. Supported approved bank matches allow non-bank reclassification as described below. Corrections of corrections are refused. Dates cannot precede the source date. One active proposal or booked correction is allowed per source. Operation UUID replay returns the same result.

Booking validates the saved proposal provenance and rechecks its source revision. Changed proposals must be deleted while unbooked and regenerated. Revision checks are optimistic; Billy UI edits cannot be atomically locked. Failed writes remain pending for inspection rather than automatic duplication.

## Verification, 2026-10-30

TypeScript checks, worker build and all 143 automated tests passed. New tests cover replacement and reversal-only drafts, file links, replay, duplicate rejection, stale revisions, bank-matched sources, invalid dates/amounts/accounts, provenance changes and a file-copy timeout.

Live in the isolated test company: created and booked synthetic TEST-CORR-01 for DKK 10 subscription debit/bank credit with a reused PDF. Created its four-line correction: inverse DKK 10 lines plus DKK 12 office debit/bank credit. Verified copied PDF link, unchanged original revision, replay without duplication, duplicate-source rejection and stale-revision rejection. Separately booked the correction and verified all four native postings. Net effect of this isolated pair is DKK 12 office debit/bank credit; original remains visible. The previously bank-approved test transaction was rejected as a correction source without mutation.

Standalone reversal-only was also live-verified after the connector refresh. Created and booked separate TEST-REV-01 for DKK 7 subscription debit/bank credit with a reused PDF, called propose_test_reversal, checked its two inverse lines and file link, then separately booked it. Native postings net to zero on each account; the original revision and PDF remain unchanged. Replay returned the same proposal; a new operation UUID for the same source was rejected. Existing correction and booking tool schemas were unchanged. Production was not modified.


## Approved bank matches: non-bank reclassification

Supply the full intended replacement, including exactly the original bank account,
amount and debit/credit side. The handler verifies one active DKK bank account,
one bank posting, one approved single-line match, its native posting association,
and no fee/difference. It creates only the reversal of the non-bank source lines
plus the non-bank replacement lines. The original bank posting, match and files
remain intact. The proposal copies file links and requires separate booking.
`get_transaction` returns `correctionMode=non_bank_reclassification` and
`reversalEligible=false` when this is supported. Existing tool schemas are unchanged.

A changed bank amount/account/side, extra bank leg or reversal-only request is
rejected with `BANK_MATCH_PRESERVED`. This handler preserves the match. To change the bank amount, use the separately
verified reopen and grouped-reconciliation workflow described below.
No automatic interpretation or account recommendation is performed by the server.

Source revisions now include the verified native bank evidence. Booking checks
source/proposal provenance immediately before the write and checks source and
bank evidence again afterwards. A replacement account becoming a bank account
also prevents booking. As before, this is optimistic verification, not an atomic
lock against concurrent Billy UI changes. Corrections of corrections remain blocked.

### Verification, 2026-10-30

Live: changed a prior synthetic DKK 299 subscription entry into office DKK 199
and equipment DKK 100. Three non-bank postings were booked; the original source,
file link, bank posting, approved match and bank revision were unchanged. A bank
amount change to 300 and reversal-only were rejected. Replay returned the existing
proposal. A separate proposal on the E2E A entry succeeded and was deleted without
booking, preserving the completed E2E package's ledger effect.

The first live proposal created its draft/file link but left a pending journal
outcome during final verification. Repeated source lookups were reduced to fit
the Free Worker request budget; raising limits was refused and no paid plan was
enabled. The exact existing draft, lines, files, source and bank evidence were
independently verified, then that single pending journal row was conditionally
completed with explicit recovery provenance. No Billy write was replayed or
pending row discarded. The optimized proposal and subsequent booking succeeded.
This was an operator recovery, not a new automatic retry capability.

Typecheck, Worker build and automated regression tests cover matched reclassification,
changed bank amount/account/side, duplicate bank legs, reversal refusal, changed
approval, broken associations, replay and a source-read budget regression. Only the
test Worker was deployed; production is unchanged.


## Amount correction after reopening (live verified 2026-10-30)

Read the approved single-posting bank match, reopen/unlink its exact posting with
`unlink_test_bank_line`, then read a fresh source revision. Propose the full
replacement and book the correction separately. Link the original native transaction
and correction native transaction together using `reconcile_test_bank_line`, then
approve with a fresh bank revision. All bank legs are included: original, reversal
and replacement. Their signed net must equal the existing bank line exactly.
A changed accounting amount does not change bank evidence: a difference is rejected.

Synthetic live tests changed A120 to125 and B125 to120, matched each group to the
existing bank line with the correct amount, and approved both. All six bank legs
were matched; originals, files and bank lines were preserved. A125 against a120
bank line was rejected without mutation. Replay caused no duplicate approval.
187 automated tests plus typecheck/build passed. See bank-links.md for boundaries:
grouped approved matches can now be reopened with an explicit group reference
(see the later 191-test checkpoint); correction chains remain blocked.
