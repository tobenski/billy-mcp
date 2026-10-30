# Reserverede Billy-værktøjer, kontrakt v1

8 stubs, 13 implementerede fase 1-værktøjer og ét statusværktøj er tilføjet testserveren. Med kladdeskrivning aktiveret er der 83 værktøjer. Produktionsserveren er uændret.

Alle stubs returnerer isError=true og NOT_IMPLEMENTED uden API-kald, journalreservation eller regnskabsændring. Skriveværktøjer er markeret som skrivende efter deres tilsigtede funktion, selv om stubs ikke skriver. Ingen status skifter automatisk til aktiv.

Billy API-understøttelse er endnu ikke verificeret for de reserverede kontrakter. En mapping betyder planlagt funktionsdækning, ikke identiske fortegn, filtre, momsregler eller bankstatusser. Rapporter skal hentes fra Billy; analyse og beregninger hører til i chatten.

Nye kontrakter bruger Billy-ID, positive beløb med debit/credit og eksplicit momsgrundlag. Alle skrivninger kræver operationId og reasoning. expectedRevision er et reserveret token fra en frisk læsning; implementering skal levere og verificere det. Nuværende læseværktøjer leverer ikke nødvendigvis dette token endnu. Ukendte felter afvises.

Implementér ét værktøj ad gangen og bevar navn/input når muligt. Opdatér status og beskrivelse ved aktivering; ændrede skemaer eller beskrivelser kan fortsat kræve opdatering af forbindelsen.

## Minimumsdækning af Numina

| Numina | Billy-værktøjer |
|---|---|
| get_company_info | get_test_organization |
| list_accounts | list_accounts |
| list_vat_codes | list_tax_rates, list_sales_tax_rules |
| get_account_balances | get_test_account_balances |
| get_trial_balance | get_test_trial_balance |
| get_bank_balances | get_test_bank_balances |
| get_bank_transaction | get_test_bank_line |
| search_bank_transactions | list_bank_lines |
| get_contact | get_contact |
| search_contacts | list_contacts |
| create_contact | create_test_contact |
| update_contact | update_test_contact |
| get_invoice | get_invoice |
| list_invoices | list_invoices |
| get_transaction | get_transaction, get_daybook_transaction, list_postings, list_daybook_transaction_lines |
| search_ledger_entries | list_postings, list_daybook_transactions |
| get_document | get_test_document |
| search_documents | search_test_documents |
| create_upload_link | create_test_upload_link |
| set_document_ocr | set_test_document_facts |
| create_draft | create_test_extended_draft |
| update_draft | update_test_extended_draft |
| delete_draft | delete_test_daybook_draft |
| propose_booked_change | propose_test_booked_change |
| reconcile_bank_transaction | reconcile_test_bank_line |
| unlink_bank_transaction | unlink_test_bank_line |
| resolve_review | resolve_test_review |

Eksisterende kladdesletning er begrænset til testværktøjernes egne kladder. Moms- og søgefunktioner følger Billys eksisterende semantik. Udvidede kladder er reserveret særskilt, så nuværende kladdekontrakter bevares.

## Bilagsværktøjer

get_test_document og search_test_documents er implementeret som native læsninger. Søgning bruger Billys dokumentfelter; invoiceNumber afvises, og currencyId filtreres kun på den aktuelle side. Se [bilagssøgning og live-test](document-search.md).

## Bankværktøjer

get_test_bank_line, reconcile_test_bank_line og unlink_test_bank_line er implementeret med status implemented_phase1. Tilknytning og fjernelse er live-verificeret på den importerede testbanklinje; replay, stale revision og bevaring af banklinje/kladde/PDF er kontrolleret. Fase 1 tillader kun én banklinje i eksisterende ikke-godkendt match og én DKK-testkladde. Se [bankforløb og nødvendig testlinje](bank-links.md).

## Bogføring og endelig afstemning

book_test_daybook_draft og approve_test_bank_match er implementeret for testoprettede DKK-poster uden moms. En særskilt testpost er bogført og bankafstemt. Billys overgang fra kladde- til posting-tilknytning er håndteret, og journalen er afklaret efter readback. Se [forløb, tests og begrænsninger](finalization.md). Tilbageførsel er endnu ikke implementeret.

## Kontrakter

create_test_extended_draft og update_test_extended_draft er nu implementeret for DKK uden moms eller valgfrie tilknytninger. get_daybook_transaction returnerer revision i testskrivemodus. Se [fase 1 og live-test](extended-drafts.md). Inputskemaerne nedenfor er bevaret; ikke-understøttede felter afvises.


### get_test_account_balances

