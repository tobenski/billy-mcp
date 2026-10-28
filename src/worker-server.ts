import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { BillyClient } from './billy-client.js';
import { registerAccountTools } from './tools/accounts.js';
import { registerAttachmentTools } from './tools/attachments.js';
import { registerBillTools } from './tools/bills.js';
import { registerContactTools } from './tools/contacts.js';
import { registerDaybookTools } from './tools/daybook.js';
import { registerInvoiceTools } from './tools/invoices.js';
import { registerOrganizationTools } from './tools/organization.js';
import { registerPaymentTools } from './tools/payments.js';
import { registerProductTools } from './tools/products.js';
import { registerReportingTools } from './tools/reporting.js';
import { registerDocumentReadTools } from './tools/document-reads.js';
import { registerLedgerReadTools } from './tools/ledger-reads.js';
import { registerTaxReadTools } from './tools/tax-reads.js';
import { cap, errorResult } from './tools/helpers.js';

// Explicit names keep writes and upstream financial calculations out of this data-only endpoint.
// execute_script is deliberately absent from this module's import graph.
const READ_TOOLS = new Set([
  'get_organization', 'list_contacts', 'get_contact', 'list_contact_persons',
  'list_products', 'get_product', 'list_invoices', 'get_invoice',
  'list_bills', 'get_bill', 'list_bank_payments', 'list_balance_modifiers',
  'list_accounts', 'get_account', 'list_daybook_transactions', 'list_daybooks',
  'list_postings', 'list_transactions',
  'list_bank_lines', 'list_bank_line_matches', 'list_files', 'get_file', 'list_attachments',
  'list_account_groups', 'list_account_natures',
  'list_daybook_transaction_lines', 'list_daybook_balance_accounts',
  'get_daybook_transaction', 'get_transaction', 'get_posting',
  'get_bank_line_match', 'list_bank_line_subject_associations',
  'list_invoice_lines', 'list_bill_lines', 'list_contact_balance_postings',
  'list_contact_balance_payments', 'list_invoice_late_fees',
  'list_invoice_reminders', 'list_invoice_reminder_associations', 'list_invoice_logs',
  'list_tax_rates', 'list_tax_rate_deduction_components',
  'list_sales_tax_accounts', 'list_sales_tax_meta_fields', 'list_sales_tax_returns',
  'get_sales_tax_return', 'list_sales_tax_payments', 'list_sales_tax_rulesets',
  'list_sales_tax_rules', 'list_currencies', 'billy_raw_request'
]);

export function createReadOnlyServer(billy: BillyClient): McpServer {
  const server = new McpServer({ name: 'billy-readonly', version: '0.3.2-worker.3' });
  const register = server.registerTool.bind(server);
  server.registerTool = ((...args: Parameters<McpServer['registerTool']>) => {
    const tool = register(...args);
    if (!READ_TOOLS.has(args[0])) tool.remove();
    return tool;
  }) as McpServer['registerTool'];

  registerOrganizationTools(server, billy);
  registerContactTools(server, billy);
  registerProductTools(server, billy);
  registerInvoiceTools(server, billy);
  registerPaymentTools(server, billy);
  registerBillTools(server, billy);
  registerAccountTools(server, billy);
  registerDaybookTools(server, billy);
  registerReportingTools(server, billy);
  registerAttachmentTools(server, billy);
  registerDocumentReadTools(server, billy);
  registerLedgerReadTools(server, billy);
  registerTaxReadTools(server, billy);

  // A separate schema and GET-only call avoid exposing the upstream raw write API.
  server.registerTool('billy_raw_request', {
    description: 'Read a Billy API v2 endpoint. Only GET is supported by this hosted server. Unknown Billy query parameters may be ignored by the API; use documented filters and pagination.',
    inputSchema: z.object({
      method: z.literal('GET').default('GET'),
      path: z.string().regex(/^\//).describe('Path relative to /v2, for example /currencies'),
      query: z.record(z.string(), z.string()).optional(),
      maxChars: z.number().int().min(1000).max(200000).optional()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ path, query, maxChars }) => {
    try {
      const data = await billy.get(path, query);
      return { content: [{ type: 'text' as const, text: cap(JSON.stringify(data), maxChars ?? 20000) }] };
    } catch (error) {
      return errorResult(error);
    }
  });
  return server;
}
