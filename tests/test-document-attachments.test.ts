import {test} from 'node:test';import assert from 'node:assert/strict';
import {invoiceDraftHandler,invoiceSnapshot} from '../src/test-invoice-drafts.js';
import {billDraftHandler,billSnapshot} from '../src/test-bill-drafts.js';
import {guardedWriteClient} from '../src/test-write-attempts.js';
import {database} from './guarded-db.js';
const created='a1111111-1111-4111-8111-111111111111',operationId='a2222222-2222-4222-8222-222222222222';
function fixture(kind:'invoice'|'bill',options:any={}){
 const {sql,db}=database();let writes=0;
 const header:any={id:'doc',organizationId:'org',type:'creditNote',state:'approved',amount:200,tax:50,grossAmount:250,balance:0,isPaid:true,currencyId:'DKK',exchangeRate:1,[kind==='invoice'?'invoiceNo':'voucherNo']:'TEST-'+created};
 const lines=[{id:'line',[kind+'Id']:'doc',amount:250,tax:50}],attachments:any[]=[{id:'existing',organizationId:'org',ownerReference:kind+':doc',fileId:'original'}];
 sql.prepare("INSERT INTO operations(id,fingerprint,target,state,result) VALUES(?,?,?,'complete',?)").run('org:'+created,JSON.stringify({action:kind==='invoice'?'create_test_credit_note_draft':'create_test_bill_credit_note_draft'}),'source',JSON.stringify({[kind]:header}));
 const read:any={async get(path:string){if(path==='/organization')return{organization:{id:'org'}};if(path==='/'+kind+'s/doc')return{[kind]:structuredClone(header)};if(path.startsWith('/attachments/'))return{attachment:{id:path.split('/').pop(),organizationId:options.foreign?'other':'org',fileId:'new-file'}};if(path==='/files/new-file')return{file:{id:'new-file'}};throw Error(path);},async fetchAll(path:string){return structuredClone(path==='/attachments'?attachments:lines);}};
 const write=guardedWriteClient({async post(path:string,body:any){assert.equal(path,'/attachments');writes++;attachments.push({id:'added'+writes,...body.attachment});if(options.drift)header.amount++;if(options.lost){options.lost=false;throw Error('Lost native response');}return{};},async put(){throw Error('Financial update forbidden');},async del(){throw Error('Delete forbidden');}} as any);
 const snapshot=()=>kind==='invoice'?invoiceSnapshot(read,'org','doc'):billSnapshot(read,'org','doc');
 return{sql,header,attachments,snapshot,writes:()=>writes,call:(args:any)=>(kind==='invoice'?invoiceDraftHandler:billDraftHandler)(read,write,db,'org','update_test_'+kind+'_draft')(args)};
}
for(const kind of ['invoice','bill'] as const){
 test(kind+' approved/paid credit accepts only additive file links and idempotent replay',async()=>{
  const f=fixture(kind),before=await f.snapshot(),a={operationId,id:'doc',expectedRevision:before.revision,reasoning:'test',attachmentIds:['source','duplicate-source']};
  const r=await f.call(a);assert.notEqual(r.isError,true,JSON.stringify(r));assert.equal(f.writes(),1);assert.deepEqual(f.header,before[kind]);assert.equal(f.attachments.length,2);
  assert.notEqual((await f.call(a)).isError,true);assert.equal(f.writes(),1);f.sql.close();
 });
 test(kind+' attachment recovery verifies an already performed write without repeating it',async()=>{
  const f=fixture(kind,{lost:true}),a={operationId,id:'doc',expectedRevision:(await f.snapshot()).revision,reasoning:'test',attachmentIds:['source']};
  assert.equal((await f.call(a)).isError,true);const r=await f.call(a);assert.notEqual(r.isError,true,JSON.stringify(r));assert.equal(JSON.parse(r.content[0].text).result.recovery.nativeWrites,0);assert.equal(f.writes(),1);f.sql.close();
 });
 test(kind+' financial edits, stale revision, foreign file and post-write drift are rejected',async()=>{
  for(const option of ['mixed','stale','foreign','drift']){const f=fixture(kind,{[option]:true});const a:any={operationId,id:'doc',expectedRevision:(await f.snapshot()).revision,reasoning:'test',attachmentIds:['source']};if(option==='mixed')a.description='changed';if(option==='stale')a.expectedRevision='stale';assert.equal((await f.call(a)).isError,true,option);assert.equal(f.writes(),option==='drift'?1:0);f.sql.close();}
 });
}