Read native account movement/opening/closing report values; no MCP aggregation.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "from": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "to": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "granularity": {
      "type": "string",
      "enum": [
        "month",
        "quarter",
        "year"
      ]
    },
    "statement": {
      "type": "string",
      "enum": [
        "profit_loss",
        "balance_sheet"
      ]
    },
    "includeEmptyAccounts": {
      "type": "boolean"
    }
  },
  "required": [
    "from",
    "to"
  ],
  "additionalProperties": false
}
```

### get_test_trial_balance

Read native trial balance as of a date, excluding drafts.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "asOf": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    }
  },
  "required": [
    "asOf"
  ],
  "additionalProperties": false
}
```

### get_test_bank_balances

Read stored bank balances, currency and synchronization timestamps; never imply real-time funds.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "additionalProperties": false
}
```

### get_test_bank_line

Read a bank line and native reconciliation links.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

### get_test_document

Read attachment details and available stored document facts; optional file metadata.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "attachmentId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "includeFiles": {
      "type": "boolean"
    }
  },
  "required": [
    "attachmentId"
  ],
  "additionalProperties": false
}
```

### search_test_documents

Search documents using explicit source-supported filters; no heuristic ranking.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "vendor": {
      "type": "string"
    },
    "invoiceNumber": {
      "type": "string"
    },
    "fromDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "toDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "amount": {
      "type": "number"
    },
    "currencyId": {
      "type": "string",
      "pattern": "^[A-Z]{3}$"
    },
    "status": {
      "type": "string",
      "enum": [
        "all",
        "unhandled",
        "handled"
      ]
    },
    "page": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "pageSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000
    }
  },
  "additionalProperties": false
}
```

### create_test_upload_link

Reserve a direct document upload link; upload limits and URL expiry must be reported by implementation.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "fileName": {
      "type": "string",
      "minLength": 1
    },
    "contentType": {
      "type": "string",
      "enum": [
        "application/pdf",
        "image/png",
        "image/jpeg"
      ]
    },
    "sizeBytes": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "daybookTransactionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "fileName",
    "contentType",
    "sizeBytes"
  ],
  "additionalProperties": false
}
```

### create_test_contact

Create a customer/supplier after duplicate checks.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "roles": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "customer",
          "supplier"
        ]
      }
    },
    "countryCode": {
      "type": "string",
      "minLength": 2,
      "maxLength": 2
    },
    "cvr": {
      "type": "string"
    },
    "vatNumber": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "street": {
      "type": "string"
    },
    "zip": {
      "type": "string"
    },
    "city": {
      "type": "string"
    },
    "domainName": {
      "type": "string"
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "name",
    "roles"
  ],
  "additionalProperties": false
}
```

### update_test_contact

Change only supplied contact fields; null clears optional fields.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "roles": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "customer",
          "supplier"
        ]
      }
    },
    "countryCode": {
      "type": "string",
      "minLength": 2,
      "maxLength": 2
    },
    "cvr": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "vatNumber": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "email": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "street": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "zip": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "city": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "domainName": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "id"
  ],
  "additionalProperties": false
}
```

### create_test_extended_draft

Create a draft with tax, currency and optional document/contact/invoice/bank links. Null account marks unfinished input only if supported.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "entryDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "daybookId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "description": {
      "type": "string",
      "minLength": 1
    },
    "voucherNo": {
      "type": "string"
    },
    "lines": {
      "minItems": 2,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "accountId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "amount": {
            "type": "number",
            "exclusiveMinimum": 0
          },
          "side": {
            "type": "string",
            "enum": [
              "debit",
              "credit"
            ]
          },
          "text": {
            "type": "string"
          },
          "currencyId": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "baseAmount": {
            "type": "number",
            "minimum": 0
          },
          "taxRateId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "amountBasis": {
            "type": "string",
            "enum": [
              "gross",
              "net"
            ]
          }
        },
        "required": [
          "accountId",
          "amount",
          "side",
          "text"
        ],
        "additionalProperties": false
      }
    },
    "currencyId": {
      "type": "string",
      "pattern": "^[A-Z]{3}$"
    },
    "attachmentIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      }
    },
    "contactId": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        {
          "type": "null"
        }
      ]
    },
    "invoiceId": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        {
          "type": "null"
        }
      ]
    },
    "bankLineId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "entryDate",
    "daybookId",
    "description",
    "lines"
  ],
  "additionalProperties": false
}
```

### update_test_extended_draft

Replace full draft lines or change supplied fields; never edit booked transactions.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "entryDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "description": {
      "type": "string"
    },
    "voucherNo": {
      "type": "string"
    },
    "lines": {
      "minItems": 2,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "accountId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "amount": {
            "type": "number",
            "exclusiveMinimum": 0
          },
          "side": {
            "type": "string",
            "enum": [
              "debit",
              "credit"
            ]
          },
          "text": {
            "type": "string"
          },
          "currencyId": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "baseAmount": {
            "type": "number",
            "minimum": 0
          },
          "taxRateId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "amountBasis": {
            "type": "string",
            "enum": [
              "gross",
              "net"
            ]
          }
        },
        "required": [
          "accountId",
          "amount",
          "side",
          "text"
        ],
        "additionalProperties": false
      }
    },
    "currencyId": {
      "type": "string",
      "pattern": "^[A-Z]{3}$"
    },
    "attachmentIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      }
    },
    "contactId": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        {
          "type": "null"
        }
      ]
    },
    "invoiceId": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        {
          "type": "null"
        }
      ]
    },
    "reviewNote": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "id"
  ],
  "additionalProperties": false
}
```

