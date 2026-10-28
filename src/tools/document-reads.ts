import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { DEFAULT_PAGE_SIZE, errorResult, jsonResult, pagingShape } from './helpers.js';

type RecordData = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined>;
type ExpectedField = { field: string; value: string; required?: boolean };

const parentId = (description: string) => z.string().trim().min(1).max(512).describe(description);

function isRecord(value: unknown): value is RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One native API page, unchanged. Validation must never turn a rejected filter into an empty list. */
async function readPage(
  billy: BillyClient,
  path: string,
  resource: string,
  query: Query,
  expected: ExpectedField[] = []
) {
  try {
    const data = await billy.get<unknown>(path, query);
    if (!isRecord(data) || !Array.isArray(data[resource])) {
      throw new Error(`Billy did not return a valid ${resource} array.`);
    }
    const rows = data[resource];
    for (const row of rows) {
      if (!isRecord(row)) throw new Error(`Billy returned an invalid ${resource} record.`);
      for (const check of expected) {
        if ((check.required || Object.hasOwn(row, check.field)) && row[check.field] !== check.value) {
          throw new Error(`Billy returned ${resource} outside the requested ${check.field} filter.`);
        }
      }
    }
    return jsonResult(data);
  } catch (error) {
    return errorResult(error);
  }
}

/** Native document data only: no aggregation, classifications, downloads or writes. */
export function registerDocumentReadTools(server: McpServer, billy: BillyClient): void {
  server.registerTool('list_invoice_lines', {
    description: 'Read one page of lines for a required invoice ID. Returns the full Billy response, including every line field and original pagination. Follow the pagination for additional lines.',
    inputSchema: z.object({ invoiceId: parentId('Invoice ID whose lines are requested'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ invoiceId, page, pageSize }) => readPage(
    billy, '/invoiceLines', 'invoiceLines', { invoiceId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
    [{ field: 'invoiceId', value: invoiceId, required: true }]
  ));

  server.registerTool('list_bill_lines', {
    description: 'Read one page of lines for a required supplier bill ID. Returns the full Billy response, including tax and account fields and original pagination.',
    inputSchema: z.object({ billId: parentId('Supplier bill ID whose lines are requested'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ billId, page, pageSize }) => readPage(
    billy, '/billLines', 'billLines', { billId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
    [{ field: 'billId', value: billId, required: true }]
  ));

  server.registerTool('list_contact_balance_postings', {
    description: 'Read one page of balance postings for a required contact ID. Returns all original fields, including currency, side, originator and void status when supplied, plus Billy pagination. Does not calculate a contact balance.',
    inputSchema: z.object({ contactId: parentId('Contact ID required by Billy for balance postings'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ contactId, page, pageSize }) => readPage(
    billy, '/contactBalancePostings', 'contactBalancePostings', { contactId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
    [{ field: 'contactId', value: contactId, required: true }]
  ));

  server.registerTool('list_contact_balance_payments', {
    description: 'Read one page of contact-balance payments for a required contact ID within the connected organization. Preserves all original fields and pagination. These records describe use of contact balances; no netting or aging is calculated.',
    inputSchema: z.object({ contactId: parentId('Contact ID whose balance payments are requested'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ contactId, page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      return readPage(
        billy, '/contactBalancePayments', 'contactBalancePayments',
        { organizationId, contactId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
        [{ field: 'contactId', value: contactId, required: true }, { field: 'organizationId', value: organizationId }]
      );
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_invoice_late_fees', {
    description: 'Read one page of late-fee records for a required invoice ID. Returns the original fee, date, amount, void-status fields and pagination without calculating or creating fees.',
    inputSchema: z.object({ invoiceId: parentId('Invoice ID whose late fees are requested'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ invoiceId, page, pageSize }) => readPage(
    billy, '/invoiceLateFees', 'invoiceLateFees', { invoiceId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
    [{ field: 'invoiceId', value: invoiceId, required: true }]
  ));

  server.registerTool('list_invoice_reminders', {
    description: 'Read one page of existing invoice reminders from the connected organization. Returns every original field and Billy pagination. Does not send reminders, calculate fees or fetch download URLs.',
    inputSchema: z.object({ ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      return readPage(
        billy, '/invoiceReminders', 'invoiceReminders', { organizationId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
        [{ field: 'organizationId', value: organizationId, required: true }]
      );
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_invoice_reminder_associations', {
    description: 'Read one page of invoice/late-fee associations for a required reminder ID. Billy requires reminderId for this endpoint. Returns the full response and original pagination.',
    inputSchema: z.object({ reminderId: parentId('Reminder ID from list_invoice_reminders'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ reminderId, page, pageSize }) => readPage(
    billy, '/invoiceReminderAssociations', 'invoiceReminderAssociations',
    { reminderId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
    [{ field: 'reminderId', value: reminderId, required: true }]
  ));

  server.registerTool('list_invoice_logs', {
    description: 'Read one page of event logs for a required invoice ID in the connected organization, newest event first. Returns full event records and original pagination. An event is source data, not a conclusion about payment or delivery.',
    inputSchema: z.object({ invoiceId: parentId('Invoice ID whose event logs are requested'), ...pagingShape }),
    annotations: { readOnlyHint: true }
  }, async ({ invoiceId, page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      return readPage(
        billy, '/invoiceLogs', 'invoiceLogs',
        { organizationId, invoiceId, sortProperty: 'eventTime', sortDirection: 'DESC', page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
        // Billy's documented event shape can omit parent IDs; validate them whenever supplied.
        [{ field: 'invoiceId', value: invoiceId }, { field: 'organizationId', value: organizationId }]
      );
    } catch (error) {
      return errorResult(error);
    }
  });
}
