import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.js';

const origin = 'https://billy-worker.test';
const env = {
  BILLY_ACCESS_TOKEN: 'synthetic-filter-test-token',
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
  const response = await worker.fetch(new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }), env, context);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const messages = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(text)];
  const message = messages.find(message => message.id === id);
  assert.ok(message, 'MCP must return a result for the requested JSON-RPC id');
  return message;
}

const cases = [
  {
    tool: 'list_bank_lines',
    field: 'accountId',
    value: 'test-bank-account',
    path: '/bankLines',
    resultKey: 'bankLines',
    row: { id: 'test-bank-line', accountId: 'test-bank-account' },
  },
  {
    tool: 'list_bank_line_matches',
    field: 'accountId',
    value: 'test-bank-account',
    path: '/bankLineMatches',
    resultKey: 'bankLineMatches',
    row: { id: 'test-bank-match', accountId: 'test-bank-account' },
  },
  {
    tool: 'list_balance_modifiers',
    field: 'subjectReference',
    value: 'bill:test-bill',
    path: '/balanceModifiers',
    resultKey: 'balanceModifiers',
    row: { id: 'test-payment-association', subjectReference: 'bill:test-bill' },
  },
];

test('MCP discovery declares the required bank and payment-reference filters', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Tool discovery must not call Billy');
  });
  const message = await rpc('tools/list');
  assert.ok(Array.isArray(message.result?.tools));
  for (const { tool, field } of cases) {
    const definition = message.result.tools.find((entry: any) => entry.name === tool);
    assert.ok(definition, `${tool} must be discoverable`);
    assert.ok(definition.inputSchema.required?.includes(field), `${tool} must require ${field}`);
  }
  assert.equal(outbound.mock.callCount(), 0);
});

for (const { tool, field, value, path, resultKey, row } of cases) {
  test(`${tool} rejects a missing, empty or whitespace-only ${field} before fetching`, async t => {
    const outbound = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('Invalid filters must be rejected before calling Billy');
    });
    for (const arguments_ of [{}, { [field]: '' }, { [field]: ' \t\n ' }]) {
      const message = await rpc('tools/call', { name: tool, arguments: arguments_ });
      assert.ok(message.error || message.result?.isError === true, `${tool} must reject invalid ${field}`);
    }
    assert.equal(outbound.mock.callCount(), 0);
  });

  test(`${tool} sends a valid required filter and returns its matching record`, async t => {
    const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.billysbilling.com');
      assert.equal(url.pathname, `/v2${path}`);
      assert.equal(url.searchParams.get(field), value);
      assert.equal(url.searchParams.get('pageSize'), '1');
      assert.equal(init?.method, 'GET');
      return Response.json({ [resultKey]: [row] });
    });
    const message = await rpc('tools/call', {
      name: tool,
      arguments: { [field]: ` ${value} `, pageSize: 1 },
    });
    assert.equal(message.error, undefined);
    assert.notEqual(message.result?.isError, true);
    const body = JSON.parse(message.result.content[0].text);
    assert.deepEqual(body[resultKey], [row]);
    assert.equal(outbound.mock.callCount(), 1);
  });
}
