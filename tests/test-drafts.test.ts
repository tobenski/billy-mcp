import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roadmapTools } from '../src/test-roadmap.js';
import worker from '../src/test-worker.js';
import { journalRun, type JournalDB } from '../src/test-drafts.js';

const orgId = 'synthetic-org';
const key = '11111111-1111-4111-8111-111111111111';
const key2 = '22222222-2222-4222-8222-222222222222';
function journal() {
  const rows = new Map<string, any>();
  const db: JournalDB = { prepare(sql) { return { bind(...a:any[]) { return {
    async first<T>() { return (rows.get(a[0]) ?? null) as T; },
    async run() {
      if (sql.startsWith('INSERT')) {
        if (rows.has(a[0]) || [...rows.values()].some(r => r.target === a[2] && r.state === 'pending')) return {success:true,meta:{changes:0}};
        rows.set(a[0], {fingerprint:a[1],target:a[2],state:'pending',result:null});
      } else if (sql.startsWith('DELETE')) { rows.delete(a[0]);
      } else { const row=rows.get(a[1]); if (!row) return {success:true,meta:{changes:0}}; if(sql.includes("state = 'complete'"))row.state='complete'; row.result=a[0]; }
      return {success:true,meta:{changes:1}};
    }
  }; } }; } };
  return db;
}
const env = { BILLY_TEST_ORGANIZATION_ID:orgId, BILLY_API_KEY:'synthetic-key', ALLOWED_EMAILS:'test@example.invalid', BILLY_TEST_DRAFT_WRITES:'enabled' };
const ctx = {access:{getIdentity: async()=>({email:'test@example.invalid'})}};
async function rpc(db:JournalDB, name:string, args:any, method='tools/call') {
  const res = await worker.fetch(new Request('https://test.invalid/mcp', {
    method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:method==='tools/call'?{name,arguments:args}:{}}),
  }), {...env,TEST_WRITE_JOURNAL:db}, ctx);
  assert.equal(res.status,200);
  const text=await res.text();
  return res.headers.get('Content-Type')?.includes('text/event-stream')?JSON.parse(text.split('\n').find(x=>x.startsWith('data:'))!.slice(5)):JSON.parse(text);
}
const input = {operationId:key, entryDate:'2026-10-30',daybookId:'daybook',description:'Synthetic test', lines:[
  {accountId:'expense',amount:100,side:'debit'}, {accountId:'bank',amount:100,side:'credit'},
]};
function upstream(t:any, options:{org?:string;state?:string;timeout?:boolean;foreignAccount?:boolean;missingAccount?:boolean}={}) {
  const writes:any[]=[]; let row:any; let deleted=false;
  t.mock.method(globalThis,'fetch',async (input:any,init:any)=>{
    const url=new URL(String(input)); const p=url.pathname.replace('/v2','');
    assert.equal(init.redirect,'manual');
    if (init.method !== 'GET') {
      writes.push({path:p,method:init.method,body:init.body?JSON.parse(init.body):undefined});
      if (options.timeout) throw new Error('simulated timeout after upstream may have committed');
      if(init.method==='POST') { row={...JSON.parse(init.body).daybookTransaction,id:'draft'}; return Response.json({daybookTransactions:[row]}); }
      if(init.method==='PUT') { row={...(row??{id:'draft',organizationId:orgId,state:'draft',apiType:'mcp-test:'+key,description:'Synthetic test'}),...JSON.parse(init.body).daybookTransaction};return Response.json({daybookTransactions:[row]}); }
      deleted=true;return Response.json({meta:{deletedRecords:{daybookTransactions:['draft']}}});
    }
    if(p==='/organization') return Response.json({organization:{id:options.org??orgId,baseCurrencyId:'DKK'}});
    if(p==='/daybooks') return Response.json({daybooks:[{id:'daybook'}]});
    if(p.startsWith('/accounts/') && options.missingAccount) return Response.json({error:'missing'}, {status:404});
    if(p.startsWith('/accounts/')) return Response.json({account:{id:p.split('/').pop(),organizationId:options.foreignAccount?'foreign':orgId,currencyId:'DKK',isArchived:false}});
    if(p==='/daybookTransactionLines') return Response.json({daybookTransactionLines:row?.lines??[]});
    if(p==='/daybookTransactions/draft') return Response.json({daybookTransaction:{...(row??{id:'draft',organizationId:orgId,state:options.state??'draft',apiType:'mcp-test:'+key,description:'Synthetic test'})}});
    throw new Error('Unexpected request '+p);
  });
  return {writes,isDeleted:()=>deleted};
}
test('write-enabled registry adds narrow draft and attachment tools',async t=>{
  const calls=t.mock.method(globalThis,'fetch',async()=>{throw Error('No network')});
  const result=await rpc(journal(),'',{},'tools/list');
  assert.equal(result.result.tools.length,114);
  assert.deepEqual(result.result.tools.filter((x:any)=>x.annotations?.readOnlyHint===false&&!roadmapTools.some(t=>t.name===x.name)).map((x:any)=>x.name).sort(),['attach_test_file_to_draft','close_test_booking_operation','create_test_daybook_draft','create_test_partial_vat_rate','delete_test_daybook_draft','remove_test_draft_attachment','reuse_test_inbox_attachment','set_test_vat_return_settlement','update_test_daybook_draft','upload_test_file']);
  assert.equal(calls.mock.callCount(),0);
});
test('full draft create, replay, update, delete cycle uses draft state and returns source lines',async t=>{
  const state=upstream(t);const db=journal();
  const create=await rpc(db,'create_test_daybook_draft',input);
  assert.notEqual(create.result.isError,true,JSON.stringify(create));
  const data=JSON.parse(create.result.content[0].text);
  assert.equal(data.result.daybookTransaction.state,'draft');assert.equal(data.result.daybookTransactionLines.length,2);
  assert.equal((await rpc(db,'create_test_daybook_draft',input)).result.isError,undefined);
  assert.equal(state.writes.length,1);
  const update=await rpc(db,'update_test_daybook_draft',{operationId:key2,id:'draft',expectedDescription:'Synthetic test',description:'Edited'});
  assert.notEqual(update.result.isError,true,JSON.stringify(update));
  const del=await rpc(db,'delete_test_daybook_draft',{operationId:'33333333-3333-4333-8333-333333333333',id:'draft',expectedDescription:'Edited'});
  assert.notEqual(del.result.isError,true,JSON.stringify(del));assert.equal(state.isDeleted(),true);
  assert.deepEqual(state.writes.map(w=>w.method),['POST','PUT','DELETE']);
});
test('unbalanced, invalid date, unknown fields and attempts to approve cannot write',async t=>{
  const state=upstream(t);
  for(const args of [{...input,lines:[input.lines[0],{...input.lines[1],amount:99}]},{...input,entryDate:'2026-02-30'},{...input,state:'approved'},{...input,organizationId:'foreign'},{...input,lines:[{...input.lines[0],amount:0.001},input.lines[1]]}]) {
    const r=await rpc(journal(),'create_test_daybook_draft',args);assert.ok(r.error||r.result?.isError);
  }assert.equal(state.writes.length,0);
});
test('wrong organization blocks all three writes and operation lookup',async t=>{
  const state=upstream(t,{org:'foreign'});
  for(const [name,args] of [['create_test_daybook_draft',input],['update_test_daybook_draft',{operationId:key,id:'draft',expectedDescription:'Synthetic test',description:'new'}],['delete_test_daybook_draft',{operationId:key,id:'draft',expectedDescription:'Synthetic test'}],['get_test_write_operation',{operationId:key}]] as const) {
    assert.equal((await rpc(journal(),name,args)).result.isError,true);
  }assert.equal(state.writes.length,0);
});
test('foreign account cannot be written',async t=>{
  const state=upstream(t,{foreignAccount:true});assert.equal((await rpc(journal(),'create_test_daybook_draft',input)).result.isError,true);assert.equal(state.writes.length,0);
});
test('approved entries and stale descriptions cannot be edited or deleted',async t=>{
  const state=upstream(t,{state:'approved'});
  for(const name of ['update_test_daybook_draft','delete_test_daybook_draft']) {
    const r=await rpc(journal(),name,{operationId:key,id:'draft',expectedDescription:'Synthetic test',...(name.startsWith('update')?{description:'new'}:{})});assert.equal(r.result.isError,true);
  }assert.equal(state.writes.length,0);
});
test('timeout is persisted, repeat calls cannot issue another write, and status is inspectable',async t=>{
  const state=upstream(t,{timeout:true});const db=journal();
  for(let i=0;i<2;i++) assert.equal((await rpc(db,'create_test_daybook_draft',input)).result.isError,true);
  assert.equal(state.writes.length,1);
  const status=JSON.parse((await rpc(db,'get_test_write_operation',{operationId:key})).result.content[0].text);assert.equal(status.state,'pending');
});
test('journal serializes duplicate calls and same-target edits, rejects key reuse with changed data',async()=>{
  const db=journal();let calls=0;let finish!:()=>void;const hold=new Promise<void>(r=>finish=r);
  const one=journalRun(db,orgId,key,'draft',{a:1},async()=>{calls++;await hold;return {ok:true};});
  await new Promise(r=>setTimeout(r,0));
  await assert.rejects(journalRun(db,orgId,key,'draft',{a:1},async()=>{calls++;}),/pending/);
  await assert.rejects(journalRun(db,orgId,key2,'draft',{a:2},async()=>{calls++;}),/locks/);
  finish();await one;
  await assert.rejects(journalRun(db,orgId,key,'draft',{a:3},async()=>{}),/different input/);
  assert.equal(calls,1);
});
test('missing journal fails closed when writes enabled',async()=>{
  assert.equal((await worker.fetch(new Request('https://test.invalid/mcp'),env,ctx)).status,503);
});

 test('stale description is rejected before mutation and does not leave draft locked',async t=>{
  const state=upstream(t);const db=journal();
  assert.equal((await rpc(db,'update_test_daybook_draft',{operationId:key,id:'draft',expectedDescription:'stale',description:'new'})).result.isError,true);
  const retry=await rpc(db,'update_test_daybook_draft',{operationId:key2,id:'draft',expectedDescription:'Synthetic test',description:'new'});
  assert.notEqual(retry.result.isError,true,JSON.stringify(retry));assert.equal(state.writes.length,1);
 });

