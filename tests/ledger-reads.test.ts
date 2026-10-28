import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.js';

const origin = 'https://billy-worker.test';
const env = {
  BILLY_ACCESS_TOKEN: 'synthetic-ledger-test-token',
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
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const messages = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? responseText.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(responseText)];
  const message = messages.find(message => message.id === id);
  assert.ok(message, 'MCP must answer the requested JSON-RPC id');
  return message;
}

async function callTool(name: string, arguments_: Record<string, unknown> = {}) {
  return rpc('tools/call', { name, arguments: arguments_ });
}

function body(message: any) {
  assert.equal(message.error, undefined);
  assert.notEqual(message.result?.isError, true, JSON.stringify(message.result));
  return JSON.parse(message.result.content[0].text);
}

function rejected(message: any) {
  assert.ok(message.error || message.result?.isError === true, 'The tool must report an error');
}

function apiUrl(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.billysbilling.com');
  assert.equal(init?.method, 'GET');
  assert.equal(init?.redirect, 'manual');
  return url;
}

const relatedLists = [
  { tool: 'list_daybook_transaction_lines', path: '/daybookTransactionLines', key: 'daybookTransactionLines', parent: 'daybookTransactionId' },
  { tool: 'list_daybook_balance_accounts', path: '/daybookBalanceAccounts', key: 'daybookBalanceAccounts', parent: 'daybookId' },
  { tool: 'list_bank_line_subject_associations', path: '/bankLineSubjectAssociations', key: 'bankLineSubjectAssociations', parent: 'matchId' },
] as const;

const singleReads = [
  { tool: 'get_daybook_transaction', path: '/daybookTransactions', key: 'daybookTransaction' },
  { tool: 'get_transaction', path: '/transactions', key: 'transaction' },
  { tool: 'get_posting', path: '/postings', key: 'posting' },
  { tool: 'get_bank_line_match', path: '/bankLineMatches', key: 'bankLineMatch' },
] as const;

test('ledger read discovery exposes native GET tools and required parent IDs without calling Billy', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No discovery network access'); });
  const discovery = await rpc('tools/list');
  for (const definition of [
    { tool: 'list_account_groups', parent: undefined },
    { tool: 'list_account_natures', parent: undefined },
    ...relatedLists,
    ...singleReads.map(definition => ({ ...definition, parent: 'id' })),
  ]) {
    const tool = discovery.result.tools.find((entry: any) => entry.name === definition.tool);
    assert.ok(tool, `${definition.tool} must be discoverable`);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    if (definition.parent) assert.ok(tool.inputSchema.required.includes(definition.parent));
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('account reference reads preserve all native fields and paging, and natures require no organization lookup', async t => {
  let expected = 'accountGroups';
  let responseBody: Record<string, unknown>;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, `/v2/${expected}`);
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('pageSize'), '3');
    assert.equal(url.searchParams.get('organizationId'), expected === 'accountGroups' ? env.BILLY_ORGANIZATION_ID : null);
    responseBody = {
      meta: { paging: { page: 2, pageSize: 3, pageCount: 3, total: 8 }, trace: 'native-trace' },
      [expected]: [{ id: 'reference-one', ...(expected === 'accountGroups' ? { organizationId: env.BILLY_ORGANIZATION_ID } : {}),
        reportType: 'income', normalBalance: 'credit', sumFrom: 1000, customField: { nested: true } }],
      nativeAdditional: ['preserved'],
    };
    return Response.json(responseBody);
  });
  for (expected of ['accountGroups', 'accountNatures']) {
    const actual = body(await callTool(expected === 'accountGroups' ? 'list_account_groups' : 'list_account_natures', { page: 2, pageSize: 3 }));
    assert.deepEqual(actual, responseBody!);
  }
  assert.equal(outbound.mock.callCount(), 2, 'Each read fetches exactly one requested page');
});

