# Native endpoint recheck and placeholder removal — 2026-10-31

The user requested a renewed endpoint investigation, followed by removal of unsupported placeholders before the broad test package. No native accounting writes were made by this investigation or removal.

## Findings

- Billy's current API documentation describes binary file upload using `POST /v2/files`, returning file/attachment records and a download URL. It does not document creation of a voucher-upload link. Existing `upload_test_file` implements the useful direct-byte upload route.
- The current public app index still references `legacy-app.e6e470e52c9381544cbd.js`, `react-web-components.e95a214b4c4bda0d4baa.js`, and the previously inspected core/assets bundles. Their upload paths use `/v2/files` or multipart uploads to the voucher service's organization-specific `/vouchers` route. The signed upload URL flow found in the React bundle is for e-invoicing KYC identity documents, not accounting attachments. No KYC requests were made.
- The published OSS guide describes country-specific accounts, tax rules and lines in the ordinary VAT statement, with period-specific drill-down. The API documentation and reviewed client bundles supplied no verified dedicated OSS report endpoint. The current guide and API documentation were fetched again.
- These findings establish that the two desired contracts could not be verified from the examined sources. They do not prove that no private or future vendor endpoint can exist. No guessed mutations or messages to the vendor were used.

Sources: [Billy API](https://www.billy.dk/api/), [Billy OSS guide](https://www.billy.dk/support/article/brug-af-moms-one-stop-shop-i-billy/), and the public script assets linked by [Billy's web app](https://mit.billy.dk/).

## Changes

`create_test_upload_link` and `get_test_oss_report` are removed from registration and input-schema catalogs. They are no longer callable placeholders. Enabled test discovery contains 112 tools instead of 114; the development catalog contains 46 instead of 48. Production's 51 read-only tools are unchanged.

Status contract version 3 reports unsupported capabilities separately from tools. The 27-entry Numina comparison preserves an empty target list for `create_upload_link`, explicitly documenting that direct byte upload is an alternative, not semantic parity. OSS configuration, native VAT-period/account readers and file upload remain available.

Tests verify that both removed names are absent from discovery/status, attempts to call them are rejected without Billy network access, and the useful alternative tools remain exposed. A connector may retain old discovery descriptions until its tool list is refreshed; this does not restore a removed server handler.

## Verification

406 automated tests, TypeScript checking and the Worker bundle build passed. Enabled discovery is 112; disabled test discovery is 100; production remains 51 read-only tools. The deployed status returns contract version 3, 46 development tools and zero reserved entries. Live calls to both removed names return `Tool not found`. No native accounting data was changed.
