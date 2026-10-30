import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bankHandler} from '../src/test-bank.js';
const org='org',keys=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
function harness(options:any={}){
 let writes=0;const journal=new Map<string,any>();const bankLine={id:'line',accountId:'bank',matchId:'match',amount:100,side:'credit',entryDate:'2026-10-30'};
 const account={id:'bank',organizationId:options.foreign?'other':org,currencyId:'DKK',isArchived:false,isBankAccount:true};
 const match={id:'match',accountId:'bank',isApproved:Object.hasOwn(options,'approved')?options.approved:false};
 const associations:any[]=options.associations??[];
 const lines=[{id:'l1',daybookTransactionId:'draft',accountId:'expense',amount:100,currencyId:'DKK',side:'debit',text:'Test'},{id:'l2',daybookTransactionId:'draft',accountId:'bank',amount:options.amount??100,currencyId:'DKK',side:options.side??'credit',text:'Test'}];
 const read:any={async get(p:string){if(p==='/organization')return{organization:{id:org}};if(p==='/bankLines/line')return{bankLine:{...bankLine}};if(p==='/accounts/bank')return{account};if(p==='/bankLineMatches/match')return{bankLineMatch:{...match}};if(p==='/daybookTransactions/draft')return{daybookTransaction:{id:'draft',organizationId:org,state:options.booked?'approved':'draft',apiType:'mcp-test:fixture'}};throw Error(p);},async fetchAll(p:string,_r:string,q:any){if(p==='/bankLines')return q.status==='pending'?[]:[{...bankLine},...(options.multi?[{...bankLine,id:'other'}]:[])];if(p==='/bankLineSubjectAssociations')return structuredClone(associations);if(p==='/daybookTransactionLines')return structuredClone(lines);if(p==='/attachments')return[];throw Error(p);}};
 const db:any={prepare(sql:string){return{bind(...a:any[]){return{async first(){return journal.get(a[0])??null;},async run(){if(sql.startsWith('INSERT')){if(journal.has(a[0]))return{success:true,meta:{changes:0}};journal.set(a[0],{fingerprint:a[1],state:'pending',result:null});}else if(sql.startsWith('DELETE'))journal.delete(a[0]);else Object.assign(journal.get(a[1]),{state:'complete',result:a[0]});return{success:true,meta:{changes:1}};}};}};}};
 const write:any={async post(p:string,b:any){writes++;assert.equal(p,'/bankLineSubjectAssociations');associations.push({id:'association',...b.bankLineSubjectAssociation});if(options.timeout)throw Error('Lost response');return{bankLineSubjectAssociations:associations};},async del(p:string){writes++;assert.equal(p,'/bankLineSubjectAssociations/association');associations.splice(associations.findIndex(a=>a.id==='association'),1);if(options.removeOthers)associations.length=0;return{};}};
 return{call:(name:string,a:any)=>bankHandler(read,org,name,write,db)(a),writes:()=>writes,associations,bankLine,journal,read};
}
const parsed=(r:any)=>JSON.parse(r.content[0].text);
async function revision(h:any){const r=await h.call('get_test_bank_line',{id:'line'});assert.notEqual(r.isError,true,JSON.stringify(r));return parsed(r).revision;}
const link=(rev:string)=>({operationId:keys[0],reasoning:'Test',bankLineId:'line',expectedRevision:rev,subjects:[{type:'daybookTransaction',id:'draft'}]});
const unlink=(rev:string)=>({operationId:keys[1],reasoning:'Undo test',bankLineId:'line',expectedRevision:rev,matchId:'match',subjectReference:'daybookTransaction:draft'});
test('bank link and unlink lifecycle preserves bank/draft, replays, prevents duplicates',async()=>{
 const h=harness();const a=link(await revision(h));const first=await h.call('reconcile_test_bank_line',a);assert.notEqual(first.isError,true,JSON.stringify(first));assert.equal(h.associations.length,1);
 assert.equal(parsed(await h.call('reconcile_test_bank_line',a)).replayed,true);assert.equal(h.writes(),1);
 const duplicate=await h.call('reconcile_test_bank_line',{...a,operationId:keys[2],expectedRevision:await revision(h)});assert.equal(parsed(duplicate).result.alreadyLinked,true);assert.equal(h.writes(),1);
 const b=unlink(await revision(h));assert.notEqual((await h.call('unlink_test_bank_line',b)).isError,true);assert.equal(h.associations.length,0);assert.equal(parsed(await h.call('unlink_test_bank_line',b)).replayed,true);assert.equal(h.writes(),2);
});
test('wrong amount/side, approved matches, booked drafts, multi-line groups reject without writes',async()=>{
 for(const options of [{amount:99},{side:'debit'},{approved:true},{approved:null},{booked:true},{multi:true}]){const h=harness(options);const a=link(await revision(h));const r=await h.call('reconcile_test_bank_line',a);assert.equal(r.isError,true,JSON.stringify(r));assert.equal(h.writes(),0);}
});
test('foreign bank account and invalid IDs cannot reach mutation',async()=>{
 const h=harness({foreign:true});assert.equal((await h.call('get_test_bank_line',{id:'line'})).isError,true);assert.equal((await h.call('reconcile_test_bank_line',link('revision'))).isError,true);assert.equal(h.writes(),0);
 assert.equal((await harness().call('get_test_bank_line',{id:'../organization'})).isError,true);
});
test('stale revision, split amounts and non-draft subjects reject without writes',async()=>{
 const h=harness();const a=link(await revision(h));for(const patch of [{expectedRevision:'stale'},{subjects:[{type:'invoice',id:'invoice'}]},{subjects:[{type:'daybookTransaction',id:'draft',amount:99}]}])assert.equal((await h.call('reconcile_test_bank_line',{...a,...patch})).isError,true);assert.equal(h.writes(),0);
});
test('unlink retains other associations and detects unexpected loss',async()=>{
 for(const removeOthers of [false,true]){const h=harness({removeOthers,associations:[{id:'association',matchId:'match',subjectReference:'daybookTransaction:draft'},{id:'keep',matchId:'match',subjectReference:'transaction:other'}]});const r=await h.call('unlink_test_bank_line',unlink(await revision(h)));assert.equal(r.isError===true,removeOthers);if(!removeOthers)assert.equal(h.associations[0].id,'keep');}
});
test('uncertain link persists pending and never posts twice',async()=>{
 const h=harness({timeout:true});const a=link(await revision(h));assert.equal((await h.call('reconcile_test_bank_line',a)).isError,true);assert.equal((await h.call('reconcile_test_bank_line',a)).isError,true);assert.equal(h.writes(),1);
});
