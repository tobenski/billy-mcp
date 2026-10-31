import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/test-worker.js';
const TEST_ORGANIZATION_ID = 'synthetic-test-organization';
import readOnlyWorker from '../src/worker.js';

const env = { BILLY_TEST_ORGANIZATION_ID: TEST_ORGANIZATION_ID, BILLY_API_KEY: 'synthetic-test-key', ALLOWED_EMAILS: 'test@example.invalid' };
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

test('test deployment exposes all 51 original read schemas plus the test identity tool', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  const result = await rpc('tools/list');
  const original = await readOnlyWorker.fetch(new Request('https://test.invalid/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }), { BILLY_ACCESS_TOKEN: 'synthetic-original-token', ALLOWED_EMAILS: env.ALLOWED_EMAILS }, ctx);
  const text = await original.text();
  const message = original.headers.get('Content-Type')?.includes('text/event-stream')
    ? JSON.parse(text.split('\n').find(line => line.startsWith('data:'))!.slice(5)) : JSON.parse(text);
  assert.equal(result.result.tools.length, 99);
  assert.equal(message.result.tools.length, 51);
  assert.deepEqual(result.result.tools.filter((tool: any) => message.result.tools.some((original:any)=>original.name===tool.name)), message.result.tools);
  for (const name of ['create_daybook_transaction', 'execute_script', 'upload_file', 'get_account_balances']) {
    const denied = await rpc('tools/call', { name, arguments: {} });
    assert.ok(denied.error || denied.result?.isError);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test('raw GET is pinned, preserves native output, and mutation methods are rejected', async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(init?.method, 'GET');
    const path = new URL(String(input)).pathname;
    paths.push(path);
    return Response.json(path === '/v2/organization'
      ? { organization: { id: TEST_ORGANIZATION_ID } } : { currencies: [{ id: 'DKK' }] });
  });
  const result = await rpc('tools/call', { name: 'billy_raw_request', arguments: { path: '/currencies' } });
  assert.deepEqual(JSON.parse(result.result.content[0].text), { currencies: [{ id: 'DKK' }] });
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const rejected = await rpc('tools/call', { name: 'billy_raw_request', arguments: { method, path: '/accounts' } });
    assert.ok(rejected.error || rejected.result?.isError);
  }
  assert.deepEqual(paths, ['/v2/organization', '/v2/currencies']);
});

test('foreign organization overrides and external paths cannot reach data endpoints', async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    paths.push(new URL(String(input)).pathname);
    return Response.json({ organization: { id: TEST_ORGANIZATION_ID } });
  });
  for (const [name, args] of [
    ['get_organization', { id: 'other-company' }],
    ['billy_raw_request', { path: '/accounts', query: { organizationId: 'other-company' } }],
    ['billy_raw_request', { path: '/accounts?organizationId=other-company' }],
    ['billy_raw_request', { path: '/organizations/other-company' }],
    ['billy_raw_request', { path: '/organizations/other-company/reports/trialBalance' }],
    ['billy_raw_request', { path: '/organizations/'+TEST_ORGANIZATION_ID+'/reports/unknown' }],
    ['billy_raw_request', { path: '/../user' }],
  ] as const) {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.ok(result.error || result.result?.isError);
  }
  assert.ok(paths.every(path => path === '/v2/organization'));
});

test('wrong token blocks representative tools from every read category including raw access', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async input => {
    assert.equal(new URL(String(input)).pathname, '/v2/organization');
    return Response.json({ organization: { id: 'wrong-company' } });
  });
  const cases = [
    ['get_contact', { id: 'contact' }], ['get_invoice', { id: 'invoice' }],
    ['get_bill', { id: 'bill' }], ['get_file', { id: 'file' }],
    ['list_attachments', {}], ['list_bank_lines', { accountId: 'bank' }],
    ['get_transaction', { id: 'transaction' }], ['list_tax_rates', {}],
    ['list_account_groups', {}], ['list_currencies', {}],
    ['billy_raw_request', { path: '/currencies' }],
  ] as const;
  for (const [name, args] of cases) {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.equal(result.result?.isError, true, name);
  }
  assert.equal(calls.mock.callCount(), cases.length);
});

test('accounts and daybooks reuse source filters and pagination after identity verification', async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('X-Access-Token'), env.BILLY_API_KEY);
    if (url.pathname === '/v2/organization') return Response.json({ organization: { id: TEST_ORGANIZATION_ID } });
    assert.equal(url.searchParams.get('organizationId'), TEST_ORGANIZATION_ID);
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('pageSize'), '10');
    if (url.pathname === '/v2/accounts') {
      assert.equal(url.searchParams.get('isArchived'), 'false');
      return Response.json({ accounts: [{ id: 'account-1', name: 'Synthetic account', accountNo: 1000 }], meta: { paging: { page: 2, pageCount: 3 } } });
    }
    assert.equal(url.pathname, '/v2/daybooks');
    return Response.json({ daybooks: [{ id: 'daybook-1', name: 'Synthetic daybook' }], meta: { paging: { page: 2, pageCount: 3 } } });
  });
  for (const name of ['list_accounts', 'list_daybooks']) {
    const result = await rpc('tools/call', { name, arguments: { page: 2, pageSize: 10, ...(name === 'list_accounts' ? { isArchived: false } : {}) } });
    assert.notEqual(result.result.isError, true);
    assert.equal(JSON.parse(result.result.content[0].text).meta.paging.pageCount, 3);
  }
  assert.deepEqual(paths, ['/v2/organization', '/v2/accounts', '/v2/organization', '/v2/daybooks']);
});

test('wrong token identity blocks both data endpoints before their data is requested', async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    paths.push(new URL(String(input)).pathname);
    return Response.json({ organization: { id: 'wrong-company', name: 'Test Regnskab API' } });
  });
  for (const name of ['list_accounts', 'list_daybooks']) {
    const result = await rpc('tools/call', { name, arguments: {} });
    assert.equal(result.result.isError, true);
  }
  assert.deepEqual(paths, ['/v2/organization', '/v2/organization']);
});

test('unauthenticated, disallowed origin and missing key requests cannot reach Billy', async t => {
  const calls = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp'), env, {})).status, 403);
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp', {
    headers: { Origin: 'https://evil.invalid' },
  }), env, ctx)).status, 403);
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp'), { ...env, BILLY_API_KEY: '' }, ctx)).status, 503);
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp'), { ...env, BILLY_TEST_ORGANIZATION_ID: '' }, ctx)).status, 503);
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


test('known native report paths are allowed only beneath the verified organization',async t=>{
 const paths:string[]=[];t.mock.method(globalThis,'fetch',async input=>{const path=new URL(String(input)).pathname;paths.push(path);return Response.json(path==='/v2/organization'?{organization:{id:TEST_ORGANIZATION_ID}}:{report:{native:true}});});
 for(const kind of ['reports/trialBalance','reports/balanceSheet','reports/profitAndLoss','trialBalance.json','balanceSheet.json','incomeStatement.json']){const path='/organizations/'+TEST_ORGANIZATION_ID+'/'+kind;const r=await rpc('tools/call',{name:'billy_raw_request',arguments:{path}});assert.notEqual(r.result?.isError,true);assert.equal(JSON.parse(r.result.content[0].text).report.native,true);}
 assert.equal(paths.filter(p=>p.includes('/reports/')).length,3);
});
