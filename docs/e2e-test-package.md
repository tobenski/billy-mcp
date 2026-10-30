# Comprehensive synthetic E2E package v1

Batch: `E2E-20261030-01`. DKK without VAT, test organization only.
Never rerun writes with new operation IDs for the same batch. Generation is local
and does not write to Billy. The fixed batch/date/UUIDs describe one run, not a
template to blindly replay in another organization.

## Reproduce artifacts and validate evidence

Requirements: Python 3, ReportLab, DejaVuSans, Poppler `pdftoppm`.

```sh
python3 fixtures/e2e-v1/generate.py /tmp/billy-e2e-fixtures
python3 fixtures/e2e-v1/verify.py /private/state.json /private/test-results.json
```

The generator creates ten clearly synthetic PDFs, one PNG variant, a seven-row
bank CSV and deterministic operation UUIDs. The verifier consumes the private
captured evidence from this run; it does not fetch data or call the MCP server.
Do not commit `state.json` or live record IDs to this public repository.

## Scenarios and observed status

| Case | Scenario | Status before bank import |
| --- | --- | --- |
| A | Subscription 120 | Draft ready |
| B | Split 80 office + 45 equipment | Three-line draft ready |
| C | Office 240 initially on wrong account | Draft corrected; review resolved |
| D | Equipment 999.95 | Draft ready |
| E | 0.10 office + 0.20 equipment, PNG | Balanced; downloaded image visually checked |
| F | Credit note / refund 50 | Bank debit, office credit draft ready |
| G | Missing receipt 75 | Placeholder only; open review; unbooked |
| H | Incorrect internal allocation 60 | Original and correction booked; review resolved |
| I | Temporary internal allocation 25 | Original and full reversal booked; net zero |
| J | Cancelled draft 13 | Attachment association removed; draft deleted |

The pre-import evidence passed 91 assertions (not 91 independent integration
tests). Nine uploaded PDFs downloaded byte-identically. Billy transformed the
PNG; the tool returned `originalMatches=false`, `representation=billy_stored`
with a separate hash, and the downloaded image was legible on visual inspection.

Negative checks passed for reused operation UUID with changed input, imbalance,
stale revision, deleting a booked draft, and unsupported EUR. Exact create replay
returned the original draft. Existing baseline daybook headers were unchanged;
this is not a whole-ledger audit.

## Bank phase is pending, not passed

No bank-line import tool exists. Import the supplied CSV exactly once into the
test bank account. Seven rows total -1510.25: A-F net -1435.25; G -75 stays open.
Link A-F to their **drafts before booking**, test unlink/relink on one match,
then book and approve the matches. Review notes are advisory, not enforced
booking blocks. Do not book G.

| Account | Verified posted effect now | Expected after bank phase |
| --- | ---: | ---: |
| 1815 subscription | 0.00 | 120.00 |
| 1810 office | 60.00 | 330.10 |
| 1880 equipment | -60.00 | 985.15 |
| 5710 bank | 0.00 | -1435.25 |

Effects are batch increments, not company balances. Four native transactions
are booked now (H, I and their correction/reversal). Final expectation is ten
transactions, six approved bank rows, one open bank row and one remaining draft.
VAT, currency conversion, linked invoice payments and correcting bank-matched
entries are outside this package. Correction entries themselves are returned
as ineligible for further correction; fresh `reviewSource` provides their
postings and attachments for independent verification.

No server deployment or tool refresh is required for these fixtures.
