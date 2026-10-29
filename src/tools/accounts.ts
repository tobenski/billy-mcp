import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { compactResponse, DEFAULT_PAGE_SIZE, errorResult, jsonResult, pagingShape, verbosityShape } from './helpers.js';

const ACCOUNT_FIELDS = {
  accounts: ['id', 'accountNo', 'name', 'systemRole', 'isPaymentEnabled', 'isBankAccount', 'isArchived', 'currencyId', 'groupId']
};

export function registerAccountTools(server: McpServer, billy: BillyClient): void {
  server.registerTool(
    'list_accounts',
    {
      description:
        'List the chart of accounts in Billy. Use this to find account IDs for bill lines, product revenue accounts, and bank accounts for payments (look for isPaymentEnabled/isBankAccount).',
      inputSchema: z.object({
        isPaymentEnabled: z.boolean().optional().describe('Only accounts usable as payment/cash accounts'),
        isBankAccount: z.boolean().optional().describe('Only bank accounts'),
        isArchived: z.boolean().optional().describe('When true, returns only archived records; when false, only active ones'),
        q: z.string().optional().describe('Free-text search on account name/number'),
        accountNo: z.string().optional().describe('Filter by account number, e.g. 5211 (applied client-side)'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ page, pageSize, accountNo, verbose, ...filters }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        // accountNo is not a documented server-side filter — fetch wide and filter client-side.
        const data = await billy.get('/accounts', {
          organizationId,
          ...filters,
          page,
          pageSize: accountNo ? 1000 : pageSize ?? DEFAULT_PAGE_SIZE
        });
        let accounts: any[] = data.accounts ?? [];
        if (accountNo !== undefined) {
          accounts = accounts.filter((a) => String(a.accountNo) === String(accountNo));
        }
        const body = { ...data, accounts };
        return jsonResult(verbose ? body : compactResponse(body, ACCOUNT_FIELDS));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'get_account',
    {
      description: 'Get a single account from the Billy chart of accounts by ID.',
      inputSchema: z.object({
        id: z.string().describe('Account ID')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      try {
        return jsonResult(await billy.get(`/accounts/${id}`));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_daybook_transactions',
    {
      description:
        'List daybook transactions (manual journal entries) in Billy, filterable by state and entry date range.',
      inputSchema: z.object({
        state: z.enum(['draft', 'approved', 'voided']).optional().describe('Filter by transaction state'),
        daybookId: z.string().trim().min(1).optional().describe('Filter by daybook ID'),
        apiType: z.string().trim().min(1).optional().describe('Filter by Billy apiType source marker'),
        minEntryDate: z.string().optional().describe('Entry date >= this (YYYY-MM-DD)'),
        maxEntryDate: z.string().optional().describe('Entry date <= this (YYYY-MM-DD)'),
        q: z
          .string()
          .optional()
          .describe(
            'Search description/extendedDescription/voucherNo — header fields ONLY, does NOT search line text (use list_postings text filter for line-level search)'
          ),
        sortProperty: z.string().optional().describe('Sort by: priority, entryDate, createdTime'),
        sortDirection: z.enum(['ASC', 'DESC']).optional().describe('Sort direction'),
        ...pagingShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ page, pageSize, ...filters }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        return jsonResult(await billy.get('/daybookTransactions', { organizationId, ...filters, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE }));
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