### propose_test_booked_change

Stage an explicit full replacement for human review; never silently change booked entries.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "transactionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "entryDate": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
    },
    "description": {
      "type": "string"
    },
    "lines": {
      "minItems": 2,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "accountId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "amount": {
            "type": "number",
            "exclusiveMinimum": 0
          },
          "side": {
            "type": "string",
            "enum": [
              "debit",
              "credit"
            ]
          },
          "text": {
            "type": "string"
          },
          "currencyId": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "baseAmount": {
            "type": "number",
            "minimum": 0
          },
          "taxRateId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              {
                "type": "null"
              }
            ]
          },
          "amountBasis": {
            "type": "string",
            "enum": [
              "gross",
              "net"
            ]
          }
        },
        "required": [
          "accountId",
          "amount",
          "side",
          "text"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "transactionId",
    "entryDate",
    "description",
    "lines"
  ],
  "additionalProperties": false
}
```

### reconcile_test_bank_line

Link one bank line to explicit draft or booked subjects; no automatic matching.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "bankLineId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "subjects": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "daybookTransaction",
              "transaction",
              "invoice",
              "bill"
            ]
          },
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "amount": {
            "type": "number",
            "exclusiveMinimum": 0
          }
        },
        "required": [
          "type",
          "id"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "bankLineId",
    "subjects"
  ],
  "additionalProperties": false
}
```

### unlink_test_bank_line

Remove exactly one bank reconciliation association, retaining other links.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "bankLineId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "matchId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "subjectReference": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "bankLineId",
    "matchId",
    "subjectReference"
  ],
  "additionalProperties": false
}
```

### set_test_document_facts

Store document facts explicitly supplied by the chat; does not perform OCR or accounting analysis.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "attachmentId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "documentType": {
      "type": "string",
      "enum": [
        "invoice",
        "credit_note",
        "receipt",
        "card_receipt",
        "order_confirmation",
        "missing",
        "other"
      ]
    },
    "date": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "dueDate": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "currencyId": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^[A-Z]{3}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "vendorName": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "vendorVatNumber": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "vendorAddress": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "customerName": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "invoiceNumber": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "totalAmount": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "totalVatAmount": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "amountDue": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "summary": {
      "type": "string"
    },
    "lineItems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": {
            "type": "string"
          },
          "amount": {
            "type": "number"
          },
          "vatAmount": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "description",
          "amount"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "attachmentId",
    "documentType",
    "date",
    "currencyId",
    "vendorName",
    "totalAmount",
    "summary"
  ],
  "additionalProperties": false
}
```

### resolve_test_review

Close a specific review after its issue has been resolved.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "subjectType": {
      "type": "string",
      "enum": [
        "transaction",
        "attachment"
      ]
    },
    "subjectId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "reviewId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "subjectType",
    "subjectId",
    "reviewId"
  ],
  "additionalProperties": false
}
```

### book_test_daybook_draft

Explicitly book one reviewed draft; separate from creation and editing.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "daybookTransactionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "expectedDescription": {
      "type": "string"
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "daybookTransactionId",
    "expectedDescription"
  ],
  "additionalProperties": false
}
```

### approve_test_bank_match

Explicitly approve one existing reconciliation match.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "expectedRevision": {
      "type": "string",
      "minLength": 1,
      "description": "Opaque revision obtained from a fresh read; implementation must check it before mutation."
    },
    "matchId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "expectedRevision",
    "matchId"
  ],
  "additionalProperties": false
}
```

### rename_test_account

Rename an account after verifying the current name.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "expectedName": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "id",
    "expectedName",
    "name"
  ],
  "additionalProperties": false
}
```

### rename_test_account_group

Rename a heading/subtotal account group after verifying current name.

Status: reserved; API: unverified.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reasoning": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4000
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "expectedName": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "operationId",
    "reasoning",
    "id",
    "expectedName",
    "name"
  ],
  "additionalProperties": false
}
```
