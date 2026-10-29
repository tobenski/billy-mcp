import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.js';

const env = { BILLY_ACCESS_TOKEN: 'synthetic-data-test-token', ALLOWED_EMAILS: 'reader@example.invalid', BILLY_ORGANIZATION_ID: 'org-test' };
const context = { access: { getIdentity: async () => ({ email: 'reader@example.invalid' }) }, waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} };
let sequence = 0;

async function call(name: string, args: Record<string, unknown>) {
  const id = ++sequence;
  const res = await worker.fetch(new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  }), env, context);
  assert.equal(res.status, 200);
  const raw = await res.text();
  const messages = res.headers.get('Content-Type')?.includes('text/event-stream')
    ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
    : [JSON.parse(raw)];
  const message = messages.find(m => m.id === id);
  assert.ok(message);
  return message;
}

function body(message: any) {
  assert.equal(message.error, undefined);
  assert.notEqual(message.result?.isError, true, JSON.stringify(message.result));
  return JSON.parse(message.result.content[0].text);
}

function urlOf(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.billysbilling.com');
  assert.equal(init?.method, 'GET');
  assert.equal(init?.redirect, 'manual');
  return url;
}

const paging = { page: 2, pageSize: 1, pageCount: 3, total: 3, nextUrl: 'https://api.billysbilling.com/v2/example?page=3' };

test('native posting filters are forwarded and source amounts and metadata are not calculated', async t => {
  const posting = { id: 'post-1', accountId: 'account-1', entryDate: '2026-01-15', isVoided: false, isBankMatched: true, amount: 123.4567, side: 'credit', currencyId: 'EUR', sourceExtra: { a: 1 } };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = urlOf(input, init);
    assert.equal(url.pathname, '/v2/postings');
    for (const [key, value] of Object.entries({ accountId: 'account-1', minEntryDate: '2026-01-01', maxEntryDate: '2026-01-31', entryDatePeriod: 'month:2026-01', isVoided: 'false', isBankMatched: 'true', isNotZero: 'true', q: 'native search', page: '2', pageSize: '1' })) assert.equal(url.searchParams.get(key), value);
    return Response.json({ meta: { paging }, postings: [posting], nativeExtra: 'preserved' });
  });
  const result = body(await call('list_postings', { accountId: 'account-1', minEntryDate: '2026-01-01', maxEntryDate: '2026-01-31', entryDatePeriod: 'month:2026-01', isVoided: false, isBankMatched: true, isNotZero: true, q: 'native search', page: 2, pageSize: 1, verbose: true }));
  assert.deepEqual(result.postings, [posting]);
  assert.deepEqual(result.meta.paging, paging);
  assert.equal(result.nativeExtra, 'preserved');
  assert.equal(result.totals, undefined);
  assert.deepEqual(result.appliedFilters.clientSide, []);
  assert.equal(outbound.mock.callCount(), 1);
});

test('posting filter violations fail instead of hiding source records', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ meta: { paging }, postings: [{ id: 'wrong-date', accountId: 'account-1', entryDate: '2025-12-31' }] }));
  const result = await call('list_postings', { minEntryDate: '2026-01-01' });
  assert.equal(result.result?.isError, true);
});

test('bank source filters and balances are preserved without computing reconciliation', async t => {
  const line = { id: 'line-1', accountId: 'bank-1', entryDate: '2026-02-04', amount: 19.995, balance: 700.005, side: 'debit', matchId: 'match-1', status: 'booked', receiptState: 'missing_receipt', extra: 'native' };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = urlOf(input, init);
    assert.equal(url.pathname, '/v2/bankLines');
    for (const [key, value] of Object.entries({ accountId: 'bank-1', minEntryDate: '2026-02-01', maxEntryDate: '2026-02-28', isReconciled: 'false', status: 'booked', receiptState: 'missing_receipt', minAmount: '1', maxAmount: '25', q: 'receipt', sortProperty: 'entryDate', sortDirection: 'ASC' })) assert.equal(url.searchParams.get(key), value);
    return Response.json({ meta: { paging }, bankLines: [line] });
  });
  const result = body(await call('list_bank_lines', { accountId: 'bank-1', minEntryDate: '2026-02-01', maxEntryDate: '2026-02-28', isReconciled: false, status: 'booked', receiptState: 'missing_receipt', minAmount: 1, maxAmount: 25, q: 'receipt', sortProperty: 'entryDate', sortDirection: 'ASC', verbose: true }));
  assert.deepEqual(result.bankLines, [line]);
  assert.deepEqual(result.meta.paging, paging);
  assert.equal(result.totals, undefined);
  assert.equal(result.reconciled, undefined);
  assert.equal(outbound.mock.callCount(), 1);
});

