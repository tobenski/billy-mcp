import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { BillyClient } from '../src/billy-client.js';

function environment(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('read-only clients block every mutation entry point before calling fetch', async t => {
  environment(t, { BILLY_WRITE_MODE: 'full' });
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('A read-only mutation reached the network');
  });
  const client = new BillyClient({ accessToken: 'synthetic-test-token', readOnly: true });
  const mutations = [
    () => client.post('/invoices', {}),
    () => client.put('/invoices/example', {}),
    () => client.del('/invoices/example'),
    () => client.request('POST', '/invoices', { body: {} }),
    () => client.postBinary('/files', new Uint8Array([1]), { fileName: 'example.pdf', contentType: 'application/pdf' }),
  ];
  for (const mutate of mutations) await assert.rejects(mutate, /read.only|GET/i);
  assert.equal(outbound.mock.callCount(), 0);
});

test('read-only requests reject redirects without forwarding Billy credentials', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(new URL(String(input)).href, 'https://api.billysbilling.com/v2/accounts');
    assert.equal(init?.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://external.invalid/redirect-target' },
    });
  });
  const client = new BillyClient({ accessToken: 'synthetic-test-token', readOnly: true });
  await assert.rejects(() => client.get('/accounts'), /302/);
  assert.equal(outbound.mock.callCount(), 1);
});

test('explicit configuration never inherits another process token, organization, URL or locale', async t => {
  environment(t, {
    BILLY_ACCESS_TOKEN: 'synthetic-global-token',
    BILLY_ORGANIZATION_ID: 'wrong-global-organization',
    BILLY_BASE_URL: 'https://wrong-global-host.invalid/api',
    BILLY_LOCALE: 'wrong-global-locale',
  });
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://api.billysbilling.com');
    assert.equal(url.pathname, '/v2/organizations');
    assert.ok(headers.get('X-Access-Token') === 'synthetic-explicit-token', 'The explicit client credential must be used');
    assert.equal(headers.get('Accept-Language'), null);
    return Response.json({ organizations: [{ id: 'resolved-explicit-organization' }] });
  });
  const client = new BillyClient({ accessToken: 'synthetic-explicit-token', readOnly: true });
  assert.equal(await client.getOrganizationId(), 'resolved-explicit-organization');
  assert.equal(outbound.mock.callCount(), 1);
});

test('an empty explicitly supplied token cannot fall back to process credentials', t => {
  environment(t, { BILLY_ACCESS_TOKEN: 'synthetic-global-token' });
  assert.throws(() => new BillyClient({ accessToken: '', readOnly: true }), /token|access|configuration/i);
});

test('the existing no-argument client still reads local stdio configuration', async t => {
  environment(t, {
    BILLY_ACCESS_TOKEN: 'synthetic-stdio-token',
    BILLY_ORGANIZATION_ID: 'stdio-organization',
    BILLY_BASE_URL: 'https://stdio-test.invalid/v2/',
    BILLY_LOCALE: 'da_DK',
  });
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.href, 'https://stdio-test.invalid/v2/accounts');
    assert.ok(headers.get('X-Access-Token') === 'synthetic-stdio-token', 'Local stdio configuration remains available');
    assert.equal(headers.get('Accept-Language'), 'da_DK');
    return Response.json({ accounts: [] });
  });
  const client = new BillyClient();
  assert.equal(await client.getOrganizationId(), 'stdio-organization');
  assert.deepEqual(await client.get('/accounts'), { accounts: [] });
});

test('request cancellation reaches the outbound Billy request', async t => {
  const controller = new AbortController();
  let capturedSignal: AbortSignal | null | undefined;
  let rejectRequest: ((reason: unknown) => void) | undefined;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    capturedSignal = init?.signal;
    assert.ok(capturedSignal, 'Billy fetch must receive the request cancellation signal');
    return new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
      capturedSignal!.addEventListener('abort', () => reject(new Error('synthetic request cancelled')), { once: true });
    });
  });
  const client = new BillyClient({ accessToken: 'synthetic-test-token', readOnly: true, signal: controller.signal });
  const pending = client.get('/accounts');
  controller.abort();
  try {
    await assert.rejects(pending, /cancel|abort/i);
    assert.equal(capturedSignal?.aborted, true);
  } finally {
    rejectRequest?.(new Error('test cleanup'));
  }
});
