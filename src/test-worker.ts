import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { BillyClient } from './billy-client.js';
import { hasAllowedOrigin, isAllowed, type AccessContext } from './worker-auth.js';
import { registerAccountTools } from './tools/accounts.js';
import { registerDaybookTools } from './tools/daybook.js';

// Deliberately fixed in the test entrypoint, not supplied by an MCP caller.
export const TEST_ORGANIZATION_ID = 'YzQ1JjkgQyWvA3bqpZJ5MA';
interface TestEnv { BILLY_API_KEY?: string; ALLOWED_EMAILS?: string }

// One client per MCP request. Every data read first verifies the actual token;
// an organization query parameter is never used as proof of token identity.
class TestBillyClient extends BillyClient {
  private verified?: Promise<{ organization: { id: string; name?: string } }>;

  private verify() {
    return this.verified ??= super.get('/organization').then(result => {
      if (result?.organization?.id !== TEST_ORGANIZATION_ID) {
        throw new Error('Test organization ID mismatch. Access refused.');
      }
      return result as { organization: { id: string; name?: string } };
    }).catch(() => { throw new Error('Test organization verification failed. Access refused.'); });
  }

  override async get<T = any>(path: string, query?: Parameters<BillyClient['get']>[1]): Promise<T> {
    const identity = await this.verify();
    if (path === '/organization') return identity as T;
    return super.get<T>(path, query);
  }
}

function createTestServer(billy: BillyClient): McpServer {
  const server = new McpServer({ name: 'billy-test', version: '0.2.0' });
  const allowed = new Set(['get_test_organization', 'list_accounts', 'list_daybooks']);
  const register = server.registerTool.bind(server);
  server.registerTool = ((...args: Parameters<McpServer['registerTool']>) => {
    const tool = register(...args);
    if (!allowed.has(args[0])) tool.remove();
    return tool;
  }) as McpServer['registerTool'];
  registerAccountTools(server, billy);
  registerDaybookTools(server, billy);
  server.registerTool('get_test_organization', {
    title: 'Vis testregnskab',
    description: 'Verify the connected Billy token against the fixed test organization ID. Returns identity only. No write operations are available.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async () => {
    try {
      // Always resolve from the token. A configured organizationId would skip
      // this verification in BillyClient.getOrganizationId().
      const result = await billy.get<{ organization?: { id?: string; name?: string } }>('/organization');
      const org = result.organization;
      if (org?.id !== TEST_ORGANIZATION_ID) {
        return { isError: true, content: [{ type: 'text', text: 'Test organization ID mismatch. Access refused.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({
        name: org.name, organizationId: org.id, organizationIdLocked: true, writesEnabled: false,
      }) }] };
    } catch {
      // Never relay upstream response bodies or credentials to the client.
      return { isError: true, content: [{ type: 'text', text: 'Billy identity verification failed. No writes performed.' }] };
    }
  });
  return server;
}

export default {
  async fetch(request: Request, env: TestEnv, ctx: AccessContext): Promise<Response> {
    const denied = (message: string, status: number) => new Response(message, {
      status, headers: { 'Cache-Control': 'no-store' },
    });
    if (!await isAllowed(ctx, env.ALLOWED_EMAILS)) return denied('Access denied', 403);
    if (!hasAllowedOrigin(request)) return denied('Origin denied', 403);
    if (!env.BILLY_API_KEY?.trim()) return denied('Billy test key is not configured', 503);
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return Response.json({ service: 'billy-test', mode: 'read-only', writesEnabled: false }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (path !== '/mcp') return denied('Not found', 404);
    const handler = createMcpHandler(() => createTestServer(new TestBillyClient({
      accessToken: env.BILLY_API_KEY!, readOnly: true,
      signal: request.signal, requestTimeoutMs: 15000,
    })));
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  },
};
