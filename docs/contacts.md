# Current foreign-contact extension — 2026-10-31

Create/update now support foreign countries verified through Billy's native country record. Country changes on an existing contact are refused. DK CVR remains eight digits; foreign vatNumber is stored as registrationNo with syntax checking only, without registry/VIES verification. Native foreign contact creation, update and clearing the registration number were live-tested. No messages are sent. See [completion report](autonomous-completion.md).

Earlier DK-only phase documentation follows for historical context.

---

# Test contacts, phase 1

`create_test_contact` and `update_test_contact` now use the existing reserved schemas. No new tool registration is required. Only the isolated write-enabled test worker activates these handlers. Production remains unchanged.

Creation makes a Danish company contact (`type: company`, country DK), marked with an operation-specific `contactNo`. Roles map to Billy isCustomer/isSupplier; the supplied roles replace both flags on update. Name and address map to native fields. CVR and vatNumber share registrationNo: eight digits, optional DK prefix, whitespace/hyphens normalized. Conflicting values are refused. This validates format, not existence in the CVR registry. Other countries and domainName are explicitly refused in phase 1.

Updating requires the revision from a fresh `get_contact`, which now includes all contact persons in test-write mode. Only active test-marked DK contacts can be updated. Omitted fields are preserved; null clears optional address, registration and email fields. Billy returned empty strings after null clearing in the live test, which the verifier accepts. All unrelated native contact fields are compared after the write.

An email supplied at creation creates a named primary contact person. Updating email uses a separate contact-person endpoint, never replacement of the whole contactPersons collection. One primary person is selected; if none is primary, a sole person can be selected. Ambiguous choices are refused. Clearing email retains the person and requires its name to remain set. Adding email to a contact without persons creates one named primary person. Unrelated persons and their fields are verified unchanged. No email, invoice or payment is sent or created.

Duplicate checks inspect all contacts (including archived ones) up to a fail-closed 1,000-record cap. Checks cover normalized name plus country, normalized registration plus country, and supplied email across contact persons. Suspected duplicates are refused rather than automatically merged. Contact mutations share an organization-scoped journal lock so simultaneous tool calls cannot bypass duplicate checks. External Billy edits remain subject to optimistic revision checks, not an atomic lock.

Reusing an operation UUID and identical input returns its saved result. Partial or uncertain writes remain pending and block further contact mutations until inspected. The journal retains stage, known contact ID and bounded upstream error details for recovery. No automatic rollback or retry with a fresh UUID is performed.

## Verification — 2026-10-30

TypeScript, worker build and 156 automated tests passed. New tests cover create/update mapping and replay, primary versus secondary person preservation, explicit clearing, registration conflicts, duplicate checks, stale revisions including person changes, foreign ownership, unsupported inputs, ambiguous recipients, uncertain creation, partial email failure and unexpected readback changes.

Live test created one TEST-KONTAKT-01 contact as customer and supplier, with synthetic address and an example.invalid email. Creation replay did not duplicate it. Both normalized-name and email duplicate attempts were refused. Updated name, roles, street and email; verified native fields and replay. Stale revision was refused. Cleared street, city, zip and email while preserving the contact-person ID. Read the revision through get_contact, then restored the original synthetic name, both roles, address and email. domainName was refused before mutation. Exactly one test contact and one person were created; no accounting entries or messages were generated.

Native API reference: https://www.billy.dk/api/ (contacts and contactPersons; only supplied fields are updated; replacing contactPersons would delete existing persons, hence separate updates).
