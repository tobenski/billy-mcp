import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.js';

const origin = 'https://billy-worker.test';
const env = {
  BILLY_ACCESS_TOKEN: 'synthetic-attachment-test-token',
  ALLOWED_EMAILS: 'allowed@example.invalid',
  BILLY_ORGANIZATION_ID: 'test-organization',
};
const context = {
  access: { getIdentity: async () => ({ email: 'allowed@example.invalid' }) },
  waitUntil: (_promise: Promise<unknown>) => {},
  passThroughOnException: () => {},
};
let sequence = 0;

async function callTool(name: string, arguments_: Record<string, unknown> = {}) {
  const id = ++sequence;
  const response = await worker.fetch(new Request(origin + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name, arguments: arguments_ },
    }),
  }), env, context);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const messages = response.headers.get('Content-Type')?.includes('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()))
    : [JSON.parse(text)];
  const message = messages.find(message => message.id === id);
  assert.ok(message, 'MCP must answer the requested JSON-RPC id');
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

function apiUrl(input: Parameters<typeof fetch>[0], init?: RequestInit): URL {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.billysbilling.com');
  assert.equal(init?.method, 'GET');
  assert.equal(init?.redirect, 'manual');
  return url;
}

const file = {
  id: 'file-one',
  fileName: 'synthetic-receipt.pdf',
  fileSize: 1234,
  fileType: 'application/pdf',
  isPdf: true,
  isImage: false,
  downloadUrl: 'https://download.example.invalid/receipt.pdf?token=synthetic',
  createdTime: '2026-01-01T10:00:00',
};

test('document attachments are filtered by Billy and include matching file metadata by default', async t => {
  const attachment = {
    id: 'attachment-one', fileId: file.id, ownerReference: 'bill:test-bill', priority: 1,
  };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/attachments');
    assert.equal(url.searchParams.get('organizationId'), env.BILLY_ORGANIZATION_ID);
    assert.equal(url.searchParams.get('ownerReference'), attachment.ownerReference);
    assert.equal(url.searchParams.get('include'), 'attachment.file:sideload');
    assert.equal(url.searchParams.get('page'), '1');
    assert.equal(url.searchParams.get('pageSize'), '2');
    assert.equal(url.searchParams.has('handled'), false);
    assert.equal(url.searchParams.has('unhandled'), false);
    return Response.json({
      meta: { paging: { page: 1, pageSize: 2, pageCount: 1, total: 1 } },
      attachments: [attachment],
      files: [{ ...file, internalExtra: 'omitted-from-compact-output' }],
    });
  });
  const body = successfulBody(await callTool('list_attachments', {
    ownerReference: ' bill:test-bill ', page: 1, pageSize: 2,
  }));
  assert.deepEqual(body.attachments, [attachment]);
  assert.deepEqual(body.files, [file]);
  assert.equal(body.coverage.source, 'attachments');
  assert.equal(body.coverage.scope, 'current_page');
  assert.equal(body.coverage.allFiles, false);
  assert.equal(body.coverage.returnedAttachments, 1);
  assert.equal(body.coverage.returnedFiles, 1);
  assert.equal(body.coverage.filesCompleteForPage, true);
  assert.equal(body.coverage.hasMore, false);
  assert.equal(body.coverage.nextPage, null);
  assert.equal(outbound.mock.callCount(), 1, 'Metadata inclusion must not cause extra file or download requests');
});

test('attachment pagination preserves links while deduplicating only the referenced files on each page', async t => {
  const links = [
    { id: 'link-a', fileId: file.id, ownerReference: 'bill:document-a' },
    { id: 'link-b', fileId: file.id, ownerReference: 'invoice:document-b' },
    { id: 'link-c', fileId: file.id, ownerReference: 'daybookTransaction:document-c' },
  ];
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/attachments');
    const page = Number(url.searchParams.get('page'));
    assert.ok(page === 1 || page === 2);
    return Response.json({
      meta: { paging: { page, pageSize: 2, pageCount: 2, total: 3 } },
      attachments: page === 1 ? links.slice(0, 2) : links.slice(2),
      files: [
        file,
        { ...file },
        { ...file, id: 'unrelated-file', fileName: 'unrelated.pdf' },
      ],
    });
  });
  const first = successfulBody(await callTool('list_attachments', { page: 1, pageSize: 2 }));
  assert.deepEqual(first.attachments, links.slice(0, 2));
  assert.deepEqual(first.files, [file]);
  assert.equal(first.meta.paging.total, 3, 'The total remains a count of attachment links');
  assert.equal(first.coverage.returnedAttachments, 2);
  assert.equal(first.coverage.returnedFiles, 1);
  assert.equal(first.coverage.hasMore, true);
  assert.equal(first.coverage.nextPage, 2);
  assert.equal(first.coverage.allFiles, false);

  const second = successfulBody(await callTool('list_attachments', { page: 2, pageSize: 2 }));
  assert.deepEqual(second.attachments, links.slice(2));
  assert.deepEqual(second.files, [file], 'A file referenced on a later page must not disappear through a global cache');
  assert.equal(second.coverage.returnedAttachments, 1);
  assert.equal(second.coverage.returnedFiles, 1);
  assert.equal(second.coverage.hasMore, false);
  assert.equal(second.coverage.nextPage, null);
  assert.equal(second.coverage.allFiles, false);
  assert.equal(outbound.mock.callCount(), 2, 'One page request must make exactly one Billy request');
});

