import {readBankIntegration} from './test-bank-integration.js';
import {reportHandler} from './test-reports.js';
import { reviewHandler, reviewRead } from './test-reviews.js';
import { factsHandler } from './test-document-facts.js';
import { contactHandler, contactSnapshot } from './test-contacts.js';
import { nameHandler } from './test-names.js';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { BillyClient } from './billy-client.js';
import { hasAllowedOrigin, isAllowed, type AccessContext } from './worker-auth.js';
import { registerTestDraftTools, type JournalDB } from './test-drafts.js';
import { registerTestFileTools } from './test-files.js';
import { correctionHandler, transactionWithRevision } from './test-corrections.js';
import { finalizeHandler } from './test-finalize.js';
import { bankHandler } from './test-bank.js';
import { documentHandler } from './test-documents.js';
import { extendedHandler, draftSnapshot } from './test-extended-drafts.js';
import { errorResult, jsonResult } from './tools/helpers.js';
import { registerRoadmapTools } from './test-roadmap.js';
import { createReadOnlyServer } from './worker-server.js';

// Deployment-only configuration; never supplied by an MCP caller.
interface TestEnv { BILLY_API_KEY?: string; ALLOWED_EMAILS?: string; BILLY_TEST_ORGANIZATION_ID?: string; TEST_WRITE_JOURNAL?: JournalDB; BILLY_TEST_DRAFT_WRITES?: string }

// One client per MCP request. Every data read first verifies the actual token;
// an organization query parameter is never used as proof of token identity.
class TestBillyClient extends BillyClient {
  constructor(config: ConstructorParameters<typeof BillyClient>[0], private readonly expectedId: string) {
    super(config);
  }
  private verified?: Promise<{ organization: { id: string; name?: string } }>;

  private verify() {
    return this.verified ??= super.get('/organization').then(result => {
      if (result?.organization?.id !== this.expectedId) {
        throw new Error('Test organization ID mismatch. Access refused.');
      }
      return result as { organization: { id: string; name?: string } };
    }).catch(() => { throw new Error('Test organization verification failed. Access refused.'); });
  }

