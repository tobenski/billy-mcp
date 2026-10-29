import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { DEFAULT_PAGE_SIZE, errorResult, jsonResult, pagingShape } from './helpers.js';

type Row = Record<string, unknown>;
type Query = Record<string, string | number | boolean | undefined>;
type Scope = { fields: string[]; value: string };

const resourceId = z.string().trim().min(1).max(512)
  .refine(id => id !== '.' && id !== '..' && !/[\\/?#\s]/.test(id), 'Provide one resource ID, not a path or URL');

function isRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate returned references without removing records or changing Billy's payload. */
function assertScope(row: Row, scopes: Scope[]): void {
  for (const { fields, value } of scopes) {
    for (const field of fields) {
      if (Object.hasOwn(row, field) && row[field] !== value) {
        throw new Error(`Billy returned a record outside the requested ${field} scope.`);
      }
    }
  }
}

async function readList(billy: BillyClient, path: string, key: string, query: Query, scopes: Scope[]) {
  const data = await billy.get<unknown>(path, query);
  if (!isRecord(data) || !Array.isArray(data[key]) || !data[key].every(isRecord)) {
    throw new Error(`Billy did not return a valid ${key} array.`);
  }
  for (const row of data[key]) assertScope(row, scopes);
  return jsonResult(data);
}

/** Native data retrieval only: every call returns one unmodified Billy response. */
export function registerTaxReadTools(server: McpServer, billy: BillyClient): void {
  const organizationLists = [
    { name: 'list_tax_rates', resource: 'taxRates', subject: 'tax rates and their configured applicability' },
    { name: 'list_sales_tax_accounts', resource: 'salesTaxAccounts', subject: 'configured sales-tax account references' },
    { name: 'list_sales_tax_meta_fields', resource: 'salesTaxMetaFields', subject: 'sales-tax reporting field definitions' },
    { name: 'list_sales_tax_returns', resource: 'salesTaxReturns', subject: 'sales-tax periods and their recorded status' },
    { name: 'list_sales_tax_rulesets', resource: 'salesTaxRulesets', subject: 'sales-tax rulesets and fallback tax-rate references' },
  ];

  for (const { name, resource, subject } of organizationLists) {
    server.registerTool(name, {
      description: `Read one page of Billy ${subject} for the connected organization. Returns all fields and metadata unchanged; follow meta.paging for additional pages.`,
      inputSchema: z.object({ ...pagingShape }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, async ({ page, pageSize }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        return await readList(billy, `/${resource}`, resource,
          { organizationId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
          [{ fields: ['organizationId'], value: organizationId }]);
      } catch (error) {
        return errorResult(error);
      }
    });
  }

  server.registerTool('list_tax_rate_deduction_components', {
    description: 'Read one page of deduction components for a required Billy tax rate ID. Returns the original fields and metadata, including configured shares and account references.',
    inputSchema: z.object({
      taxRateId: resourceId.describe('Required tax rate ID from list_tax_rates'),
      ...pagingShape,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ taxRateId, page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      return await readList(billy, '/taxRateDeductionComponents', 'taxRateDeductionComponents',
        { taxRateId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
        [{ fields: ['taxRateId'], value: taxRateId }, { fields: ['organizationId'], value: organizationId }]);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_sales_tax_return', {
    description: 'Read one Billy sales-tax return by ID, preserving all original fields, report details, corrections and metadata. The returned status is the status recorded in Billy.',
    inputSchema: z.object({ id: resourceId.describe('Sales-tax return ID from list_sales_tax_returns') }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ id }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      const data = await billy.get<unknown>(`/salesTaxReturns/${encodeURIComponent(id)}`);
      if (!isRecord(data) || !isRecord(data.salesTaxReturn) || data.salesTaxReturn.id !== id) {
        throw new Error('Billy did not return the requested sales-tax return.');
      }
      assertScope(data.salesTaxReturn, [{ fields: ['organizationId'], value: organizationId }]);
      return jsonResult(data);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_sales_tax_payments', {
    description: 'Read one page of Billy payments for a required sales-tax return. Billy requires the query parameter returnId. Returns all original payment fields and metadata.',
    inputSchema: z.object({
      returnId: resourceId.describe('Required sales-tax return ID from list_sales_tax_returns'),
      ...pagingShape,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ returnId, page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      return await readList(billy, '/salesTaxPayments', 'salesTaxPayments',
        { returnId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
        [{ fields: ['returnId', 'salesTaxReturnId'], value: returnId }, { fields: ['organizationId'], value: organizationId }]);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_sales_tax_rules', {
    description: 'Read one page of rules for a required Billy sales-tax ruleset ID. Returns the original country, contact-type, tax-rate references and metadata.',
    inputSchema: z.object({
      rulesetId: resourceId.describe('Required ruleset ID from list_sales_tax_rulesets'),
      ...pagingShape,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ rulesetId, page, pageSize }) => {
    try {
      const organizationId = await billy.getOrganizationId();
      return await readList(billy, '/salesTaxRules', 'salesTaxRules',
        { rulesetId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE },
        [{ fields: ['rulesetId'], value: rulesetId }, { fields: ['organizationId'], value: organizationId }]);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_currencies', {
    description: 'Read one page of Billy currency definitions, preserving their original exchange-rate fields and metadata. Returns native API data without currency conversion.',
    inputSchema: z.object({ ...pagingShape }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async ({ page, pageSize }) => {
    try {
      return await readList(billy, '/currencies', 'currencies',
        { page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE }, []);
    } catch (error) {
      return errorResult(error);
    }
  });
}
