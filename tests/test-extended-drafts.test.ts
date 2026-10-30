import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extendedHandler,draftSnapshot} from '../src/test-extended-drafts.js';
const keys=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const input={operationId:keys[0],reasoning:'Test',entryDate:'2026-10-30',description:'Test',daybookId:'book',lines:[{accountId:'expense',amount:100,side:'debit',text:'Cost'},{accountId:'bank',amount:100,side:'credit',text:'Payment'}]};
function harness(options:{append?:boolean;timeout?:boolean}={}){
 const rows=new Map<string,any>();let h:any,lines:any[]=[],writes=0;const attachments=[{id:'att',ownerReference:'daybookTransaction:draft',fileId:'file'}];
 const db:any={prepare(sql:string){return{bind(...a:any[]){return{async first(){return rows.get(a[0])??null;},async run(){if(sql.startsWith('INSERT')){if(rows.has(a[0]))return{success:true,meta:{changes:0}};rows.set(a[0],{fingerprint:a[1],state:'pending',result:null});}else if(sql.startsWith('DELETE'))rows.delete(a[0]);else Object.assign(rows.get(a[1]),{state:'complete',result:a[0]});return{success:true,meta:{changes:1}};}};}};}};
 const read:any={async get(p:string){if(p==='/organization')return{organization:{id:'org',baseCurrencyId:'DKK'}};if(p.startsWith('/accounts/'))return{account:{organizationId:'org',currencyId:'DKK'}};return{daybookTransaction:{...h}};},async fetchAll(p:string){return p==='/daybooks'?[{id:'book'}]:structuredClone(p==='/attachments'?attachments:lines);}};
 const save=(body:any)=>{const d=body.daybookTransaction;h={...h,...d,id:'draft'};delete h.lines;if(d.lines)lines=[...(options.append?lines:[]),...d.lines.map((l:any,i:number)=>({...l,id:'line'+i,daybookTransactionId:'draft'}))];};
 const write:any={async post(p:string,b:any){writes++;save(b);return{daybookTransactions:[h]};},async put(p:string,b:any){writes++;if(options.timeout)throw Error('timeout');save(b);}};
 return{call:(name:string,a:any)=>extendedHandler(read,write,db,'org',name)(a),snapshot:()=>draftSnapshot(read,'draft','org'),writes:()=>writes,header:()=>h,rows};
}
const data=(r:any)=>JSON.parse(r.content[0].text);
test('extended create/update replaces all lines, preserves attachment, returns revision and replays',async()=>{
 const h=harness();let r=await h.call('create_test_extended_draft',input);assert.notEqual(r.isError,true,JSON.stringify(r));const before=await h.snapshot();
 const a={operationId:keys[1],reasoning:'Correction',id:'draft',expectedRevision:before.revision,entryDate:'2026-10-29',lines:input.lines.map(l=>({...l,amount:250}))};
 r=await h.call('update_test_extended_draft',a);assert.notEqual(r.isError,true,JSON.stringify(r));const after=data(r).result;assert.equal(after.daybookTransactionLines.length,2);assert.equal(after.daybookTransactionLines[0].amount,250);assert.deepEqual(after.attachments,before.attachments);assert.notEqual(after.revision,before.revision);
 assert.equal(data(await h.call('update_test_extended_draft',a)).replayed,true);assert.equal(h.writes(),2);
 const stale=await h.call('update_test_extended_draft',{...a,operationId:keys[2]});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/STALE_REVISION/);assert.equal(h.writes(),2);
});
test('unsupported fields, invalid dates, unbalanced/null/fractional lines reject without write',async()=>{
 for(const extra of [{currencyId:'EUR'},{attachmentIds:[]},{contactId:null},{entryDate:'2026-02-30'},{lines:input.lines.map((l,i)=>({...l,amount:i?99:100}))},{lines:input.lines.map(l=>({...l,accountId:null}))},{lines:input.lines.map(l=>({...l,amount:0.001}))},{lines:input.lines.map(l=>({...l,taxRateId:'vat'}))}]){const h=harness();assert.equal((await h.call('create_test_extended_draft',{...input,...extra})).isError,true);assert.equal(h.writes(),0);}
});
test('approved draft cannot be changed',async()=>{const h=harness();await h.call('create_test_extended_draft',input);h.header().state='approved';const s=await h.snapshot();assert.equal((await h.call('update_test_extended_draft',{id:'draft',operationId:keys[1],reasoning:'test',expectedRevision:s.revision,description:'new'})).isError,true);assert.equal(h.writes(),1);});
test('append instead of replacement and timeout stay pending and cannot retry mutation',async()=>{
 for(const options of [{append:true},{timeout:true}]){const h=harness(options);await h.call('create_test_extended_draft',input);const s=await h.snapshot();const a={id:'draft',operationId:keys[1],reasoning:'test',expectedRevision:s.revision,lines:input.lines};assert.equal((await h.call('update_test_extended_draft',a)).isError,true);assert.equal((await h.call('update_test_extended_draft',a)).isError,true);assert.equal(h.writes(),2);}
});
