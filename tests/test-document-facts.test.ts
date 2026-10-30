import {test} from 'node:test';
import assert from 'node:assert/strict';
import {factsHandler,documentFactsView} from '../src/test-document-facts.js';
import {documentHandler} from '../src/test-documents.js';
const key='11111111-1111-4111-8111-111111111111',key2='22222222-2222-4222-8222-222222222222';
const values={documentType:'invoice',date:'2026-10-01',currencyId:'DKK',vendorName:'Synthetic vendor',totalAmount:12.34,summary:'Synthetic data only',invoiceNumber:'TEST-001',lineItems:[{description:'Test line',amount:12.34,vatAmount:null}]};
const parse=(r:any)=>JSON.parse(r.content[0].text);
function harness(options:any={}){
 const attachment:any={id:'att',organizationId:'org',fileId:'file',ownerReference:null,amount:null,supplier:null,currencyId:'DKK',...options.attachment};
 const rows=new Map<string,any>();let reads=0;const calls:string[]=[];
 const read:any={async get(path:string){calls.push(path);if(path==='/organization')return{organization:{id:options.org??'org'}};assert.equal(path,'/attachments/att');reads++;if(options.race&&reads===2)attachment.ownerReference='daybookTransaction:changed';return{attachment:structuredClone(attachment)};}};
 const db:any={prepare(sql:string){return{bind(...v:any[]){return{async first(){if(sql.includes('ORDER BY rowid'))return [...rows.values()].reverse().find(r=>r.target===v[0]&&r.state==='complete')??null;return rows.get(v[0])??null;},async run(){if(sql.startsWith('INSERT')){if(rows.has(v[0])||[...rows.values()].some(r=>r.target===v[2]&&r.state==='pending'))return{success:true,meta:{changes:0}};rows.set(v[0],{fingerprint:v[1],target:v[2],state:'pending'});}else if(sql.startsWith('DELETE'))rows.delete(v[0]);else{if(options.saveFailure)return{success:false,meta:{changes:0}};Object.assign(rows.get(v[1]),{...(sql.includes("state = 'complete'")?{state:'complete'}:{}),result:v[0]});}return{success:true,meta:{changes:1}};}};}};}};
 return{call:(a:any)=>factsHandler(read,db,'org')(a),view:()=>documentFactsView(db,'org',attachment),get:()=>documentHandler(read,'org','get_test_document',db)({attachmentId:'att'}),attachment,rows,calls};
}
const args=(revision:string,patch:any={})=>({...values,attachmentId:'att',operationId:key,reasoning:'Test only',expectedRevision:revision,...patch});
test('facts save and read unchanged as separate annotations; native attachment remains untouched and replay is stable',async()=>{
 const h=harness(),before=structuredClone(h.attachment),r=await h.call(args((await h.view()).revision));assert.notEqual(r.isError,true,JSON.stringify(r));const saved=parse(r).result;assert.equal(saved.billyWritePerformed,false);assert.equal(saved.ledgerEffect,'none');const view=parse(await h.get());assert.deepEqual(view.attachment,before);assert.deepEqual(view.documentFacts.values,values);assert.equal(view.revision,saved.revision);assert.equal(view.documentFacts.appliesToCurrentAttachment,true);assert.equal(parse(await h.call(args((await documentFactsView({prepare:()=>({bind:()=>({first:async()=>null})})} as any,'org',before)).revision))).replayed,true);assert.equal(h.rows.size,1);assert.ok(h.calls.every(p=>p==='/organization'||p==='/attachments/att'));
});
test('full replacement removes omitted optional fields and preserves unknown null versus numeric zero',async()=>{
 const h=harness();await h.call(args((await h.view()).revision));const current=await h.view();const {invoiceNumber,lineItems,...minimal}=values;
 const r=await h.call({...minimal,documentType:'credit_note',totalAmount:0,vendorName:null,date:null,currencyId:null,attachmentId:'att',expectedRevision:current.revision,operationId:key2,reasoning:'Replace'});assert.notEqual(r.isError,true);const facts=(await h.view()).documentFacts!.values;assert.equal(facts.invoiceNumber,undefined);assert.equal(facts.lineItems,undefined);assert.equal(facts.totalAmount,0);assert.equal(facts.date,null);assert.equal(facts.vendorName,null);
});
test('stale revision and changed source reject; getter flags old annotations after native change',async()=>{
 const h=harness();const initial=(await h.view()).revision;await h.call(args(initial));const r=await h.call(args(initial,{operationId:key2}));assert.equal(r.isError,true);assert.equal(h.rows.size,1);h.attachment.fileId='replacement';const view=await h.view();assert.equal(view.documentFacts!.appliesToCurrentAttachment,false);assert.equal(view.documentFacts!.nativeAttachmentChanged,true);assert.equal(view.documentFacts!.fileIdAtSave,'file');
 const race=harness({race:true});assert.equal((await race.call(args((await race.view()).revision))).isError,true);assert.equal(race.rows.size,0);
});
test('identity, source ownership and invalid or oversized facts fail before saving',async()=>{
 for(const options of [{org:'wrong'},{attachment:{organizationId:'wrong'}},{attachment:{id:'wrong'}}]){const h=harness(options);assert.equal((await h.call(args('a'.repeat(64)))).isError,true);assert.equal(h.rows.size,0);}
 for(const patch of [{date:'2026-02-30'},{currencyId:'dkk'},{totalAmount:Infinity},{attachmentId:'../other'},{summary:'x'.repeat(8001)},{lineItems:Array.from({length:100},()=>({description:'x'.repeat(1000),amount:1}))},{unexpected:'injected'}]){const h=harness();assert.equal((await h.call(args((await h.view()).revision,patch))).isError,true);assert.equal(h.rows.size,0);}
});
test('failed commit stays pending, facts remain invisible, and fresh UUID cannot bypass the lock',async()=>{
 const h=harness({saveFailure:true}),a=args((await h.view()).revision);assert.equal((await h.call(a)).isError,true);assert.equal((await h.view()).documentFacts,null);assert.equal((await h.call(a)).isError,true);assert.equal((await h.call({...a,operationId:key2})).isError,true);assert.equal(h.rows.size,1);
});
test('journal history chooses newest completed snapshot and changed input cannot reuse UUID',async()=>{
 const h=harness();const first=args((await h.view()).revision);await h.call(first);assert.equal((await h.call({...first,summary:'Changed'})).isError,true);await h.call(args((await h.view()).revision,{operationId:key2,summary:'New complete snapshot'}));assert.equal((await h.view()).documentFacts!.values.summary,'New complete snapshot');assert.equal(h.rows.size,2);
});
