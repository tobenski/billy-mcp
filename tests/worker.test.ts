import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

// The Worker must remain read-only even when the legacy stdio guard was loaded
// with unrestricted writes. Each test file has its own Node test process.
const previousWriteMode = process.env.BILLY_WRITE_MODE;
process.env.BILLY_WRITE_MODE = 'full';
const { default: worker } = await import('../src/worker.js');
if (previousWriteMode === undefined) delete process.env.BILLY_WRITE_MODE;
else process.env.BILLY_WRITE_MODE = previousWriteMode;

const origin = 'https://billy-worker.test';
const baseEnv = {
  BILLY_ACCESS_TOKEN: 'synthetic-worker-token',
  ALLOWED_EMAILS: 'allowed@example.invalid',
  BILLY_ORGANIZATION_ID: 'test-organization',
};
const context = (email = 'allowed@example.invalid') => ({
  access: { getIdentity: async () => ({ email }) },
  waitUntil: (_promise: Promise<unknown>) => {},
  passThroughOnException: () => {},
});
let sequence = 0;

function noNetwork(t: TestContext) {
  return t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('This operation must not call Billy');
  });
}

async function rpc(method: string, params: Record<string, unknown> = {}, options: {
  env?: typeof baseEnv & Record<string, unknown>;
  ctx?: ReturnType<typeof context>;
  headers?: Record<string, string>;
} = {}) {
  const id = ++sequence;
  const response = await worker.fetch(new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
      ...options.headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }), options.env ?? baseEnv, options.ctx ?? context());
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const messages = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(text)];
  const message = messages.find(message => message.id === id);
  assert.ok(message, 'MCP must return a result for the requested JSON-RPC id');
  return message;
}

function assertToolRejected(message: any) {
  assert.ok(message.error || message.result?.isError === true, 'The tool invocation must be rejected');
}

test('forged Access headers never replace trusted Cloudflare context', async t => {
  const outbound = noNetwork(t);
  for (const path of ['/mcp', '/health']) {
    const response = await worker.fetch(new Request(`${origin}${path}`, {
      headers: {
        'Cf-Access-Jwt-Assertion': 'synthetic-unverified-jwt',
        'Cf-Access-Authenticated-User-Email': 'allowed@example.invalid',
        Authorization: 'Bearer synthetic-unverified-credential',
      },
    }), baseEnv, {});
    assert.equal(response.status, 403);
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('Access identity and a nonempty email allowlist are both required', async t => {
  const outbound = noNetwork(t);
  const cases = [
    { env: baseEnv, ctx: context('other@example.invalid') },
    { env: { ...baseEnv, ALLOWED_EMAILS: '' }, ctx: context() },
    { env: baseEnv, ctx: { access: { getIdentity: async () => null } } },
    { env: baseEnv, ctx: { access: { getIdentity: async () => { throw new Error('Identity unavailable'); } } } },
  ];
  for (const { env, ctx } of cases) {
    const response = await worker.fetch(new Request(`${origin}/health`), env, ctx);
    assert.equal(response.status, 403);
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('email matching is normalized and health reports fixed read-only mode without API calls', async t => {
  const outbound = noNetwork(t);
  const response = await worker.fetch(new Request(`${origin}/health`), {
    ...baseEnv,
    ALLOWED_EMAILS: ' someone@example.invalid, ALLOWED@example.invalid ',
    BILLY_WRITE_MODE: 'full',
  }, context(' Allowed@Example.Invalid '));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'read-only');
  assert.equal(outbound.mock.callCount(), 0);
});

test('an authenticated request without a Billy credential returns unavailable before API access', async t => {
  const outbound = noNetwork(t);
  const response = await worker.fetch(new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }), { ...baseEnv, BILLY_ACCESS_TOKEN: '' }, context());
  assert.equal(response.status, 503);
  assert.equal(outbound.mock.callCount(), 0);
});

test('MCP rejects untrusted and opaque browser Origins', async t => {
  const outbound = noNetwork(t);
  for (const untrusted of ['https://evil.invalid', 'https://billy-worker.test.evil.invalid', 'null']) {
    const response = await worker.fetch(new Request(`${origin}/mcp`, {
      method: 'POST',
      headers: { Origin: untrusted, 'Content-Type': 'application/json' },
      body: '{}',
    }), baseEnv, context());
    assert.equal(response.status, 403);
  }
  const accepted = await rpc('tools/list', {}, { headers: { Origin: origin } });
  assert.ok(Array.isArray(accepted.result?.tools));
  assert.equal(outbound.mock.callCount(), 0);
});

test('initialization and discovery expose only the intended 25 reading tools', async t => {
  const outbound = noNetwork(t);
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'read-only-test', version: '1.0' },
  });
  assert.ok(initialized.result?.serverInfo?.name);
  const listed = await rpc('tools/list', {}, { env: { ...baseEnv, BILLY_WRITE_MODE: 'full' } });
  const tools = listed.result?.tools;
  assert.ok(Array.isArray(tools));
  const expected = [
    'get_organization', 'list_contacts', 'get_contact', 'list_contact_persons',
    'list_products', 'get_product', 'list_invoices', 'get_invoice', 'list_bills', 'get_bill',
    'list_bank_payments', 'list_balance_modifiers', 'list_accounts', 'get_account',
    'list_daybook_transactions', 'list_daybooks', 'get_account_balances', 'list_postings',
    'list_transactions', 'list_bank_lines', 'list_bank_line_matches', 'list_files', 'get_file',
    'list_attachments', 'billy_raw_request',
  ];
  assert.deepEqual(tools.map((tool: any) => tool.name).sort(), expected.sort());
  assert.ok(tools.every((tool: any) => tool.annotations?.readOnlyHint === true));
  assert.equal(outbound.mock.callCount(), 0);
});

