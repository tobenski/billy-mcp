import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { DEFAULT_PAGE_SIZE, compactResponse, errorResult, jsonResult, pagingShape, verbosityShape } from './helpers.js';
import { confirmWrite, writeMode } from '../write-guard.js';

const BILL_FIELDS = {
  bills: ['id', 'voucherNo', 'suppliersInvoiceNo', 'state', 'contactId', 'entryDate', 'dueDate', 'amount', 'tax', 'balance', 'isPaid', 'currencyId'],
  billLines: ['id', 'billId', 'accountId', 'description', 'amount', 'taxRateId']
};

export function registerBillTools(server: McpServer, billy: BillyClient): void {
  server.registerTool(
    'list_bills',
    {
      description:
        'List supplier bills (expenses) in Billy with filters for supplier, state, paid status, date range and free-text search.',
      inputSchema: z.object({
        contactId: z.string().optional().describe('Filter by supplier contact ID'),
        state: z.enum(['draft', 'approved', 'voided']).optional().describe('Filter by bill state'),
        isPaid: z.boolean().optional().describe('Filter by paid status'),
        creditedBillId: z.string().trim().min(1).optional().describe('Credit notes for this bill ID'),
        currencyId: z.string().trim().min(1).optional().describe('Filter by bill currency ID'),
        hasAttachments: z.boolean().optional().describe('Billy filter for bills with or without attachment links'),
        suppliersInvoiceNo: z.string().optional().describe("Filter by the supplier's invoice number"),
        minEntryDate: z.string().optional().describe('Bill date >= this (YYYY-MM-DD)'),
        maxEntryDate: z.string().optional().describe('Bill date <= this (YYYY-MM-DD)'),
        minDueDate: z.string().optional().describe('Due date >= this (YYYY-MM-DD)'),
        maxDueDate: z.string().optional().describe('Due date <= this (YYYY-MM-DD)'),
        q: z.string().optional().describe('Free-text search (contact name, description, voucher no, amount)'),
        sortProperty: z
          .string()
          .optional()
          .describe("Sort field: entryDate, dueDate, createdTime, amount, balance, contact.name, voucherNo"),
        sortDirection: z.enum(['ASC', 'DESC']).optional().describe('Sort direction'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ page, pageSize, verbose, ...filters }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const data = await billy.get('/bills', { organizationId, ...filters, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        const base: any = verbose ? data : compactResponse(data, BILL_FIELDS);
        base.appliedFilters = {
          serverSide: ['organizationId', ...Object.keys(filters).filter((k) => (filters as any)[k] !== undefined)]
        };
        return jsonResult(base);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'get_bill',
    {
      description: 'Read one Billy bill and one page of its native lines. Preserves all fields and separate line pagination; use list_bill_lines for further pages. Balances are Billy source values, not calculated here.',
      inputSchema: z.object({
        id: z.string().trim().min(1).refine(id => id !== '.' && id !== '..' && !/[\\/?#\s]/.test(id), 'Provide one bill ID').describe('Bill ID'),
        linePage: z.number().int().min(1).optional(),
        linePageSize: z.number().int().min(1).max(1000).optional()
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, linePage, linePageSize }) => {
      try {
        const [bill, lines] = await Promise.all([
          billy.get(`/bills/${encodeURIComponent(id)}`),
          billy.get('/billLines', { billId: id, page: linePage ?? 1, pageSize: linePageSize ?? DEFAULT_PAGE_SIZE })
        ]);
        if (bill?.bill?.id !== id || !Array.isArray(lines?.billLines) ||
            lines.billLines.some((line: any) => !line || line.billId !== id)) {
          throw new Error('Billy returned an invalid bill or lines outside the requested bill.');
        }
        return jsonResult({ ...bill, billLines: lines.billLines, billLinesMeta: lines.meta ?? null });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  if (writeMode !== 'read-only') {
    server.registerTool(
      'create_bill',
      {
        description:
          'Create a supplier bill (expense) in Billy with one or more lines coded to expense accounts. Created as draft by default; pass state=approved to book it immediately.',
        inputSchema: z.object({
          contactId: z.string().describe('Supplier contact ID (see list_contacts)'),
          entryDate: z.string().describe('Bill date (YYYY-MM-DD)'),
          currencyId: z.string().optional().describe("Bill currency, e.g. 'DKK' (defaults to org base currency)"),
          state: z.enum(['draft', 'approved']).optional().describe("Bill state (default 'draft')"),
          dueDate: z.string().optional().describe('Payment due date (YYYY-MM-DD)'),
          suppliersInvoiceNo: z.string().optional().describe("The supplier's invoice number"),
          voucherNo: z.string().optional().describe('Voucher number for the bill'),
          taxMode: z.enum(['incl', 'excl']).optional().describe('Whether amounts include or exclude VAT (defaults to org setting)'),
          lines: z
            .array(
              z.object({
                accountId: z.string().describe('Expense account ID to code the cost to (see list_accounts)'),
                amount: z.number().describe('Line amount in the bill currency'),
                description: z.string().describe('What the expense is for'),
                taxRateId: z.string().optional().describe('Tax rate ID for the line (when omitted, Billy typically defaults from the account settings)')
              })
            )
            .min(1)
            .describe('Bill lines (at least one)'),
          ...verbosityShape
        }),
        annotations: { readOnlyHint: false, destructiveHint: false }
      },
      async ({ lines, verbose, ...fields }, ctx) => {
        try {
          const organizationId = await billy.getOrganizationId();
          const bill = { organizationId, ...fields, lines };
          const gate = await confirmWrite(ctx, {
            operation: `Create bill for contact ${fields.contactId}, ${lines.length} line(s), state ${fields.state ?? 'draft'}`,
            details: { bill }
          });
          if (!gate.ok) return gate.result;
          const data = await billy.post('/bills', { bill });
          return jsonResult(verbose ? data : compactResponse(data, BILL_FIELDS));
        } catch (e) {
          return errorResult(e);
        }
      }
    );
  }
}
