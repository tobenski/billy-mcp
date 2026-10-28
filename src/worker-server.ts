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
import { cap, errorResult } from './tools/helpers.js';

// Explicit names keep future upstream write tools out of the hosted endpoint.
// execute_script is deliberately absent from this module's import graph.
const READ_TOOLS = new Set([
  'get_organization', 'list_contacts', 'get_contact', 'list_contact_persons',
  'list_products', 'get_product', 'list_invoices', 'get_invoice',
  'list_bills', 'get_bill', 'list_bank_payments', 'list_balance_modifiers',
  'list_accounts', 'get_account', 'list_daybook_transactions', 'list_daybooks',
  'get_account_balances', 'list_postings', 'list_transactions',
  'list_bank_lines', 'list_bank_line_matches', 'list_files', 'list_attachments',
  'billy_raw_request'
]);

export function createReadOnlyServer(billy: BillyClient): McpServer {
  const server = new McpServer({ name: 'billy-readonly', version: '0.3.2-worker.1' });
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