test('failed account preflight releases journal with no mutation',async t=>{
 const state=upstream(t,{missingAccount:true}),db=journal();
 for(let n=0;n<2;n++){const r=await rpc(db,'create_test_daybook_draft',input);assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/No write performed/);}
 assert.equal(state.writes.length,0);
 const r=await rpc(db,'get_test_write_operation',{operationId:key});assert.match(r.result.content[0].text,/not_found/);
});

test('uncertain native failures retain safe diagnostics and block replay without exposing response text',async()=>{
 for(const message of ['Billy API POST /taxRates failed with 403: SECRET customer data','Billy API PUT /daybookTransactions/private-id network error: SECRET URL','SECRET unexpected verification detail']){
 const db=journal();let calls=0;const action=async()=>{calls++;throw Error(message);};
 await assert.rejects(journalRun(db,orgId,key,'target',{action:'test'},action));
 const row:any=await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(orgId+':'+key).first();
 assert.equal(row.state,'pending');assert.ok(!row.result.includes('SECRET'));assert.ok(!row.result.includes('private-id'));
 const d=JSON.parse(row.result).diagnostic;assert.equal(d.safeToRetry,false);assert.equal(d.outcome,'undetermined');
 if(message.includes('403')){assert.equal(d.httpStatus,403);assert.equal(d.resource,'taxRates');assert.equal(d.method,'POST');}
 await assert.rejects(journalRun(db,orgId,key,'target',{action:'test'},action));assert.equal(calls,1);
 }
});
