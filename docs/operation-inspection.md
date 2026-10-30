# Read-only operation inspection

`get_test_write_operation` keeps its existing input schema and journal fields.
`resultIsHistorical: true` makes clear that the saved result is not current state.
`currentEvidence` reads current bank state for reconcile, unlink and approval
operations, including the bank snapshot/revision and up to three associated native
postings. Approval requests resolve their bank line through the owned match/account.
Every returned posting must belong to the locked organization and bank account.
A second bank snapshot detects changes during the read; reads are not atomic.

Observed states are approved, unapproved_with_associations,
unapproved_without_associations, or unknown. These describe current state only.
They do not establish operation causality or prove all intended writes succeeded.
Outcome remains undetermined and safeToRetry is false. No Billy mutations,
journal completion, lock release or automatic retries are performed.

For a pending operation: compare current evidence with the caller's saved preflight
snapshot, intended inputs and native records. Empty/partial associations cannot
identify postings already removed. Preserve the same operation ID and pending lock
until an independently verified recovery is designed. Evidence read failures return
an unavailable indication while preserving the saved journal response. Other action
types explicitly report unsupported current-state inspection; their saved results
remain available. More than three associations returns the snapshot without posting
expansion. This is an inspection capability, not automated recovery.

## Verification, 2026-10-30

193 automated tests passed, plus TypeScript checking and Worker build. Added tests
cover approved, empty and partially unlinked states, no writes, malformed IDs,
wrong matches and unsupported actions. Existing pending-lock tests still pass.
Partial failure was simulated in automated tests, not intentionally induced live.

Live on the isolated test Worker: inspecting a completed historical group-unlink
operation returned saved isApproved=false alongside current approved state and
three native posting associations. Inspecting the later approval showed approved
in both saved/current evidence. Both reads were stable. A booking operation retained
its journal result and explicitly reported unsupported current-state inspection.
No accounting data was changed by this verification. Production is unchanged.
