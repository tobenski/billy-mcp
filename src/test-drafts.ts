import {guardedJournalRun} from './test-write-attempts.js';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { BillyClient } from './billy-client.js';
import { errorResult, jsonResult } from './tools/helpers.js';

// Only the isolated test Worker imports this module.
export interface JournalDB {
  guardedWrites?: boolean;
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ success: boolean; meta: { changes?: number } }> } };
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const operationId = z.string().uuid();
const date = z.iso.date();
const line = z.object({
  accountId: id, amount: z.number().positive().max(1000000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7, 'Use at most two decimals'),
  side: z.enum(['debit', 'credit']), text: z.string().max(100).optional(),
}).strict();
const createSchema = z.object({
  operationId, entryDate: date, daybookId: id, description: z.string().min(1).max(100),
  extendedDescription: z.string().max(4000).optional(), voucherNo: z.string().max(100).optional(),
  lines: z.array(line).min(2).max(50),
}).strict();
const updateSchema = z.object({
  operationId, id, expectedDescription: z.string(),
  description: z.string().max(100).optional(), extendedDescription: z.string().max(4000).optional(),
  voucherNo: z.string().max(100).optional(),
}).strict().refine(v => v.description !== undefined || v.extendedDescription !== undefined || v.voucherNo !== undefined, 'Supply a change');
const deleteSchema = z.object({ operationId, id, expectedDescription: z.string() }).strict();

export class NoWriteError extends Error {}

type Row = { fingerprint: string; state: string; result: string | null };
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function journalRun(db: JournalDB, org: string, key: string, target: string, payload: unknown, action: () => Promise<unknown>) {
  if(db.guardedWrites)return guardedJournalRun(db,org,key,target,payload,action);
  const fingerprint = canonical(payload);
  const journalId = org + ':' + key;
  const prior = () => db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(journalId).first<Row>();
  const existing = await prior();
  function replay(row: Row) {
    if (row.fingerprint !== fingerprint) throw new Error('Operation ID already used with different input. No write performed.');
    if (row.state !== 'complete') throw new Error('Operation is pending or outcome unknown. Do not retry with a new operation ID; inspect Billy and this operation first.');
    return { replayed: true, operationId: key, result: JSON.parse(row.result!) };
  }
  if (existing) return replay(existing);
  // Unique ID and pending-target index are database-enforced across Worker instances.
  const reserved = await db.prepare("INSERT OR IGNORE INTO operations (id, fingerprint, target, state) VALUES (?, ?, ?, 'pending')").bind(journalId, fingerprint, org + ':' + target).run();
  if (!reserved.success) throw new Error('Write journal unavailable. No write performed.');
  if (reserved.meta.changes !== 1) {
    const row = await prior();
    if (row) return replay(row);
    throw new Error('Another pending operation locks this draft. Inspect its outcome before continuing.');
  }
  try {
    const result = await action();
    const saved = await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ?").bind(JSON.stringify(result), journalId).run();
    if (!saved.success || saved.meta.changes !== 1) throw new Error('Journal completion failed');
    return { replayed: false, operationId: key, result };
  } catch (error) {
    if (error instanceof NoWriteError) {
      await db.prepare("DELETE FROM operations WHERE id = ? AND state = 'pending'").bind(journalId).run();
      throw error;
    }
    // Persist only classified metadata, never upstream bodies, credentials or free text.
    const message=error instanceof Error?error.message:'';
    const native=/^Billy API (GET|POST|PUT|DELETE) \/([A-Za-z]+)(?:\/[^ ]+)? failed with ([1-5][0-9]{2}):/.exec(message);
    const network=/^Billy API (GET|POST|PUT|DELETE) \/([A-Za-z]+)(?:\/[^ ]+)? network error:/.exec(message);
    const diagnostic={kind:native?'billy_http':network?'billy_network':'verification_or_internal',...(native?{method:native[1],resource:native[2],httpStatus:Number(native[3])}:network?{method:network[1],resource:network[2]}:{}),recordedAt:new Date().toISOString(),outcome:'undetermined',safeToRetry:false};
    try{
      const current=await prior();
      if(current?.state==='pending'){
        const evidence=current.result===null?{}:JSON.parse(current.result);
        if(evidence&&typeof evidence==='object'&&!Array.isArray(evidence))await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending' AND result IS ?").bind(JSON.stringify({...evidence,diagnostic}),journalId,current.result).run();
      }
    }catch{/* Diagnostic failure must never release the pending lock or replace preserved evidence. */}
    // Keep pending lock even after network errors: a write may already have succeeded.
    throw new Error('Operation outcome requires inspection. No automatic retry. Read get_test_write_operation and the draft in Billy before further writes.');
  }
}

