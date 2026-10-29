import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.js';

const env = {
  BILLY_ACCESS_TOKEN: 'synthetic-document-read-token',
  ALLOWED_EMAILS: 'reader@example.invalid',
  BILLY_ORGANIZATION_ID: 'test-organization',
};
const context = {
  access: { getIdentity: async () => ({ email: 'reader@example.invalid' }) },
  waitUntil: (_promise: Promise<unknown>) => {},
  passThroughOnException: () => {},
};
let sequence = 0;

async function callTool(name: string, arguments_: Record<string, unknown> = {}) {
  const id = ++sequence;
  const response = await worker.fetch(new Request('https://billy-worker.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: arguments_ } }),
  }), env, context);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const messages = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? body.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(body)];
  const message = messages.find(message => message.id === id);
  assert.ok(message, 'The requested MCP call must return a response');
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

const cases = [
  { name: 'list_invoice_lines', resource: 'invoiceLines', parent: 'invoiceId', organization: false },
  { name: 'list_bill_lines', resource: 'billLines', parent: 'billId', organization: false },
  { name: 'list_contact_balance_postings', resource: 'contactBalancePostings', parent: 'contactId', organization: false },
  { name: 'list_contact_balance_payments', resource: 'contactBalancePayments', parent: 'contactId', organization: true },
  { name: 'list_invoice_late_fees', resource: 'invoiceLateFees', parent: 'invoiceId', organization: false },
  { name: 'list_invoice_reminders', resource: 'invoiceReminders', parent: null, organization: true },
  { name: 'list_invoice_reminder_associations', resource: 'invoiceReminderAssociations', parent: 'reminderId', organization: false },
  { name: 'list_invoice_logs', resource: 'invoiceLogs', parent: 'invoiceId', organization: true },
] as const;

test('document readers preserve complete source records and pagination with one GET per page', async t => {
  let expected: typeof cases[number] = cases[0];
  let source: Record<string, unknown> = {};
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/' + expected.resource);
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('pageSize'), '7');
    assert.equal(url.searchParams.get('organizationId'), expected.organization ? env.BILLY_ORGANIZATION_ID : null);
    if (expected.parent) assert.equal(url.searchParams.get(expected.parent), 'parent-id');
    if (expected.name === 'list_invoice_logs') {
      assert.equal(url.searchParams.get('sortProperty'), 'eventTime');
      assert.equal(url.searchParams.get('sortDirection'), 'DESC');
    }
    return Response.json(source);
  });
  for (expected of cases) {
    const row = {
      id: 'source-id',
      ...(expected.parent ? { [expected.parent]: 'parent-id' } : {}),
      ...(expected.organization ? { organizationId: env.BILLY_ORGANIZATION_ID } : {}),
      amount: 123.45678,
      balance: -17.23,
      taxRateId: 'source-tax-rate',
      tax: 24.321,
      currencyId: 'EUR',
      isVoided: true,
      side: 'credit',
      sourceExtension: { nested: ['retained', 42] },
      downloadUrl: 'https://download.example.invalid/document?token=synthetic',
    };
    source = {
      meta: { success: true, paging: { page: 2, pageSize: 7, pageCount: 3, total: 15 }, sourceTimestamp: '2026-01-01T12:00:00Z' },
      [expected.resource]: [row],
      extraSourceData: [{ id: 'sideloaded-item' }],
    };
    const body = successfulBody(await callTool(expected.name, {
      ...(expected.parent ? { [expected.parent]: '  parent-id  ' } : {}), page: 2, pageSize: 7,
    }));
    assert.deepEqual(body, source, 'The tool must not sum, round, classify, compact, or replace source data');
  }
  assert.equal(outbound.mock.callCount(), cases.length, 'Only each requested page is fetched; download links are never followed');
});

test('required parent IDs are rejected before any request when missing or blank', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Invalid inputs must not reach Billy');
  });
  for (const spec of cases) {
    if (!spec.parent) continue;
    for (const arguments_ of [{}, { [spec.parent]: '' }, { [spec.parent]: ' \t ' }]) {
      assertRejected(await callTool(spec.name, arguments_));
    }
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('each documented parent filter is verified on returned document records', async t => {
  let current: typeof cases[number] = cases[0];
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, '/v2/' + current.resource);
    return Response.json({
      meta: { paging: { page: 1, pageSize: 50, pageCount: 1, total: 1 } },
      [current.resource]: [{
        id: 'wrong-source',
        ...(current.parent ? { [current.parent]: 'different-parent' } : {}),
        organizationId: current.parent ? env.BILLY_ORGANIZATION_ID : 'different-organization',
      }],
    });
  });
  for (current of cases) {
    const result = await callTool(current.name, current.parent ? { [current.parent]: 'requested-parent' } : {});
    assertRejected(result);
    assert.match(result.result.content[0].text, /outside the requested .* filter/);
  }
  assert.equal(outbound.mock.callCount(), cases.length);
});

test('contact-balance payments also reject another organization when that field is supplied', async t => {
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    apiUrl(input, init);
    return Response.json({ contactBalancePayments: [{ id: 'payment', contactId: 'contact', organizationId: 'other-organization' }] });
  });
  assertRejected(await callTool('list_contact_balance_payments', { contactId: 'contact' }));
});

test('malformed document pages are errors and are never replaced by empty or calculated results', async t => {
  let payload: unknown;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    apiUrl(input, init);
    return Response.json(payload);
  });
  for (payload of [null, {}, { invoiceLines: null }, { invoiceLines: [null] }, { invoiceLines: ['invalid'] }, { invoiceLines: [{ id: 'missing-parent' }] }]) {
    assertRejected(await callTool('list_invoice_lines', { invoiceId: 'invoice' }));
  }
});

test('native Billy errors are preserved without fallback calls or empty-success substitution', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, '/v2/invoiceReminderAssociations');
    return Response.json({ errorCode: 'ACCESS_RESTRICTED', errorMessage: 'Synthetic access refusal' }, { status: 403 });
  });
  const result = await callTool('list_invoice_reminder_associations', { reminderId: 'reminder' });
  assertRejected(result);
  assert.match(result.result.content[0].text, /\/invoiceReminderAssociations failed with 403/);
  assert.equal(outbound.mock.callCount(), 1);
});

test('invoice logs retain documented event rows without invented parent or delivery conclusions', async t => {
  const source = {
    meta: { paging: { page: 1, pageSize: 50, pageCount: 1, total: 1 } },
    invoiceLogs: [{ type: 'failed', message: 'Synthetic source message', messageKey: 'synthetic_source_key', eventTime: '2026-10-20T12:00:00' }],
  };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.searchParams.get('pageSize'), '50');
    assert.equal(url.searchParams.get('invoiceId'), 'invoice');
    assert.equal(url.searchParams.get('organizationId'), env.BILLY_ORGANIZATION_ID);
    return Response.json(source);
  });
  assert.deepEqual(successfulBody(await callTool('list_invoice_logs', { invoiceId: 'invoice' })), source);
  assert.equal(outbound.mock.callCount(), 1);
});

test('empty source pages remain empty with original paging and status', async t => {
  const source = { meta: { statusCode: 200, success: true, paging: { page: 1, pageSize: 50, pageCount: 0, total: 0 } }, contactBalancePostings: [] };
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.searchParams.get('contactId'), 'contact');
    return Response.json(source);
  });
  assert.deepEqual(successfulBody(await callTool('list_contact_balance_postings', { contactId: 'contact' })), source);
});
