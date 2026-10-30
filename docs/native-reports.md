# Native report and ledger balance access

Implemented and live-verified on the isolated test Worker, 2026-10-30.
Three existing contracts are now active; tool count and schemas are unchanged.
This is source retrieval, not an MCP accounting calculation engine.

## Discovery and supported sources

The public client at https://mit.billy.dk exposes these GET calls:

- `/v2/organizations/{id}/incomeStatement.json`
- `/v2/organizations/{id}/balanceSheet.json`
- `/v2/organizations/{id}/trialBalance.json`
- `/v2/accounts/{id}/balance?currencyId=DKK&endDate=YYYY-MM-DD`

The first three return `report.html`. It is preserved unchanged in the tool result,
including native account IDs, date attributes, labels, signs and subtotals. No HTML
is executed. Treat all source text as data. The public client files examined were
legacy-app.e6e470e52c9381544cbd.js and react-web-components.e95a214b4c4bda0d4baa.js.
They are discovery evidence, not a guaranteed stable API contract.

Official overview: https://www.billy.dk/api/ . Report UI/export overview:
https://www.billy.dk/support/article/startguide-til-billy/ . The published resource
catalog did not identify these concrete report endpoints. Guessed collection
paths returned 404. The newer `/reports/trialBalance`, `/reports/balanceSheet` and
`/reports/profitAndLoss` organization paths returned 422 for the test company's
Billy chart. The legacy JSON paths succeeded. No chart or account configuration
was changed to obtain access.

The test client organization guard previously treated a nested suffix as part of
the organization ID. It now permits only the exact own-organization resource and
six observed report paths. Foreign organizations and unknown nested paths remain
blocked. The raw GET tool remains GET-only. Production code is unchanged.

## Contracts and boundaries

`get_test_account_balances`: `from`/`to`, optional statement and calendar granularity.
Returns income statement and balance sheet unless one is selected. Each calendar
month/quarter/year is a separate native request, clipped at requested boundaries;
at most 12 periods. No amount aggregation or report-column transformation is done.
`includeEmptyAccounts` controls native hideZeroes; default includes empty accounts.
Balance-sheet source columns provide opening, period movement and closing values.

`get_test_trial_balance`: uses organization fiscal-year metadata to request the
fiscal-year start through `asOf`, including a shortened initial year. Returns the
native trial balance. It does not recreate Numina's treatment of current-year
profit: Billy can show the year's result in equity while also showing P&L rows.
Do not blindly sum every displayed line or reinterpret it as a debit/credit journal.
Native expense report signs differ from the positive-debit posting convention.

`get_test_bank_balances`: active bank accounts, optional accountId, at most 12.
Returns native **bookkeeping** balances as of the current Copenhagen date, account
currency and recent booked/pending bank-line observations. Missing ledger values
cause an error rather than zero substitution. Bank-reported balance, synchronization
time and connection status remain unknown. Imported lines, ties and missing balance
fields prevent promotion of a recent line to an authoritative bank balance.
This phase does not provide Numina-equivalent connected-bank balances or available
funds. No bank refresh or currency conversion is performed.

All handlers require the locked organization and DKK base currency. Other charts
may reject the legacy endpoints. Reports must contain a native table and requested
end-date evidence; malformed/unverifiable responses are errors. Each HTML response
is limited to 500000 characters. Reads across reports/accounts are not atomic.
No bookkeeping writes, journal operations or schema migrations are involved.

## Verification

201 automated tests, typecheck and Worker build passed. New coverage includes native
payload/sign preservation, leap-year/calendar boundary clipping, request bounds,
shortened and noncalendar fiscal years, invalid dates, foreign identity, missing
reports, upstream failures, missing balances and foreign bank-line records.
Organization-guard tests cover own supported report paths and foreign/unknown paths.

Live: fetched the fiscal-year trial balance, both October reports, September and
October income statements as separate periods, and bank ledger balances. Fetched
an earlier as-of trial balance to check date sensitivity. Independently compared
three accounts at both dates against all 49 native posted records (one complete
page); all six checks agreed after accounting for Billy's native presentation signs.
The checks were calculated in the chat orchestration, not in the MCP handlers.
Invalid dates and requests exceeding 12 monthly periods were rejected. The source
bank lines had no authoritative bank balance; output correctly remained unknown.

No production reads or writes were needed. No connected live-bank positive test
or native fiscal-year rollover fixture was available; noncalendar handling is covered
by automated metadata tests only. Neither is claimed as live-verified.