test('invoice and bill source filters include credit references and attachment presence', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = urlOf(input, init);
    const invoices = url.pathname === '/v2/invoices';
    assert.ok(invoices || url.pathname === '/v2/bills');
    assert.equal(url.searchParams.get('currencyId'), 'EUR');
    assert.equal(url.searchParams.get('minDueDate'), '2026-01-01');
    assert.equal(url.searchParams.get('maxDueDate'), '2026-01-31');
    assert.equal(url.searchParams.get(invoices ? 'creditedInvoiceId' : 'creditedBillId'), 'source-doc');
    if (invoices) assert.equal(url.searchParams.get('entryDatePeriod'), 'year:2026');
    else assert.equal(url.searchParams.get('hasAttachments'), 'false');
    const key = invoices ? 'invoices' : 'bills';
    return Response.json({ meta: { paging }, [key]: [{ id: 'credit-1', type: 'creditNote', balance: 7.123, nativeExtra: 'preserved' }] });
  });
  for (const kind of ['invoice', 'bill']) {
    const result = body(await call(kind === 'invoice' ? 'list_invoices' : 'list_bills', { currencyId: 'EUR', minDueDate: '2026-01-01', maxDueDate: '2026-01-31', ...(kind === 'invoice' ? { creditedInvoiceId: 'source-doc', entryDatePeriod: 'year:2026' } : { creditedBillId: 'source-doc', hasAttachments: false }), verbose: true }));
    assert.equal(result[kind === 'invoice' ? 'invoices' : 'bills'][0].balance, 7.123);
    assert.equal(result[kind === 'invoice' ? 'invoices' : 'bills'][0].nativeExtra, 'preserved');
    assert.deepEqual(result.meta.paging, paging);
  }
  assert.equal(outbound.mock.callCount(), 2);
});

test('document detail preserves header metadata and separate line pagination', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = urlOf(input, init);
    const invoice = url.pathname.startsWith('/v2/invoice');
    const singular = invoice ? 'invoice' : 'bill';
    if (url.pathname.endsWith('Lines')) {
      assert.equal(url.searchParams.get(singular + 'Id'), 'doc-1');
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('pageSize'), '1');
      return Response.json({ meta: { paging, originalLineMeta: true }, [singular + 'Lines']: [{ id: 'line-1', [singular + 'Id']: 'doc-1', amount: 9.999, nativeLineField: 'preserved' }] });
    }
    return Response.json({ meta: { originalHeaderMeta: true }, [singular]: { id: 'doc-1', balance: 1.234 }, nativeSideload: [{ id: 'side-1' }] });
  });
  for (const kind of ['invoice', 'bill']) {
    const result = body(await call('get_' + kind, { id: 'doc-1', linePage: 2, linePageSize: 1 }));
    assert.deepEqual(result.meta, { originalHeaderMeta: true });
    assert.deepEqual(result.nativeSideload, [{ id: 'side-1' }]);
    assert.deepEqual(result[kind + 'LinesMeta'], { paging, originalLineMeta: true });
    assert.equal(result[kind + 'Lines'][0].amount, 9.999);
    assert.equal(result[kind].balance, 1.234);
  }
  assert.equal(outbound.mock.callCount(), 4);
});

test('document detail rejects invalid IDs and mismatched line parents', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    requests++;
    const url = urlOf(input, init);
    return Response.json(url.pathname.endsWith('Lines') ? { invoiceLines: [{ id: 'line-1', invoiceId: 'another-invoice' }] } : { invoice: { id: 'doc-1' } });
  });
  for (const name of ['get_invoice', 'get_bill']) for (const id of ['', ' ', '../other', 'a?b']) {
    const result = await call(name, { id });
    assert.ok(result.error || result.result?.isError);
  }
  assert.equal(requests, 0);
  assert.equal((await call('get_invoice', { id: 'doc-1' })).result?.isError, true);
  assert.equal(requests, 2);
});

test('attachment source duplicate and document filters are forwarded without duplicate detection', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = urlOf(input, init);
    for (const [key, value] of Object.entries({ type: 'Upload', supplier: 'Synthetic Supplier', amount: '12.345', documentDatePeriod: 'month:2026-01', isDuplicate: 'true', eInvoiceFilter: 'BLOCKED', q: 'receipt', sortProperty: 'documentDate', sortDirection: 'ASC' })) assert.equal(url.searchParams.get(key), value);
    return Response.json({ meta: { paging }, attachments: [{ id: 'attachment-1', fileId: 'file-1', ownerReference: null, nativeDuplicateFlag: true }] });
  });
  const result = body(await call('list_attachments', { type: 'Upload', supplier: 'Synthetic Supplier', amount: 12.345, documentDatePeriod: 'month:2026-01', isDuplicate: true, eInvoiceFilter: 'BLOCKED', q: 'receipt', sortProperty: 'documentDate', sortDirection: 'ASC', includeFiles: false, verbose: true }));
  assert.equal(result.attachments[0].nativeDuplicateFlag, true);
  assert.deepEqual(result.meta.paging, paging);
  assert.equal(result.duplicateGroups, undefined);
  assert.equal(outbound.mock.callCount(), 1);
});
