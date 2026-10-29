import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.js';

const origin = 'https://billy-worker.test';
const env = {
  BILLY_ACCESS_TOKEN: 'synthetic-tax-read-token',
  ALLOWED_EMAILS: 'allowed@example.invalid',
  BILLY_ORGANIZATION_ID: 'test-organization',
};
const context = {
  access: { getIdentity: async () => ({ email: 'allowed@example.invalid' }) },
  waitUntil: (_promise: Promise<unknown>) => {},
  passThroughOnException: () => {},
};
let sequence = 0;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const id = ++sequence;
  const response = await worker.fetch(new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }), env, context);
  const raw = await response.text();
  assert.equal(response.status, 200, raw);
  const messages = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(raw)];
  const message = messages.find(message => message.id === id);
  assert.ok(message);
  return message;
}

function successfulBody(message: any) {
  assert.equal(message.error, undefined);
  assert.notEqual(message.result?.isError, true, JSON.stringify(message.result));
  return JSON.parse(message.result.content[0].text);
}

function assertRejected(message: any) {
  assert.ok(message.error || message.result?.isError === true, 'The tool must report an error');
}

function apiUrl(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.billysbilling.com');
  assert.equal(init?.method, 'GET');
  assert.equal(init?.redirect, 'manual');
  return url;
}

const organizationLists = [
  ['list_tax_rates', 'taxRates'],
  ['list_sales_tax_accounts', 'salesTaxAccounts'],
  ['list_sales_tax_meta_fields', 'salesTaxMetaFields'],
  ['list_sales_tax_returns', 'salesTaxReturns'],
  ['list_sales_tax_rulesets', 'salesTaxRulesets'],
];

for (const [tool, resource] of organizationLists) {
  test(`${tool} preserves the full native page and uses the connected organization`, async t => {
    const data = {
      meta: {
        success: true,
        paging: { page: 2, pageSize: 1, pageCount: 3, total: 3, nextUrl: 'https://example.invalid/next' },
        additionalMetadata: { preserved: true },
      },
      [resource]: [{
        id: 'native-record', organizationId: env.BILLY_ORGANIZATION_ID,
        rate: 0.25, configuredShare: 0.3725,
        report: { originalAmount: 123.456, fields: [{ label: 'Native report field', amount: 12.345 }] },
        corrections: [{ original: true }], extraField: 'preserved',
      }],
      relatedNativeRecords: [{ id: 'related-record' }],
    };
    const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = apiUrl(input, init);
      assert.equal(url.pathname, '/v2/' + resource);
      assert.equal(url.searchParams.get('organizationId'), env.BILLY_ORGANIZATION_ID);
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('pageSize'), '1');
      return Response.json(data);
    });
    const body = successfulBody(await rpc('tools/call', { name: tool, arguments: { page: 2, pageSize: 1 } }));
    assert.deepEqual(body, data, 'All fields, original amounts, related records and metadata must be unchanged');
    assert.equal(outbound.mock.callCount(), 1, 'A list tool retrieves exactly one requested page');
  });
}

const parentLists = [
  { tool: 'list_tax_rate_deduction_components', resource: 'taxRateDeductionComponents', field: 'taxRateId', rowField: 'taxRateId' },
  { tool: 'list_sales_tax_payments', resource: 'salesTaxPayments', field: 'returnId', rowField: 'salesTaxReturnId' },
  { tool: 'list_sales_tax_rules', resource: 'salesTaxRules', field: 'rulesetId', rowField: 'rulesetId' },
];

for (const { tool, resource, field, rowField } of parentLists) {
  test(`${tool} sends its required parent filter and returns the native page`, async t => {
    const data = {
      meta: { statusCode: 200, paging: { page: 1, pageSize: 50, pageCount: 1, total: 1 } },
      [resource]: [{ id: 'child', [rowField]: 'parent-id', amount: 1.2345, isVoided: true, extra: { preserved: true } }],
    };
    const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = apiUrl(input, init);
      assert.equal(url.pathname, '/v2/' + resource);
      assert.equal(url.searchParams.get(field), 'parent-id');
      assert.equal(url.searchParams.get('pageSize'), '50');
      if (tool === 'list_sales_tax_payments') {
        assert.equal(url.searchParams.has('salesTaxReturnId'), false, 'Billy requires returnId as the query parameter');
      }
      return Response.json(data);
    });
    const body = successfulBody(await rpc('tools/call', { name: tool, arguments: { [field]: ' parent-id ' } }));
    assert.deepEqual(body, data);
    assert.equal(outbound.mock.callCount(), 1);
  });
}

test('get_sales_tax_return preserves the original report, corrections and metadata', async t => {
  const id = 'return:one';
  const data = {
    meta: { success: true, statusCode: 200, nativeExtra: true },
    salesTaxReturn: {
      id, organizationId: env.BILLY_ORGANIZATION_ID, isSettled: true, isPaid: false,
      report: { nativeRows: [{ amount: 12.3456, original: true }] },
      corrections: [{ amount: -0.0123 }], totalAmount: 12.3333,
    },
  };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/salesTaxReturns/return%3Aone');
    assert.equal(url.search, '');
    return Response.json(data);
  });
  const body = successfulBody(await rpc('tools/call', { name: 'get_sales_tax_return', arguments: { id: ' return:one ' } }));
  assert.deepEqual(body, data);
  assert.equal(outbound.mock.callCount(), 1);
});

