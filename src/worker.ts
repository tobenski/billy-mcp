import { createMcpHandler } from '@modelcontextprotocol/server';
import { BillyClient } from './billy-client.js';
import { hasAllowedOrigin, isAllowed, type AccessContext } from './worker-auth.js';
import { createReadOnlyServer } from './worker-server.js';

export interface WorkerEnv {
  BILLY_ACCESS_TOKEN?: string;
  ALLOWED_EMAILS?: string;
  BILLY_ORGANIZATION_ID?: string;
  BILLY_LOCALE?: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: AccessContext): Promise<Response> {
    // Access Managed OAuth handles OAuth at Cloudflare's edge. The runtime
    // identity check also blocks direct/unprotected Worker and preview access.
    if (!await isAllowed(ctx, env.ALLOWED_EMAILS)) {
      return new Response('Access denied', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!hasAllowedOrigin(request)) {
      return new Response('Origin denied', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!env.BILLY_ACCESS_TOKEN?.trim()) {
      return new Response('Billy access is not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return Response.json({ service: 'billy-mcp', mode: 'read-only' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path !== '/mcp') return new Response('Not found', { status: 404 });

    // Credentials and server state belong to this request. Do not mutate
    // process.env or retain a Billy client/server in a module-global variable.
    const handler = createMcpHandler(() => createReadOnlyServer(new BillyClient({
      accessToken: env.BILLY_ACCESS_TOKEN!,
      organizationId: env.BILLY_ORGANIZATION_ID,
      locale: env.BILLY_LOCALE,
      readOnly: true,
      signal: request.signal,
      requestTimeoutMs: 15000
    })));
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
