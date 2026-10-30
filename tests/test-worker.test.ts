import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { TEST_ORGANIZATION_ID } from '../src/test-worker.js';

const env = { BILLY_API_KEY: 'synthetic-test-key', ALLOWED_EMAILS: 'test@example.invalid' };
const ctx = { access: { getIdentity: async () => ({ email: 'test@example.invalid' }) } };
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await worker.fetch(new Request('https://test.invalid/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env, ctx);
  assert.equal(res.status, 200);
  const text = await res.text();
  return res.headers.get('Content-Type')?.includes('text/event-stream')
    ? JSON.parse(text.split('\n').find(line => line.startsWith('data:'))!.slice(5)) : JSON.parse(text);
}

test('test deployment only discovers identity tool; mutations and raw requests are absent', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  const result = await rpc('tools/list');
  assert.deepEqual(result.result.tools.map((tool: any) => tool.name), ['get_test_organization']);
  for (const name of ['billy_raw_request', 'create_daybook_transaction', 'execute_script']) {
    const denied = await rpc('tools/call', { name, arguments: {} });
    assert.ok(denied.error || denied.result?.isError);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test('unauthenticated, disallowed origin and missing key requests cannot reach Billy', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp'), env, {})).status, 403);
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp', {
    headers: { Origin: 'https://evil.invalid' },
  }), env, ctx)).status, 403);
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp'), { ...env, BILLY_API_KEY: '' }, ctx)).status, 503);
  assert.equal(calls.mock.callCount(), 0);
});

test('correct test identity is read using only the test secret and GET', async t => {
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(String(input), 'https://api.billysbilling.com/v2/organization');
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('X-Access-Token'), env.BILLY_API_KEY);
    assert.equal(init?.redirect, 'manual');
    return Response.json({ organization: { id: TEST_ORGANIZATION_ID, name: 'Test Regnskab API', email: 'omit@example.invalid' } });
  });
  const result = await rpc('tools/call', { name: 'get_test_organization', arguments: {} });
  assert.deepEqual(JSON.parse(result.result.content[0].text), {
    name: 'Test Regnskab API', organizationId: TEST_ORGANIZATION_ID, organizationIdLocked: true, writesEnabled: false,
  });
});

test('same name with another ID is refused on every call', async t => {
  let id = TEST_ORGANIZATION_ID;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ organization: { id, name: 'Test Regnskab API' } }));
  assert.notEqual((await rpc('tools/call', { name: 'get_test_organization', arguments: {} })).result.isError, true);
  id = 'different-organization';
  const result = await rpc('tools/call', { name: 'get_test_organization', arguments: {} });
  assert.equal(result.result.isError, true);
  assert.ok(!JSON.stringify(result).includes(id));
});

test('upstream failures do not expose Billy bodies or credentials', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('sensitive-upstream-body', { status: 401 }));
  const result = await rpc('tools/call', { name: 'get_test_organization', arguments: {} });
  assert.equal(result.result.isError, true);
  assert.ok(!JSON.stringify(result).includes('sensitive-upstream-body'));
});

test('caller cannot supply an alternative organization ID', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  const result = await rpc('tools/call', { name: 'get_test_organization', arguments: { id: 'different-organization' } });
  assert.ok(result.error || result.result?.isError);
  assert.equal(calls.mock.callCount(), 0);
});
