# Document facts as separate test annotations

`set_test_document_facts` is implemented using the existing contract. It stores a complete snapshot of chat-supplied facts in the test worker's D1 operation journal, linked to a Billy attachment and its file ID. This is **not a native Billy OCR-field update**. Billy's public attachment model does not document writable mappings for the full reserved fact schema. No undocumented mapping, replacement of attachment type, or overwrite of comments is attempted.

`get_test_document` now returns a revision and a separately labelled `documentFacts` object when the journal is configured. Native attachment fields are unchanged. Annotation provenance includes storage, source, operation UUID, timestamp, reasoning and file ID at save. A hash of the native attachment identifies whether it has changed since the facts were recorded. Changed-source annotations remain visible with `appliesToCurrentAttachment: false`; they are not silently reused as current facts. An attachment reused under another ID does not automatically inherit facts.

The input is a FULL replacement snapshot. Omitted optional fields remove prior annotation values. Null means unknown, and zero remains zero. Signed amounts are preserved; totals, VAT and line items are not recalculated or interpreted. Bounds: 64 KiB encoded facts, 200 line items, summary 8,000 characters; dates and currency-code syntax are validated. Document text remains untrusted data. No OCR or document download is performed by the setter.

Read a fresh revision before setting facts. The revision includes both the native attachment and latest completed annotation operation, so source changes and intervening annotations reject stale writes. A target lock serializes annotation writes; UUID replay returns the original result without another history entry. The journal completion stores the whole snapshot atomically. Pending entries are not shown as saved facts. External Billy edits are checked optimistically; a subsequent getter detects source changes. No API credentials, file bytes or download URLs are added to annotation records.

The completed operation journal is the persistent annotation history and must not be pruned as disposable logs. Latest completed row order determines the current snapshot. There is no new table or migration. Native Billy search filters continue to search native fields only; they do not search these annotations, and invoice-number searching remains unsupported. Reading or saving annotations does not book entries, alter files or attachment associations, send messages, or close reviews.

## Verification — 2026-10-30

TypeScript checks, worker build and all 162 automated tests passed. New tests cover unchanged native source, separately labelled readback, replay, full replacement, null versus zero, stale source/annotation revisions, foreign identity, invalid/oversized input, invisible pending writes, target locking and historical snapshot selection.

Live in the isolated test company: read an existing synthetic test attachment; saved explicitly synthetic vendor/date/amount/invoice/line-item values, then fetched them in a separate tool call. The returned revision matched the saved result and the full native attachment remained identical. Replay returned the same operation, and a stale new operation was refused. Finally replaced the current annotation with unknown/null fields and an explicit test-completion note, omitting synthetic invoice number and line items. The latest getter confirmed those fields were gone while native attachment/file/owner were unchanged. The test values were not extracted from the PDF and are retained only in history.

Production worker and production branch remain unchanged. Tool names and input contracts are unchanged; no tool-list refresh is needed for calling the existing setter.

API reference inspected: https://www.billy.dk/api/ — attachments model and search filters. Lack of a documented mapping does not establish that native support is impossible; native synchronization remains a separate future enhancement.