export function registerTestDraftTools(server: McpServer, read: BillyClient, write: BillyClient, db: JournalDB, orgId: string) {
  async function identity() {
    const { organization: org } = await read.get('/organization');
    if (org?.id !== orgId) throw new Error('Test organization mismatch');
    return org;
  }
  async function draft(recordId: string, expectedDescription: string) {
    const { daybookTransaction: row } = await read.get('/daybookTransactions/' + recordId);
    if (!row || row.organizationId !== orgId || row.state !== 'draft' || !row.apiType?.startsWith('mcp-test:')) throw new NoWriteError('Only test-tool-created drafts in this organization may be changed or deleted.');
    if ((row.description ?? '') !== expectedDescription) throw new NoWriteError('Draft description changed; read it again before writing.');
    return row;
  }
  async function readBack(recordId: string) {
    const header = await read.get('/daybookTransactions/' + recordId);
    const lines = await read.fetchAll('/daybookTransactionLines', 'daybookTransactionLines', { daybookTransactionId: recordId });
    if (header.daybookTransaction?.organizationId !== orgId || header.daybookTransaction?.state !== 'draft') throw new Error('Unexpected saved draft state');
    return { ...header, daybookTransactionLines: lines };
  }
  const wrap = (fn: (a: any) => Promise<unknown>) => async (args: any) => { try { return jsonResult(await fn(args)); } catch(e) { return errorResult(e); } };
  server.registerTool('get_test_write_operation', {
    description: 'Inspect the persisted outcome of a test write and fresh native evidence for bank matches, document bookings/payments, marked credit-note creation candidates, daybook bookings and VAT operations. Saved result is historical; current observations never resolve pending state, release locks or authorize retry. Pending means in progress or uncertain; never retry it with a new ID.',
    inputSchema: z.object({ operationId }).strict(), annotations: { readOnlyHint: true },
  }, wrap(async ({operationId}) => {
    await identity();
    const row = await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(orgId + ':' + operationId).first<Row>();
    if(!row)return {operationId,state:'not_found'};
    const attempt=db.guardedWrites?await db.prepare('SELECT write_phase, lease_until FROM operations WHERE id = ?').bind(orgId+':'+operationId).first<any>():null;
    const input=JSON.parse(row.fingerprint);
    let currentEvidence:any;
    const saved=row.result?JSON.parse(row.result):null;
    try{const {inspectWriteOperation}=await import('./test-operation-inspection.js');currentEvidence=await inspectWriteOperation(read,orgId,input,saved);}
    catch{currentEvidence={available:false,outcome:'undetermined',safeToRetry:false,reason:'Current evidence could not be verified. Saved journal state and pending lock are unchanged.'};}
    return {operationId,...(attempt?{attempt:{phase:attempt.write_phase,leaseUntil:attempt.lease_until,resumeWithSameInput:row.state==='pending'&&attempt.write_phase==='prepared'&&attempt.lease_until<Date.now()}}:{}),state:saved?.disposition==='abandoned'?'abandoned':row.state,storageState:row.state,retryBlocked:row.state==='pending',input,result:saved,resultIsHistorical:true,currentEvidence};
  }));
  server.registerTool('create_test_daybook_draft', {
    description: 'Create a balanced draft in the locked test organization, then read its header and all lines. Base currency only, no tax or contra-account shortcuts. Requires a unique operation UUID; reuse exactly the same UUID/input after a lost response. Never books the draft.',
    inputSchema: createSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, wrap(async args => {
    const org = await identity();
    const { operationId: key, ...fields } = args as z.infer<typeof createSchema>;
    const balance = fields.lines.reduce((s, l) => s + Math.round(l.amount * 100) * (l.side === 'debit' ? 1 : -1), 0);
    if (balance !== 0) throw new Error('Unbalanced draft. No write performed.');
    return journalRun(db, orgId, key, 'create:' + key, { action: 'create', ...fields }, async () => {
      try {
      const books = await read.fetchAll('/daybooks', 'daybooks', { organizationId: orgId });
      if (!books.some((b:any) => b.id === fields.daybookId)) throw new NoWriteError('Invalid daybook');
      for (const accountId of new Set(fields.lines.map(l => l.accountId))) {
        const {account} = await read.get('/accounts/' + accountId);
        if (account?.organizationId !== orgId || account.isArchived || (account.currencyId && account.currencyId !== org.baseCurrencyId)) throw new NoWriteError('Invalid account');
      }
      } catch (error) {
        if (error instanceof NoWriteError) throw error;
        throw new NoWriteError('Draft preflight lookup failed. No write performed.');
      }
      const response = await write.post('/daybookTransactions', { daybookTransaction: {
        ...fields, organizationId: orgId, state: 'draft', apiType: 'mcp-test:' + key,
        lines: fields.lines.map(l => ({...l, currencyId: org.baseCurrencyId})),
      }});
      const recordId = response.daybookTransactions?.[0]?.id;
      if (!recordId) throw new Error('Missing created draft ID');
      return readBack(recordId);
    });
  }));
  server.registerTool('update_test_daybook_draft', {
    description: 'Update description, extended description or voucher number on a test-tool-created draft. Date, accounts, amounts and posting state cannot be changed. Read back the saved draft. Use a unique operation UUID per edit.',
    inputSchema: updateSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, wrap(async args => {
    await identity();
    const {operationId: key, id: recordId, expectedDescription, ...fields} = args;
    return journalRun(db, orgId, key, recordId, { action:'update', id:recordId, expectedDescription, ...fields }, async()=>{
      await draft(recordId, expectedDescription);
      await write.put('/daybookTransactions/' + recordId, {daybookTransaction: fields});
      return readBack(recordId);
    });
  }));
  server.registerTool('delete_test_daybook_draft', {
    description: 'Delete a test-tool-created draft after checking organization, draft state and expected description. Cannot delete approved entries. Persist deletion response under a unique operation UUID.',
    inputSchema: deleteSchema, annotations: { readOnlyHint:false, destructiveHint:true, idempotentHint:true },
  }, wrap(async args => {
    await identity();
    const {operationId:key, id:recordId, expectedDescription} = args;
    return journalRun(db, orgId, key, recordId, {action:'delete', id:recordId, expectedDescription}, async()=>{
      await draft(recordId, expectedDescription);
      return write.del('/daybookTransactions/' + recordId);
    });
  }));
}