  override async get<T = any>(path: string, query?: Parameters<BillyClient['get']>[1]): Promise<T> {
    const url = new URL('https://api.billysbilling.com/v2' + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (url.searchParams.getAll('organizationId').some(id => id !== this.expectedId) ||
        (url.pathname.startsWith('/v2/organizations/') &&
          !new RegExp('^/v2/organizations/'+this.expectedId+'(?:/reports/(?:trialBalance|balanceSheet|profitAndLoss)|/(?:trialBalance|balanceSheet|incomeStatement)\\.json)?$').test(decodeURIComponent(url.pathname)))) {
      throw new Error('Requests for a different organization are not allowed.');
    }
    const identity = await this.verify();
    if (path === '/organization') return identity as T;
    return super.get<T>(path, query);
  }
}

function createTestServer(billy: BillyClient, expectedId: string, write?: BillyClient, db?: JournalDB, integrationToken?:string, integrationSignal?:AbortSignal): McpServer {
  const server = new McpServer({ name: 'billy-test', version: '0.5.0' });
  server.registerTool('get_test_organization', {
    title: 'Vis testregnskab',
    description: 'Verify the connected Billy token against the fixed test organization ID. Returns identity and whether isolated draft writes are enabled.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {
    try {
      // Always resolve from the token. A configured organizationId would skip
      // this verification in BillyClient.getOrganizationId().
      const result = await billy.get<{ organization?: { id?: string; name?: string } }>('/organization');
      const org = result.organization;
      if (org?.id !== expectedId) {
        return { isError: true, content: [{ type: 'text', text: 'Test organization ID mismatch. Access refused.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({
        name: org.name, organizationId: org.id, organizationIdLocked: true, writesEnabled: Boolean(write && db),
      }) }] };
    } catch {
      // Never relay upstream response bodies or credentials to the client.
      return { isError: true, content: [{ type: 'text', text: 'Billy identity verification failed. No writes performed.' }] };
    }
  });
  // Keep the diagnostic tool, then use the production read-only registry itself.
  // This preserves all 51 tools without a second list that can drift.
  if (write && db) {
    registerTestDraftTools(server, billy, write, db, expectedId);
    registerTestFileTools(server, billy, write, db, expectedId);
  }
  registerRoadmapTools(server, Boolean(write && db),{...Object.fromEntries(['get_test_account_balances','get_test_trial_balance','get_test_bank_balances'].map(name=>[name,reportHandler(billy,expectedId,name,integrationToken?(accountId)=>readBankIntegration(billy,integrationToken,expectedId,accountId,integrationSignal):undefined)])),...(write&&db?Object.fromEntries(['create_test_review','resolve_test_review'].map(name=>[name,reviewHandler(billy,db,expectedId,name)])):{}),...(write&&db?{set_test_document_facts:factsHandler(billy,db,expectedId)}:{}),...(write&&db?Object.fromEntries(['create_test_contact','update_test_contact'].map(name=>[name,contactHandler(billy,write,db,expectedId,name)])):{}),...(write&&db?Object.fromEntries(['rename_test_account','rename_test_account_group'].map(name=>[name,nameHandler(billy,write,db,expectedId,name)])):{}),...(write&&db?Object.fromEntries(['propose_test_booked_change','propose_test_reversal'].map(name=>[name,correctionHandler(billy,write,db,expectedId,name)])):{}),...(write&&db?Object.fromEntries(['book_test_daybook_draft','approve_test_bank_match'].map(name=>[name,finalizeHandler(billy,write,db,expectedId,name)])):{}),...Object.fromEntries(['get_test_bank_line',...(write&&db?['reconcile_test_bank_line','unlink_test_bank_line']:[])].map(name=>[name,bankHandler(billy,expectedId,name,write,db)])),...Object.fromEntries(['get_test_document','search_test_documents'].map(name=>[name,documentHandler(billy,expectedId,name,db)])),...(write&&db?Object.fromEntries(['create_test_extended_draft','update_test_extended_draft'].map(name=>[name,extendedHandler(billy,write,db,expectedId,name)])):{})});
  if(write&&db){
    const register=server.registerTool.bind(server);
    server.registerTool=((name:any,config:any,handler:any)=>name==='get_contact'?register(name,{...config,description:config.description+' In test-write mode includes all contact persons and revision for safe updates.'},async({id}:any)=>{try{return jsonResult(await contactSnapshot(billy,expectedId,id));}catch(e){return errorResult(e);}}):name==='get_transaction'?register(name,{...config,description:config.description+' Returns correction eligibility/revision plus reviews and separate reviewRevision for review changes. reviewSource contains the reviewed evidence.'},async({id}:any)=>{try{return jsonResult({...await transactionWithRevision(billy,expectedId,id),...await reviewRead(billy,db,expectedId,'transaction',id)});}catch(e){return errorResult(e);}}):name==='get_daybook_transaction'?register(name,{...config,description:config.description+' In test-write mode also returns all lines, attachments and an optimistic revision for extended updates.'},async({id}:any)=>{try{return jsonResult(await draftSnapshot(billy,id,expectedId));}catch(e){return errorResult(e);}}):register(name,config,handler)) as typeof server.registerTool;
  }
  return createReadOnlyServer(billy, server);
}

export default {
  async fetch(request: Request, env: TestEnv, ctx: AccessContext): Promise<Response> {
    const denied = (message: string, status: number) => new Response(message, {
      status, headers: { 'Cache-Control': 'no-store' },
    });
    if (!await isAllowed(ctx, env.ALLOWED_EMAILS)) return denied('Access denied', 403);
    if (!hasAllowedOrigin(request)) return denied('Origin denied', 403);
    if (!env.BILLY_API_KEY?.trim()) return denied('Billy test key is not configured', 503);
    const expectedId = env.BILLY_TEST_ORGANIZATION_ID?.trim();
    if (!expectedId) return denied('Billy test organization lock is not configured', 503);
    const writesEnabled = env.BILLY_TEST_DRAFT_WRITES === 'enabled';
    if (writesEnabled && !env.TEST_WRITE_JOURNAL) return denied('Test write journal is not configured', 503);
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return Response.json({ service: 'billy-test', mode: writesEnabled ? 'test-drafts' : 'read-only', writesEnabled }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (path !== '/mcp') return denied('Not found', 404);
    const handler = createMcpHandler(() => createTestServer(new TestBillyClient({
      accessToken: env.BILLY_API_KEY!, readOnly: true,
      signal: request.signal, requestTimeoutMs: 15000,
    }, expectedId), expectedId, writesEnabled ? new BillyClient({
      accessToken: env.BILLY_API_KEY!, readOnly: false, signal: request.signal, requestTimeoutMs: 15000,
    }) : undefined, env.TEST_WRITE_JOURNAL, env.BILLY_API_KEY, request.signal));
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  },
};
