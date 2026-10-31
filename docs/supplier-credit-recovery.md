# Supplier credit creation recovery

Credit creation now preserves the original bill snapshot, exact native payload and expected totals before the first native write. Repeating the same pending operation can complete its journal only when one uniquely marked native credit draft matches all preserved header, line, amount and attachment evidence. The source must retain its original revision; prior DKK credits and allocations are reverified. Foreign credits remain full-source only. Recovery performs zero native writes.

Missing, duplicate, changed, paid or incomplete records retain their pending reservation. The implementation never retries an uncertain native create.

Validation covers simulated lost responses for DKK partial and EUR full credits, changed requests and evidence, altered native records and attachment mismatches. An attached EUR bill/full-credit lifecycle also passed in the native test environment; the source was fully offset and the VAT-period baseline restored. Native connection failure was not deliberately induced: that branch is verified by automated failure-injection tests.

No tool-name or input-schema change is required.