test('script, upload and dedicated mutation tools are not callable', async t => {
  const outbound = noNetwork(t);
  for (const name of ['execute_script', 'upload_file', 'create_invoice', 'create_daybook_transaction', 'batch_void_daybook_transactions']) {
    const message = await rpc('tools/call', { name, arguments: {} }, { env: { ...baseEnv, BILLY_WRITE_MODE: 'full' } });
    assertToolRejected(message);
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('the raw API tool permits GET and rejects mutation methods before fetch', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(new URL(String(input)).href, 'https://api.billysbilling.com/v2/currencies');
    assert.equal(init?.method, 'GET');
    return Response.json({ currencies: [{ id: 'DKK' }] });
  });
  const result = await rpc('tools/call', { name: 'billy_raw_request', arguments: { path: '/currencies' } });
  assert.equal(result.result?.isError, undefined);
  assert.deepEqual(JSON.parse(result.result.content[0].text), { currencies: [{ id: 'DKK' }] });
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assertToolRejected(await rpc('tools/call', { name: 'billy_raw_request', arguments: { method, path: '/currencies', body: {} } }));
  }
  assert.equal(outbound.mock.callCount(), 1);
});

test('concurrent requests keep their Billy credentials and resolved organizations separate', async t => {
  const observed: Array<{ organization: string; path: string }> = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const credential = new Headers(init?.headers).get('X-Access-Token');
    const organization = credential === 'synthetic-user-a' ? 'organization-a'
      : credential === 'synthetic-user-b' ? 'organization-b' : undefined;
    assert.ok(organization, 'Every request must use its own explicit binding');
    const path = new URL(String(input)).pathname;
    observed.push({ organization, path });
    await Promise.resolve();
    assert.ok(path === '/v2/organization' || path === `/v2/organizations/${organization}`);
    return Response.json({ organization: { id: organization } });
  });
  const result = await Promise.all(['a', 'b'].map(suffix => rpc('tools/call', {
    name: 'get_organization', arguments: {},
  }, { env: { ...baseEnv, BILLY_ACCESS_TOKEN: `synthetic-user-${suffix}`, BILLY_ORGANIZATION_ID: '' } })));
  assert.deepEqual(result.map(message => JSON.parse(message.result.content[0].text).organization.id), ['organization-a', 'organization-b']);
  assert.equal(observed.length, 4);
});

test('a list tool works for a company token when the organization collection is forbidden', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, 'GET');
    if (url.pathname === '/v2/organizations') {
      return Response.json({ errorCode: 'ACCESS_RESTRICTED' }, { status: 403 });
    }
    if (url.pathname === '/v2/organization') {
      return Response.json({ organization: { id: 'resolved-company' } });
    }
    assert.equal(url.pathname, '/v2/accounts');
    assert.equal(url.searchParams.get('organizationId'), 'resolved-company');
    assert.equal(url.searchParams.get('page'), '1');
    assert.equal(url.searchParams.get('pageSize'), '2');
    return Response.json({
      meta: { paging: { page: 1, pageSize: 2, pageCount: 1, total: 1 } },
      accounts: [{ id: 'test-account', organizationId: 'resolved-company', accountNo: 1000, name: 'Test account' }],
    });
  });
  const message = await rpc('tools/call', {
    name: 'list_accounts', arguments: { page: 1, pageSize: 2 },
  }, { env: { ...baseEnv, BILLY_ORGANIZATION_ID: '' } });
  assert.equal(message.result?.isError, undefined);
  const body = JSON.parse(message.result.content[0].text);
  assert.deepEqual(body.accounts, [{ id: 'test-account', accountNo: 1000, name: 'Test account' }]);
  assert.equal(body.meta.paging.total, 1);
  assert.equal(outbound.mock.callCount(), 2);
});