test('handled and inbox statuses are sent as documented server-side filters', async t => {
  let expectedStatus = 'handled';
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/attachments');
    assert.equal(url.searchParams.get(expectedStatus), 'true');
    assert.equal(url.searchParams.has(expectedStatus === 'handled' ? 'unhandled' : 'handled'), false);
    const ownerReference = expectedStatus === 'handled' ? 'bill:test-bill' : null;
    return Response.json({
      meta: { paging: { page: 1, pageSize: 1, pageCount: 1, total: 1 } },
      attachments: [{ id: 'status-link', fileId: file.id, ownerReference }],
      files: [file],
    });
  });
  for (expectedStatus of ['handled', 'unhandled']) {
    const body = successfulBody(await callTool('list_attachments', { status: expectedStatus, pageSize: 1 }));
    assert.equal(body.attachments.length, 1);
    assert.equal(body.attachments[0].ownerReference, expectedStatus === 'handled' ? 'bill:test-bill' : null);
    assert.deepEqual(body.files, [file]);
  }
  assert.equal(outbound.mock.callCount(), 2);
});

test('invalid owner or conflicting inbox filters are rejected before any Billy request', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Invalid attachment filters must not reach Billy');
  });
  for (const arguments_ of [
    { ownerReference: '' },
    { ownerReference: ' \t ' },
    { ownerReference: 'bill:test-bill', status: 'unhandled' },
    { status: 'unsupported-status' },
  ]) {
    assertRejected(await callTool('list_attachments', arguments_));
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('metadata can be disabled and missing pagination is reported as unknown', async t => {
  const attachment = { id: 'only-link', fileId: file.id, ownerReference: null };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/attachments');
    assert.equal(url.searchParams.has('include'), false);
    return Response.json({ attachments: [attachment], files: [file] });
  });
  const body = successfulBody(await callTool('list_attachments', { includeFiles: false, verbose: true }));
  assert.deepEqual(body.attachments, [attachment]);
  assert.equal(Object.hasOwn(body, 'files'), false);
  assert.equal(body.coverage.filesCompleteForPage, null);
  assert.equal(body.coverage.hasMore, null);
  assert.equal(body.coverage.nextPage, null);
  assert.equal(body.coverage.allFiles, false);
  assert.equal(outbound.mock.callCount(), 1);
});

test('missing file metadata is explicit and never removes an attachment or a readable file', async t => {
  const attachments = [
    { id: 'readable-link', fileId: file.id, ownerReference: 'bill:readable' },
    { id: 'missing-link-a', fileId: 'missing-file', ownerReference: 'bill:missing-a' },
    { id: 'missing-link-b', fileId: 'missing-file', ownerReference: 'invoice:missing-b' },
    { id: 'invalid-link', fileId: null, ownerReference: null },
  ];
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, '/v2/attachments');
    return Response.json({
      meta: { paging: { page: 1, pageSize: 4, pageCount: 1, total: 4 } },
      attachments,
      files: [file],
    });
  });
  const body = successfulBody(await callTool('list_attachments', { pageSize: 4 }));
  assert.deepEqual(body.attachments, attachments);
  assert.deepEqual(body.files, [file]);
  assert.equal(body.partial, true);
  assert.equal(body.coverage.filesCompleteForPage, false);
  assert.equal(body.coverage.returnedAttachments, 4);
  assert.equal(body.coverage.returnedFiles, 1);
  const missing = body.fileErrors.find((error: any) => error.code === 'FILE_METADATA_MISSING');
  assert.ok(missing, 'Missing sideloaded metadata must have an explicit error');
  assert.equal(missing.fileId, 'missing-file');
  assert.deepEqual([...missing.attachmentIds].sort(), ['missing-link-a', 'missing-link-b']);
  const invalid = body.fileErrors.find((error: any) => error.code === 'ATTACHMENT_FILE_ID_INVALID');
  assert.ok(invalid, 'An attachment without a usable file id must have an explicit error');
  assert.deepEqual(invalid.attachmentIds, ['invalid-link']);
  assert.equal(outbound.mock.callCount(), 1, 'Missing metadata must not trigger downloads or an unbounded retry loop');
});

