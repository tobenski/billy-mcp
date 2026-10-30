# Bank-integration read preparation

The existing get_test_bank_balances tool now includes integrationEvidence, separate
from bookkeeping balances and recent bank-line observations. No schema/tool-count
change is needed. It uses a test-only transport with two fixed GET paths on
https://api.billysbilling.com:

- /reconciliation/organizations/{lockedOrganization}/bank-accounts
- /banking/{lockedOrganization}/accounts

Both paths were observed in Billy's public client. Organization identity is verified
through the existing v2 client before these requests. An optional ledger account ID
is ownership-checked and filters records by bookkeepingAccountId or externalAccountId.
The generic raw tool and production read-only client remain restricted to v2.
No connection, consent, sync, booking, reconciliation or mutation endpoints are called.
Redirects are not followed; upstream error bodies are not exposed. Source balance
units and currencies are preserved. The public client converts reconciliation balance
values from minor units; this reader deliberately returns raw values with that note.

Responses must contain a data array; malformed/foreign evidence is unavailable, never
converted to an empty list. Native pagination/completeness has not been established.
An empty result does not establish that no bank connection exists. fetchedAt records
our request time and is not a bank synchronization timestamp. Normalized bank balance
and synchronization fields remain unknown pending connected-bank verification.

## Preflight, 2026-10-30

206 automated tests, typecheck and Worker build passed. Tests cover exact GET paths,
manual redirect handling, raw value/null preservation, selected-account filtering,
foreign identity/records, invalid IDs,403 without data disclosure and empty responses.

Live: the reconciliation bank-account endpoint accepted the test API token and
returned the existing synthetic offline bank account, with source BILLY and null
booked/available bank balances. The banking accounts endpoint returned403. Access
failure is explicit in integrationEvidence; no alternative credential or session was
used. This is partial API access, not a verified connected-bank result. No production
or accounting data was changed.

## User setup and next read-only test

1. In the test company, create/use a separate bank ledger account named
   "Bankintegration – kun læsetest". Preserve offlinebank for synthetic write tests.
2. Connect the bank through Billy's own setup and verify that it is mapped to the
   new account. Select only the intended bank account and an appropriate import
   start date. Bank login/consent happens in the user's UI, never through this tool.
3. After Billy completes its initial synchronization, report readiness and the
   ledger account name/number. No credentials or bank statements need to be sent.
4. Read only that account. Verify linkage, source/provider, native balance value/unit,
   currency, status and any timestamp actually returned. Compare with Billy's visible
   bank data. Keep bookkeeping balance separate from bank-reported/available balance.
5. Recheck the previously denied endpoint once after setup. If403 persists, document
   the permission limitation; do not claim a missing timestamp is zero or that consent
   can be renewed through this reader. No automatic sync/reconnect attempt.

Real imported bank data must stay out of public GitHub fixtures/logs/reports. Only
synthetic/redacted structural examples belong in repository tests. Do not run the
synthetic booking/reconciliation scenarios on the integrated account.
