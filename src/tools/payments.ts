import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { DEFAULT_PAGE_SIZE, compactResponse, errorResult, jsonResult, pagingShape, verbosityShape } from './helpers.js';
import { confirmWrite, writeMode } from '../write-guard.js';

const PAYMENT_FIELDS = {
  bankPayments: ['id', 'entryDate', 'cashAmount', 'cashSide', 'cashAccountId', 'contactId', 'isVoided'],
  balanceModifiers: ['id', 'amount', 'entryDate', 'subjectReference', 'modifierReference']
};

export function registerPaymentTools(server: McpServer, billy: BillyClient): void {
  if (writeMode !== 'read-only') {
    server.registerTool(
      'create_bank_payment',
      {
        description:
          "Record a bank payment in Billy to mark an invoice or bill as (partially) paid. Creates a bankPayment associated with the subject via 'invoice:<id>' or 'bill:<id>'. For invoices money is deposited (debit); for bills it is withdrawn (credit). WARNING: this posts a real accounting transaction.",
        inputSchema: z.object({
          subjectType: z.enum(['invoice', 'bill']).describe('What is being paid'),
          subjectId: z.string().describe('ID of the invoice or bill being paid'),
          entryDate: z.string().describe('Payment date (YYYY-MM-DD)'),
          cashAmount: z.number().describe("Amount deposited/withdrawn in the cash account's currency"),
          cashAccountId: z.string().describe('Bank account ID (must have isPaymentEnabled=true; see list_accounts)'),
          cashExchangeRate: z.number().optional().describe("Exchange rate: 1 subjectCurrency = cashExchangeRate cashAccountCurrency. Required when the cash account's currency differs from the invoice/bill currency."),
          cashSide: z
            .enum(['debit', 'credit'])
            .optional()
            .describe("Override side: 'debit'=deposit (invoices), 'credit'=withdrawal (bills). Defaults based on subjectType."),
          feeAmount: z.number().optional().describe('Bank/provider fee (positive, recorded as expense)'),
          feeAccountId: z.string().optional().describe('Expense account for the fee (required when feeAmount set)'),
          organizationId: z.string().optional().describe('Organization ID (auto-resolved when omitted)'),
          ...verbosityShape
        }),
        annotations: { readOnlyHint: false, destructiveHint: true }
      },
      async ({ subjectType, subjectId, entryDate, cashAmount, cashAccountId, cashExchangeRate, cashSide, feeAmount, feeAccountId, organizationId, verbose }, ctx) => {
        try {
          const orgId = organizationId ?? (await billy.getOrganizationId());
          const bankPayment = {
            organizationId: orgId,
            entryDate,
            cashAmount,
            cashSide: cashSide ?? (subjectType === 'invoice' ? 'debit' : 'credit'),
            cashAccountId,
            cashExchangeRate,
            feeAmount,
            feeAccountId,
            associations: [{ subjectReference: `${subjectType}:${subjectId}` }]
          };
          const gate = await confirmWrite(ctx, {
            operation: `Record bank payment of ${cashAmount} for ${subjectType} ${subjectId}`,
            details: { bankPayment }
          });
          if (!gate.ok) return gate.result;
          const data = await billy.post('/bankPayments', { bankPayment });
          return jsonResult(verbose ? data : compactResponse(data, PAYMENT_FIELDS));
        } catch (e) {
          return errorResult(e);
        }
      }
    );
  }

  server.registerTool(
    'list_bank_payments',
    {
      description:
        'List bank payments recorded in Billy. Useful to review what payments exist for reconciliation. NOTE: Billy only supports organizationId server-side for this endpoint; contactId/cashAccountId/date filters are applied client-side within the fetched page.',
      inputSchema: z.object({
        contactId: z.string().optional().describe('Filter by contact ID (applied client-side within the fetched page)'),
        cashAccountId: z.string().optional().describe('Filter by bank account ID (applied client-side within the fetched page)'),
        minEntryDate: z.string().optional().describe('Payment date >= this (YYYY-MM-DD; applied client-side within the fetched page)'),
        maxEntryDate: z.string().optional().describe('Payment date <= this (YYYY-MM-DD; applied client-side within the fetched page)'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ contactId, cashAccountId, minEntryDate, maxEntryDate, page, pageSize, verbose }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const data = await billy.get('/bankPayments', { organizationId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        const clientSide: string[] = [];
        if (contactId !== undefined) clientSide.push('contactId');
        if (cashAccountId !== undefined) clientSide.push('cashAccountId');
        if (minEntryDate !== undefined) clientSide.push('minEntryDate');
        if (maxEntryDate !== undefined) clientSide.push('maxEntryDate');
        const filtered = (data?.bankPayments ?? []).filter(
          (p: any) =>
            (contactId === undefined || p.contactId === contactId) &&
            (cashAccountId === undefined || p.cashAccountId === cashAccountId) &&
            (minEntryDate === undefined || p.entryDate >= minEntryDate) &&
            (maxEntryDate === undefined || p.entryDate <= maxEntryDate)
        );
        const base: any = verbose
          ? { ...data, bankPayments: filtered }
          : compactResponse({ ...data, bankPayments: filtered }, PAYMENT_FIELDS);
        base.appliedFilters = {
          serverSide: ['organizationId'],
          clientSide,
          note: 'client-side filters apply within the fetched page only'
        };
        return jsonResult(base);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_balance_modifiers',
    {
      description:
        "List balance modifiers (payment associations) in Billy for a required subjectReference like 'invoice:<id>' or 'bill:<id>'. Unfiltered listing is not supported. NOTE: subjectReference is not documented server-side; it is also enforced client-side within the fetched page.",
      inputSchema: z.object({
        subjectReference: z
          .string()
          .trim()
          .min(1)
          .describe("Required subject reference, e.g. 'invoice:abc123' or 'bill:xyz789' (also applied client-side within the fetched page)"),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ subjectReference, page, pageSize, verbose }) => {
      try {
        const data = await billy.get('/balanceModifiers', { subjectReference, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        const filtered = (data?.balanceModifiers ?? []).filter(
          (m: any) => subjectReference === undefined || m.subjectReference === subjectReference
        );
        const base: any = verbose
          ? { ...data, balanceModifiers: filtered }
          : compactResponse({ ...data, balanceModifiers: filtered }, PAYMENT_FIELDS);
        base.appliedFilters = {
          serverSide: ['subjectReference (sent, but undocumented — may be ignored)'],
          clientSide: subjectReference !== undefined ? ['subjectReference'] : [],
          note: 'client-side filters apply within the fetched page only'
        };
        return jsonResult(base);
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
