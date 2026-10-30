# Advisory review notes in the test worker

`create_test_review` fills a missing lifecycle contract: the reserved `resolve_test_review` could close a review, but no tool could create one. The new creator takes subjectType (attachment or transaction), subjectId, issue, operationId, reasoning and expectedRevision. The existing resolve schema is unchanged. Both use **reviewRevision**, not the ordinary document-facts/correction revision, from a fresh subject read.

Reviews are explicit chat-supplied notes stored in the D1 operation journal. They are not native Billy review states. The code never discovers accounting issues, decides whether an issue has been fixed, changes ledger data, or blocks booking based on open notes. Closing records the supplied resolution in reasoning. The issue, opening explanation and source version remain available after closure. Reopening is not provided; a new issue can be created if needed.

Read reviews through get_test_document or get_transaction. These include reviewRevision, reviewSourceRevision and the source evidence used for review checks. Attachment evidence includes the current native attachment and stored document-facts revision. Native transaction evidence includes transaction, postings and original-document attachment links with their facts revisions. Transaction subjects use native transaction IDs, not draft IDs. No balances or interpretation are calculated.

Source changes invalidate old tokens. Notes expose sourceChangedSinceOpened, and closed notes also expose sourceChangedSinceResolved. A fresh token allows deliberate closure after an underlying correction. Review-source lookup failures are explicitly unavailable with a null reviewRevision, never reported as an empty review list. Existing native records can still be read in that case.

The journal stores each subject's complete review list as an atomic completed operation. Pending operations are invisible and lock further review writes for that subject. Repeated UUID and input replay without adding another note or closing twice. Unknown IDs, stale revisions, identical open issues and already-closed notes are refused. Limits: 100 notes per subject, 128 KiB total review-state JSON, 4,000 characters per issue or reasoning. Historical journal entries must be retained. Native Billy/UI changes are checked optimistically and cannot be atomically locked with D1.

## Verification — 2026-10-30

TypeScript, worker build and all 169 tests passed. Automated coverage includes opening/closing and replay, unchanged source and preserved issue/history, multiple independent notes, duplicate open issues, stale and unknown/already-closed review IDs, source changes before and after closure, transaction evidence, cross-subject isolation, foreign ownership, concurrent edits, uncertain journal commits and unavailable-read reporting.

Live connector verification after tool-list refresh: created one explicitly synthetic review on an attachment and one on a native test transaction. Both were read back as open, then closed with an explicit test-resolution explanation and read back as resolved. Creation and closure replay returned the saved operation without duplication. An identical open issue, stale review revision and second closure under a new UUID were rejected. The issue/history remained present, both source revisions stayed unchanged, and both synthetic reviews are closed. No ledger, native attachment or document-fact changes were made.

The test registry now has 84 tools with draft writes enabled. The refreshed connector now exposes the creator; its complete live lifecycle is verified. Production is unchanged. The API review contract is local to this test integration and does not claim semantic parity with Numina or Billy UI workflows.
