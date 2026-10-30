# Account and group names, phase 1

The existing `rename_test_account` and `rename_test_account_group` contracts are active only in the write-enabled isolated test worker. No schema changes or new tools. Both require the current `expectedName`, operation UUID and reasoning. Only the native name field is sent. Readback verifies every other field except Billy's updatedTime. Replay never repeats a completed mutation. Uncertain writes remain locked for inspection, with bounded HTTP error diagnostics in the operation journal. Name checks are optimistic, not an atomic lock against Billy UI changes.

Accounts: archived records are refused. Account number, nature, currency, tax, description, group membership and bank fields are preserved.

Groups: Billy rejects changes to records with predefinedAccountGroupId (HTTP 400: linked predefined group is read-only). The handler now refuses these before writing. It never removes this link or changes subtotal rules to force a rename. Custom groups are covered by automated tests, but positive live verification awaits a custom group: all 53 existing test-company groups were predefined. This limitation is exposed by tool status and description.

## Validation on 2026-10-30

Typecheck, worker build and all 148 tests passed. New coverage includes both native name-only payloads, replay, stale names, foreign organization/record IDs, invalid names, archived accounts, concurrent edits, unchanged-name requests, uncertain writes, unexpected readback changes and predefined group refusal.

Live account test: renamed Subscriptions to a temporary TEST-NAME label containing Danish characters, verified all remaining fields, replayed, rejected stale expectedName, then restored Subscriptions. No ledger postings changed. Live group requests were rejected by Billy and the complete original record remained unchanged. After inspection, those journal entries were closed with changed:false and recovery explanations; they were not silently retried. Final guard was tested live to reject before mutation.

## Report investigation

Native account-balance/trial-balance endpoints have not been established from the public Billy API documentation (https://www.billy.dk/api/). The live native bank-account record had no balance or synchronization field. These observations do not prove that other native report endpoints do not exist. The three report contracts remain reserved. No posting aggregation or accounting analysis was added to MCP as a substitute.

Production worker and production branch are unchanged.
