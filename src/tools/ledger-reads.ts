import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { DEFAULT_PAGE_SIZE, errorResult, jsonResult, pagingShape } from './helpers.js';

type Row = Record<string, unknown>;

const resourceId = z.string().trim().min(1).max(512)
  .refine(id => id !== '.' && id !== '..' && !/[\\/?#\s]/.test(id), 'Provide one resource ID, not a path or URL');

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the requested scope without filtering or changing Billy's payload. */
function validateList(data: unknown, key: string, parent?: { field: string; id: string }): void {
  const rows = isRow(data) ? data[key] : undefined;
  if (!Array.isArray(rows) || !rows.every(isRow)) {
    throw new Error(`Billy did not return a valid ${key} array.`);
  }
  if (parent && rows.some(row => Object.hasOwn(row, parent.field) && row[parent.field] !== parent.id)) {
    throw new Error(`Billy returned ${key} outside the requested ${parent.field} filter.`);
  }
}

/** Native, paged GET reads. Financial interpretation stays with the caller. */
export function registerLedgerReadTools(server: McpServer, billy: BillyClient): void {
  server.registerTool('list_account_groups', {
    description: 'Read one page of Billy account groups for the connected organization. Returns all original fields and pagination; no aggregation or financial classification is performed.',
    inputSchema: z.object({ ...pagingShape }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      const data = await billy.get<unknown>('/accountGroups', { organizationId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
      validateList(data, 'accountGroups', { field: 'organizationId', id: organizationId });
      return jsonResult(data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('list_account_natures', {
    description: 'Read one page of Billy account natures, including the native report type and normal balance fields. Returns Billy data and pagination without calculating an analysis.',
    inputSchema: z.object({ ...pagingShape }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ page, pageSize }) => {
    try {
      const data = await billy.get<unknown>('/accountNatures', { page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
      validateList(data, 'accountNatures');
      return jsonResult(data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('list_daybook_transaction_lines', {
    description: 'Read one page of native lines belonging to one Billy daybook transaction. Includes all fields such as accounts, tax rates, amounts and currency, plus original pagination. No totals are calculated.',
    inputSchema: z.object({
      daybookTransactionId: resourceId.describe('Required daybook transaction ID'),
      ...pagingShape
    }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ daybookTransactionId, page, pageSize }) => {
    try {
      const data = await billy.get<unknown>('/daybookTransactionLines', {
        daybookTransactionId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE
      });
      validateList(data, 'daybookTransactionLines', { field: 'daybookTransactionId', id: daybookTransactionId });
      return jsonResult(data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('list_daybook_balance_accounts', {
    description: 'Read one page of the balance-account references configured for one Billy daybook. Returns native references and pagination; this does not calculate account balances.',
    inputSchema: z.object({ daybookId: resourceId.describe('Required daybook ID'), ...pagingShape }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ daybookId, page, pageSize }) => {
    try {
      const data = await billy.get<unknown>('/daybookBalanceAccounts', {
        daybookId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE
      });
      validateList(data, 'daybookBalanceAccounts', { field: 'daybookId', id: daybookId });
      return jsonResult(data);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool('list_bank_line_subject_associations', {
    description: 'Read one page of native subject references belonging to one Billy bank-line match. Returns all original fields and pagination; it does not approve matches or perform reconciliation.',
    inputSchema: z.object({ matchId: resourceId.describe('Required bank-line match ID'), ...pagingShape }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ matchId, page, pageSize }) => {
    try {
      const data = await billy.get<unknown>('/bankLineSubjectAssociations', {
        matchId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE
      });
      validateList(data, 'bankLineSubjectAssociations', { field: 'matchId', id: matchId });
      return jsonResult(data);
    } catch (error) { return errorResult(error); }
  });

  const singleReads = [
    { name: 'get_daybook_transaction', path: '/daybookTransactions', key: 'daybookTransaction', label: 'daybook transaction' },
    { name: 'get_transaction', path: '/transactions', key: 'transaction', label: 'booked transaction' },
    { name: 'get_posting', path: '/postings', key: 'posting', label: 'ledger posting' },
    { name: 'get_bank_line_match', path: '/bankLineMatches', key: 'bankLineMatch', label: 'bank-line match' }
  ] as const;

  for (const definition of singleReads) {
    server.registerTool(definition.name, {
      description: `Read one existing Billy ${definition.label} by ID. Returns the entire native JSON response without fetching related records or calculating an analysis.`,
      inputSchema: z.object({ id: resourceId.describe(`Required ${definition.label} ID`) }),
      annotations: { readOnlyHint: true, destructiveHint: false }
    }, async ({ id }) => {
      try {
        const data = await billy.get<unknown>(`${definition.path}/${encodeURIComponent(id)}`);
        const record = isRow(data) ? data[definition.key] : undefined;
        if (!isRow(record) || record.id !== id) {
          throw new Error(`Billy did not return the requested ${definition.label} ID.`);
        }
        return jsonResult(data);
      } catch (error) { return errorResult(error); }
    });
  }
}