test('ledger relation reads send the parent filter and return exactly the native page without analysis or fanout', async t => {
  let expected: typeof relatedLists[number] = relatedLists[0];
  let responseBody: Record<string, unknown>;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, `/v2${expected.path}`);
    assert.equal(url.searchParams.get(expected.parent), 'parent-one');
    assert.equal(url.searchParams.get('page'), '4');
    assert.equal(url.searchParams.get('pageSize'), '2');
    responseBody = {
      meta: { paging: { page: 4, pageSize: 2, pageCount: 5, total: 9 } },
      [expected.key]: [{ id: 'native-row', [expected.parent]: 'parent-one',
        accountId: 'account-one', amount: 123.456, baseAmount: 456.789,
        taxRateId: 'tax-one', contraAccountId: 'contra-one', currencyId: 'USD',
        subjectReference: 'bill:bill-one', customPayload: { preserved: true } }],
      sideLoadedResource: [{ arbitrary: 'preserved' }],
    };
    return Response.json(responseBody);
  });
  for (expected of relatedLists) {
    const actual = body(await callTool(expected.tool, { [expected.parent]: ' parent-one ', page: 4, pageSize: 2 }));
    assert.deepEqual(actual, responseBody!);
  }
  assert.equal(outbound.mock.callCount(), relatedLists.length);
});

test('ledger native reads reject missing, blank and path-like identifiers before a Billy request', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Invalid IDs must not reach Billy'); });
  const definitions = [...relatedLists.map(item => ({ tool: item.tool, field: item.parent })),
    ...singleReads.map(item => ({ tool: item.tool, field: 'id' }))];
  for (const { tool, field } of definitions) {
    for (const value of [undefined, '', ' \t ', '.', '..', '../other', 'a/b', 'a\\b', 'a?b', 'a#b', 'a b']) {
      rejected(await callTool(tool, value === undefined ? {} : { [field]: value }));
    }
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('ledger relation reads reject wrong-parent and malformed results instead of hiding data with local filters', async t => {
  let expected: typeof relatedLists[number] = relatedLists[0];
  let responseBody: unknown;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, `/v2${expected.path}`);
    return Response.json(responseBody);
  });
  for (expected of relatedLists) {
    for (responseBody of [
      {},
      { [expected.key]: null },
      { [expected.key]: [null] },
      { [expected.key]: [{ id: 'wrong-parent', [expected.parent]: 'another-parent' }] },
    ]) {
      rejected(await callTool(expected.tool, { [expected.parent]: 'parent-one' }));
    }
  }
});

test('ledger single-record reads encode validated IDs and preserve the full payload in one GET', async t => {
  let expected: typeof singleReads[number] = singleReads[0];
  const id = 'known:id+part';
  let responseBody: Record<string, unknown>;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, `/v2${expected.path}/${encodeURIComponent(id)}`);
    assert.equal(url.search, '');
    responseBody = {
      meta: { nativeTrace: 'unchanged' },
      [expected.key]: { id, createdTime: '2026-10-01T12:00:00', isApproved: false,
        isVoided: true, amount: 12.345, nativeNested: { values: [1, 2, 3] } },
      additionalResource: [{ keep: true }],
    };
    return Response.json(responseBody);
  });
  for (expected of singleReads) {
    assert.deepEqual(body(await callTool(expected.tool, { id: ` ${id} ` })), responseBody!);
  }
  assert.equal(outbound.mock.callCount(), singleReads.length);
});

test('ledger single-record reads reject mismatched IDs and preserve Billy API failures', async t => {
  let expected: typeof singleReads[number] = singleReads[0];
  let responseBody: unknown;
  let status = 200;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, `/v2${expected.path}/known-id`);
    return Response.json(responseBody, { status });
  });
  for (expected of singleReads) {
    for (responseBody of [{}, { [expected.key]: [] }, { [expected.key]: { id: 'another-id' } }]) {
      rejected(await callTool(expected.tool, { id: 'known-id' }));
    }
  }
  status = 403;
  responseBody = { errorCode: 'ACCESS_RESTRICTED', errorMessage: 'Denied by Billy' };
  const failure = await callTool(expected.tool, { id: 'known-id' });
  rejected(failure);
  assert.match(failure.result.content[0].text, /failed with 403/);
  assert.equal(outbound.mock.callCount(), singleReads.length * 3 + 1, 'Failures must not trigger fallback reads');
});

test('account group reads reject a returned organization mismatch', async t => {
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, '/v2/accountGroups');
    return Response.json({ accountGroups: [{ id: 'other-company-group', organizationId: 'other-company' }] });
  });
  rejected(await callTool('list_account_groups'));
});