test('malformed attachment responses and violated filters are errors instead of false empty results', async t => {
  let response: unknown;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, '/v2/attachments');
    return Response.json(response);
  });
  for (response of [{}, { attachments: null }, { attachments: {} }]) {
    assertRejected(await callTool('list_attachments'));
  }
  response = {
    attachments: [{ id: 'wrong-owner-link', fileId: file.id, ownerReference: 'bill:other' }],
    files: [file],
  };
  assertRejected(await callTool('list_attachments', { ownerReference: 'bill:requested' }));
  assertRejected(await callTool('list_attachments', { status: 'unhandled' }));
  response = { attachments: [{ id: 'unhandled-link', fileId: file.id, ownerReference: null }], files: [file] };
  assertRejected(await callTool('list_attachments', { status: 'handled' }));
  assert.equal(outbound.mock.callCount(), 6);
});

test('get_file reads one known file as metadata and never follows its download URL', async t => {
  const response = { meta: { statusCode: 200, success: true }, file: { ...file, imageWidth: 640 } };
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/files/' + file.id);
    assert.equal(new Headers(init?.headers).get('X-Access-Token'), env.BILLY_ACCESS_TOKEN);
    return Response.json(response);
  });
  const compact = successfulBody(await callTool('get_file', { id: ' ' + file.id + ' ' }));
  assert.deepEqual(compact.file, file);
  const verbose = successfulBody(await callTool('get_file', { id: file.id, verbose: true }));
  assert.deepEqual(verbose, response);
  assert.equal(outbound.mock.callCount(), 2);
});

test('get_file rejects missing ids and path-like inputs before network access', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unsafe file identifiers must not reach Billy');
  });
  assertRejected(await callTool('get_file'));
  for (const id of ['', ' \t ', '.', '..', '../other', 'file/other', 'file\\other', 'file?query', 'file#fragment', 'file with space']) {
    assertRejected(await callTool('get_file', { id }));
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('get_file reports missing or mismatched file records instead of returning another file', async t => {
  let response: unknown;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(apiUrl(input, init).pathname, '/v2/files/' + file.id);
    return Response.json(response);
  });
  for (response of [{}, { file: null }, { file: { ...file, id: 'another-file' } }]) {
    assertRejected(await callTool('get_file', { id: file.id }));
  }
  assert.equal(outbound.mock.callCount(), 3);
});

test('the general file list preserves its actual error and never substitutes an attachment inventory', async t => {
  let denied = true;
  const outbound = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = apiUrl(input, init);
    assert.equal(url.pathname, '/v2/files', 'The general file-list tool must keep its own endpoint');
    assert.equal(url.searchParams.get('organizationId'), env.BILLY_ORGANIZATION_ID);
    assert.equal(url.searchParams.get('pageSize'), '1');
    return denied
      ? Response.json({ errorCode: 'ACCESS_RESTRICTED', errorMessage: 'Synthetic denial' }, { status: 403 })
      : Response.json({
        meta: { paging: { page: 1, pageSize: 1, pageCount: 1, total: 1 } },
        files: [file],
      });
  });
  const rejected = await callTool('list_files', { pageSize: 1 });
  assertRejected(rejected);
  const errorText = JSON.stringify(rejected);
  assert.match(errorText, /403/);
  assert.match(errorText, /ACCESS_RESTRICTED/);
  assert.match(errorText, /list_attachments/);
  assert.equal(outbound.mock.callCount(), 1, 'Access denial must not silently fall back to attachments');

  denied = false;
  const body = successfulBody(await callTool('list_files', { pageSize: 1 }));
  const { createdTime: _createdTime, ...existingListFields } = file;
  assert.deepEqual(body.files, [existingListFields]);
  assert.equal(body.meta.paging.total, 1);
  assert.equal(outbound.mock.callCount(), 2);
});