test('list_currencies reads one global page without performing conversion or organization lookup', async t => {
  const data = {
    meta: { paging: { page: 3, pageSize: 2, pageCount: 8, total: 16 } },
    currencies: [{ id: 'SYN', name: 'Synthetic currency', exchangeRate: 1.234567, nativeProperty: true }],
  };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/currencies');
    assert.equal(url.searchParams.has('organizationId'), false);
    assert.equal(url.searchParams.get('page'), '3');
    assert.equal(url.searchParams.get('pageSize'), '2');
    return Response.json(data);
  });
  assert.deepEqual(successfulBody(await rpc('tools/call', {
    name: 'list_currencies', arguments: { page: 3, pageSize: 2 },
  })), data);
  assert.equal(outbound.mock.callCount(), 1);
});

test('tax read tool discovery requires parent IDs and declares read-only access', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Discovery must not access Billy');
  });
  const tools = (await rpc('tools/list')).result.tools;
  const names = [...organizationLists.map(([name]) => name), ...parentLists.map(entry => entry.tool), 'get_sales_tax_return', 'list_currencies'];
  for (const name of names) {
    const definition = tools.find((entry: any) => entry.name === name);
    assert.ok(definition, name + ' must be discoverable');
    assert.equal(definition.annotations.readOnlyHint, true);
    assert.equal(definition.annotations.destructiveHint, false);
  }
  for (const { tool, field } of parentLists) {
    assert.ok(tools.find((entry: any) => entry.name === tool).inputSchema.required.includes(field));
  }
  assert.ok(tools.find((entry: any) => entry.name === 'get_sales_tax_return').inputSchema.required.includes('id'));
  assert.equal(outbound.mock.callCount(), 0);
});

test('missing, blank, path-like IDs and invalid pagination fail before Billy access', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Invalid parameters must not access Billy');
  });
  for (const { tool, field } of [...parentLists, { tool: 'get_sales_tax_return', field: 'id' }]) {
    for (const value of [undefined, '', ' \t ', '..', 'path/segment', 'path\\segment', 'id?query', 'id#fragment']) {
      assertRejected(await rpc('tools/call', { name: tool, arguments: value === undefined ? {} : { [field]: value } }));
    }
  }
  for (const args of [{ page: 0 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 1001 }]) {
    assertRejected(await rpc('tools/call', { name: 'list_tax_rates', arguments: args }));
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('unexpected organization or parent references produce errors without hiding records', async t => {
  let data: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    apiUrl(input, init);
    return Response.json(data);
  });
  for (const [tool, resource] of organizationLists) {
    data = { [resource]: [{ id: 'correct', organizationId: env.BILLY_ORGANIZATION_ID }, { id: 'wrong', organizationId: 'another-organization' }] };
    assertRejected(await rpc('tools/call', { name: tool, arguments: {} }));
  }
  for (const { tool, resource, field, rowField } of parentLists) {
    data = { [resource]: [{ id: 'wrong-parent', [rowField]: 'another-parent' }] };
    assertRejected(await rpc('tools/call', { name: tool, arguments: { [field]: 'parent-id' } }));
    data = { [resource]: [{ id: 'wrong-organization', [rowField]: 'parent-id', organizationId: 'another-organization' }] };
    assertRejected(await rpc('tools/call', { name: tool, arguments: { [field]: 'parent-id' } }));
  }
  data = { salesTaxPayments: [{ id: 'wrong-return', returnId: 'another-parent' }] };
  assertRejected(await rpc('tools/call', { name: 'list_sales_tax_payments', arguments: { returnId: 'parent-id' } }));
});

test('malformed native lists and mismatched single returns are errors', async t => {
  let data: unknown = {};
  t.mock.method(globalThis, 'fetch', async () => Response.json(data));
  for (data of [null, {}, { taxRates: {} }, { taxRates: [null] }]) {
    assertRejected(await rpc('tools/call', { name: 'list_tax_rates', arguments: {} }));
  }
  for (data of [
    {}, { salesTaxReturn: null }, { salesTaxReturn: { id: 'different-return' } },
    { salesTaxReturn: { id: 'requested-return', organizationId: 'another-organization' } },
  ]) {
    assertRejected(await rpc('tools/call', { name: 'get_sales_tax_return', arguments: { id: 'requested-return' } }));
  }
});

test('empty native results and original API errors remain distinguishable', async t => {
  let fail = false;
  const empty = { meta: { success: true, paging: { page: 1, pageSize: 50, pageCount: 0, total: 0 } }, salesTaxPayments: [] };
  const outbound = t.mock.method(globalThis, 'fetch', async () => fail
    ? Response.json({ errorCode: 'ACCESS_RESTRICTED', errorMessage: 'Synthetic denial' }, { status: 403 })
    : Response.json(empty));
  assert.deepEqual(successfulBody(await rpc('tools/call', {
    name: 'list_sales_tax_payments', arguments: { returnId: 'period-id' },
  })), empty);
  fail = true;
  const message = await rpc('tools/call', { name: 'list_sales_tax_payments', arguments: { returnId: 'period-id' } });
  assertRejected(message);
  assert.match(message.result.content[0].text, /GET \/salesTaxPayments failed with 403/);
  assert.match(message.result.content[0].text, /ACCESS_RESTRICTED/);
  assert.equal(outbound.mock.callCount(), 2, 'No fallback query or automatic retry may disguise the native result');
});
