import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { DEFAULT_PAGE_SIZE, compactResponse, errorResult, jsonResult, pagingShape, verbosityShape } from './helpers.js';
import { confirmWrite, writeMode } from '../write-guard.js';

const INVOICE_FIELDS = {
  invoices: ['id', 'invoiceNo', 'type', 'state', 'contactId', 'entryDate', 'dueDate', 'amount', 'tax', 'balance', 'isPaid', 'currencyId', 'sentState'],
  invoiceLines: ['id', 'invoiceId', 'productId', 'description', 'quantity', 'unitPrice', 'amount']
};

export function registerInvoiceTools(server: McpServer, billy: BillyClient): void {
  server.registerTool(
    'list_invoices',
    {
      description:
        'List invoices in Billy with filters for customer, state, date range and free-text search. Returns invoices plus meta.paging.',
      inputSchema: z.object({
        contactId: z.string().optional().describe('Filter by customer contact ID'),
        state: z.enum(['draft', 'approved', 'voided']).optional().describe('Filter by invoice state'),
        invoiceNo: z.string().optional().describe('Filter by exact invoice number'),
        isPaid: z.boolean().optional().describe('Filter by paid status'),
        creditedInvoiceId: z.string().trim().min(1).optional().describe('Credit notes for this invoice ID'),
        currencyId: z.string().trim().min(1).optional().describe('Filter by invoice currency ID'),
        minEntryDate: z.string().optional().describe('Invoice date >= this (YYYY-MM-DD)'),
        maxEntryDate: z.string().optional().describe('Invoice date <= this (YYYY-MM-DD)'),
        minDueDate: z.string().optional().describe('Due date >= this (YYYY-MM-DD)'),
        maxDueDate: z.string().optional().describe('Due date <= this (YYYY-MM-DD)'),
        entryDatePeriod: z.string().trim().min(1).optional().describe('Billy date period, for example month:2026-01'),
        approvedTimePeriod: z.string().trim().min(1).optional().describe('Billy approval-time period'),
        recurringInvoiceId: z.string().trim().min(1).optional().describe('Filter by recurring invoice ID'),
        quoteId: z.string().trim().min(1).optional().describe('Filter by quote ID'),
        q: z.string().optional().describe('Free-text search'),
        sortProperty: z.string().optional().describe("Sort field, e.g. 'entryDate', 'createdTime'"),
        sortDirection: z.enum(['ASC', 'DESC']).optional().describe('Sort direction'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ page, pageSize, verbose, ...filters }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const data = await billy.get('/invoices', { organizationId, ...filters, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        const base: any = verbose ? data : compactResponse(data, INVOICE_FIELDS);
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
    'get_invoice',
    {
      description: 'Read one Billy invoice and one page of its native lines. Preserves all fields and separate line pagination; use list_invoice_lines for further pages. Balances are Billy source values, not calculated here.',
      inputSchema: z.object({
        id: z.string().trim().min(1).refine(id => id !== '.' && id !== '..' && !/[\\/?#\s]/.test(id), 'Provide one invoice ID').describe('Invoice ID'),
        linePage: z.number().int().min(1).optional(),
        linePageSize: z.number().int().min(1).max(1000).optional()
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, linePage, linePageSize }) => {
      try {
        const [invoice, lines] = await Promise.all([
          billy.get(`/invoices/${encodeURIComponent(id)}`),
          billy.get('/invoiceLines', { invoiceId: id, page: linePage ?? 1, pageSize: linePageSize ?? DEFAULT_PAGE_SIZE })
        ]);
        if (invoice?.invoice?.id !== id || !Array.isArray(lines?.invoiceLines) ||
            lines.invoiceLines.some((line: any) => !line || line.invoiceId !== id)) {
          throw new Error('Billy returned an invalid invoice or lines outside the requested invoice.');
        }
        return jsonResult({ ...invoice, invoiceLines: lines.invoiceLines, invoiceLinesMeta: lines.meta ?? null });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  if (writeMode !== 'read-only') {
    server.registerTool(
      'create_invoice',
      {
        description:
          'Create an invoice (or credit note) in Billy with one or more lines. Created as draft by default; pass state=approved to approve immediately (approval assigns the invoice number and books it). Amounts are in the invoice currency.',
        inputSchema: z.object({
          contactId: z.string().describe('Customer contact ID (see list_contacts)'),
          entryDate: z.string().describe('Invoice date (YYYY-MM-DD)'),
          currencyId: z.string().describe("Invoice currency, e.g. 'DKK', 'EUR', 'USD'"),
          state: z.enum(['draft', 'approved']).optional().describe("Invoice state (default 'draft')"),
          type: z.enum(['invoice', 'creditNote']).optional().describe("Document type (default 'invoice')"),
          paymentTermsMode: z.string().optional().describe("Payment terms mode, e.g. 'net'"),
          paymentTermsDays: z.number().int().optional().describe('Days for the payment terms (drives dueDate)'),
          taxMode: z.enum(['incl', 'excl']).optional().describe('Whether unit prices include or exclude VAT (defaults to org setting)'),
          invoiceNo: z.string().optional().describe('Manual invoice number (must be unique; auto-assigned when omitted)'),
          contactMessage: z.string().optional().describe('Message shown at the top of the invoice PDF'),
          lines: z
            .array(
              z.object({
                productId: z.string().describe('Product ID (see list_products)'),
                unitPrice: z.number().describe('Price per unit in the invoice currency'),
                quantity: z.number().optional().describe('Quantity (default 1)'),
                description: z.string().optional().describe('Line description shown under the product name'),
                discountMode: z.enum(['cash', 'percent']).optional().describe('Discount type'),
                discountValue: z.number().optional().describe('Discount amount or percentage (25 = 25%)')
              })
            )
            .min(1)
            .describe('Invoice lines (at least one)'),
          ...verbosityShape
        }),
        annotations: { readOnlyHint: false, destructiveHint: false }
      },
      async ({ lines, verbose, ...fields }, ctx) => {
        try {
          const organizationId = await billy.getOrganizationId();
          const invoice = { organizationId, ...fields, lines };
          const gate = await confirmWrite(ctx, {
            operation: `Create invoice for contact ${fields.contactId}, ${lines.length} line(s), currency ${fields.currencyId}, state ${fields.state ?? 'draft'}`,
            details: { invoice }
          });
          if (!gate.ok) return gate.result;
          const data = await billy.post('/invoices', { invoice });
          return jsonResult(verbose ? data : compactResponse(data, INVOICE_FIELDS));
        } catch (e) {
          return errorResult(e);
        }
      }
    );

    server.registerTool(
      'approve_invoice',
      {
        description:
          'Approve a draft Billy invoice (draft -> approved is the only allowed state change). Approval books the invoice; it cannot be reverted to draft.',
        inputSchema: z.object({
          id: z.string().describe('Invoice ID of a draft invoice'),
          ...verbosityShape
        }),
        annotations: { readOnlyHint: false, destructiveHint: true }
      },
      async ({ id, verbose }, ctx) => {
        try {
          const gate = await confirmWrite(ctx, {
            operation: `Approve invoice ${id} (irreversible)`,
            details: { invoice: { id, state: 'approved' } }
          });
          if (!gate.ok) return gate.result;
          const data = await billy.put(`/invoices/${id}`, { invoice: { state: 'approved' } });
          return jsonResult(verbose ? data : compactResponse(data, INVOICE_FIELDS));
        } catch (e) {
          return errorResult(e);
        }
      }
    );

    server.registerTool(
      'delete_invoice',
      {
        description: 'Delete a Billy invoice (drafts only; approved invoices must be voided/credited instead). Returns meta.deletedRecords.',
        inputSchema: z.object({
          id: z.string().describe('Invoice ID of a draft invoice'),
          ...verbosityShape
        }),
        annotations: { readOnlyHint: false, destructiveHint: true }
      },
      async ({ id, verbose }, ctx) => {
        try {
          const gate = await confirmWrite(ctx, {
            operation: `Delete invoice ${id}`,
            details: { invoiceId: id }
          });
          if (!gate.ok) return gate.result;
          const data = await billy.del(`/invoices/${id}`);
          return jsonResult(verbose ? data : compactResponse(data, INVOICE_FIELDS));
        } catch (e) {
          return errorResult(e);
        }
      }
    );
  }
}
