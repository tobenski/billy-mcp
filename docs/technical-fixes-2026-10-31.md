# Test Worker: interruption safety and credit-note evidence

Implemented on the isolated test Worker. Production is unchanged.

- Register only the requested MCP tool for tools/call; discovery still lists all tools. Local mean CPU for the status call fell from approximately 28 ms to 4 ms; these are not Cloudflare measurements.
- Migration 0003 adds attempt tokens, pre-write leases and durable mutation phases. Enable BILLY_TEST_GUARDED_WRITES=enabled only after migration. Expired prepared attempts may resume with identical operation UUID and input. Any possibly executed mutation remains locked unless operation-specific readback proves completion. Legacy pending rows are not automatically released.
- Fence stale handlers from updating journal checkpoints or making native writes after takeover.
- Allow attachment-only updates on proven test invoice/bill credit notes, including approved documents. Financial edits remain rejected. Preserve existing evidence and verify all financial fields after attaching.
- Recover completed document/draft attachment links after a lost response without repeating native writes. Partial or ambiguous outcomes remain blocked.

## Validation

Typecheck, Worker bundle and all 418 tests pass. Tests cover expired attempts, stale handlers, uncertain outcomes, revision checks, ownership, financial drift and duplicate prevention.

Live checks: both approved credit-note types accepted their own evidence; exact replays created no duplicates; temporary staging associations were removed. No financial postings changed. Twenty sequential document reads succeeded. Two batches of twenty concurrent reads had three and two access failures respectively; the second batch returned HTTP 403 Access denied, before Billy handler execution. This remaining burst-load authorization issue is not considered fixed. No authorization rules were weakened. The original internal-error CPU cause is still unproven.

No new tool names or input fields: no tool-list refresh required. Public source contains no real bank fixtures.
