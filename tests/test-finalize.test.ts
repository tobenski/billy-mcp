import {test} from 'node:test';import assert from 'node:assert/strict';
import {finalizeHandler} from '../src/test-finalize.js';import {draftSnapshot} from '../src/test-extended-drafts.js';import {bankSnapshot} from '../src/test-bank.js';
const keys=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
function harness(options:any={}){
 let writes=0,state=options.state??'draft',approved=false;const rows=new Map<string,any>();
 const header=()=>({id:'draft',organizationId:'org',state,apiType:options.marker??'mcp-test:fixture',entryDate:'2026-10-01',description:'Test'});
 const lines:any[]=[{id:'one',daybookTransactionId:'draft',accountId:'cost',amount:299,side:'debit',currencyId:'DKK',text:'Cost'},{id:'two',daybookTransactionId:'draft',accountId:'bank',amount:299,side:'credit',currencyId:'DKK',text:'Bank'}];
 if(options.partial){lines[0].amount=285.25;lines.push({...lines[0],id:'three',accountId:'vatAccount',amount:13.75,text:'Explicit 23 percent deductible VAT'});}
 if(options.vat)lines[0].taxRateId='vat';
 const tx={id:'tx',organizationId:'org',originatorReference:'daybookTransaction:draft',isVoided:false,isVoid:false};const association={id:'assoc',matchId:'match',subjectReference:'daybookTransaction:draft'};
 const account={id:'bank',organizationId:options.foreign?'other':'org',currencyId:'DKK',isArchived:false,isBankAccount:true};
 const bl={id:'line',accountId:'bank',matchId:'match',amount:options.bankAmount??299,side:'credit',entryDate:'2026-10-01'};
 const read:any={async get(p:string){if(p==='/organization')return{organization:{id:'org',baseCurrencyId:'DKK'}};if(p==='/daybookTransactions/draft')return{daybookTransaction:header()};if(p.startsWith('/accounts/'))return{account:{...account,id:p.split('/').pop()}};if(p==='/bankLineMatches/match')return{bankLineMatch:{id:'match',accountId:'bank',isApproved:approved}};if(p==='/bankLines/line')return{bankLine:{...bl}};throw Error(p);},async fetchAll(p:string,r:string,q:any){if(p==='/taxRates')return[{id:'vat',organizationId:'org',isActive:true,isPredefined:true,rate:0.25,taxRateGroup:'local',predefinedTag:'p_dk_25',isMissingStandardTaxRate:false,appliesToPurchases:true,appliesToSales:false}];if(p==='/taxRateDeductionComponents')return[{taxRateId:'vat',source:'tax',share:1,accountId:'vatAccount'}];if(p==='/postings'&&options.vat)return[{...lines[0],amount:239.2},{...lines[0],accountId:options.badVat?'wrong':'vatAccount',amount:59.8,salesTaxReturnId:'return'},lines[1]].map((l,i)=>({...l,id:'p'+i,organizationId:'org',transactionId:'tx',entryDate:'2026-10-01',isBankMatched:false}));if(p==='/daybookTransactionLines')return structuredClone(lines);if(p==='/attachments')return[{id:'att',ownerReference:'daybookTransaction:draft',fileId:'file'}];if(p==='/transactions')return state==='approved'?[tx]:[];if(p==='/postings')return lines.map(l=>({...l,id:'p'+l.id,...(options.partial&&l.accountId==='vatAccount'?{salesTaxReturnId:'return'}:{}),organizationId:'org',transactionId:'tx',entryDate:'2026-10-01',isBankMatched:approved&&l.accountId==='bank',amount:options.badPostings?1:l.amount}));if(p==='/bankLines')return q.status==='pending'?[]:[{...bl}];if(p==='/bankLineSubjectAssociations')return[{...association,...(approved?{id:'posted-assoc',subjectReference:options.wrongPosting?'posting:wrong':'posting:ptwo'}:{})}];throw Error(p);}};
 const db:any={prepare(sql:string){return{bind(...a:any[]){return{async first(){return rows.get(a[0])??null;},async run(){if(sql.startsWith('INSERT')){if(rows.has(a[0]))return{success:true,meta:{changes:0}};rows.set(a[0],{fingerprint:a[1],state:'pending',result:null});}else if(sql.startsWith('DELETE'))rows.delete(a[0]);else Object.assign(rows.get(a[1]),{state:'complete',result:a[0]});return{success:true,meta:{changes:1}};}};}};}};
 const write:any={async put(p:string,b:any){writes++;if(p==='/daybookTransactions/draft'){assert.deepEqual(b,{daybookTransaction:{state:'approved'}});state='approved';}else{assert.equal(p,'/bankLineMatches/match');assert.deepEqual(b,{bankLineMatch:{isApproved:true}});approved=true;}if(options.timeout)throw Error('Lost response after commit');}};
 return{call:(n:string,a:any)=>finalizeHandler(read,write,db,'org',n)(a),draft:()=>draftSnapshot(read,'draft','org'),bank:()=>bankSnapshot(read,'org','line'),writes:()=>writes};
}
const book=(revision:string)=>({operationId:keys[0],reasoning:'Test',daybookTransactionId:'draft',expectedDescription:'Test',expectedRevision:revision});
const approve=(revision:string)=>({operationId:keys[1],reasoning:'Test',matchId:'match',expectedRevision:revision});
const data=(r:any)=>JSON.parse(r.content[0].text);
test('book then approve verifies ledger postings, preserves files, and replays both',async()=>{
 const h=harness();const a=book((await h.draft()).revision);const r=await h.call('book_test_daybook_draft',a);assert.notEqual(r.isError,true,JSON.stringify(r));assert.equal(data(r).result.daybookTransaction.state,'approved');assert.equal(data(r).result.postings.length,2);assert.equal(data(r).result.attachments.length,1);assert.equal(data(await h.call('book_test_daybook_draft',a)).replayed,true);
 const b=approve((await h.bank()).revision);const done=await h.call('approve_test_bank_match',b);assert.notEqual(done.isError,true,JSON.stringify(done));assert.equal(data(done).result.match.isApproved,true);assert.equal(data(await h.call('approve_test_bank_match',b)).replayed,true);assert.equal(h.writes(),2);
});
test('stale, foreign, non-test and already approved entries cannot be booked',async()=>{
 for(const options of [{foreign:true},{marker:'manual'},{state:'approved'},{}]){const h=harness(options);const a=book((await h.draft()).revision);if(Object.keys(options).length===0)a.expectedRevision='stale';assert.equal((await h.call('book_test_daybook_draft',a)).isError,true);assert.equal(h.writes(),0);}
});
test('approval refuses drafts and mismatched bank amounts without mutation',async()=>{
 for(const options of [{},{state:'approved',bankAmount:300},{state:'approved',badPostings:true}]){const h=harness(options);const r=await h.call('approve_test_bank_match',approve((await h.bank()).revision));assert.equal(r.isError,true);assert.equal(h.writes(),0);}
});
test('post-write timeout or mismatched ledger leaves pending and prevents second booking',async()=>{
 for(const options of [{timeout:true},{badPostings:true}]){const h=harness(options),a=book((await h.draft()).revision);assert.equal((await h.call('book_test_daybook_draft',a)).isError,true);assert.equal((await h.call('book_test_daybook_draft',a)).isError,true);assert.equal(h.writes(),1);}
});

test('approval validates converted posting association instead of accepting arbitrary link',async()=>{const h=harness({state:'approved',wrongPosting:true});const a=approve((await h.bank()).revision);assert.equal((await h.call('approve_test_bank_match',a)).isError,true);assert.equal((await h.call('approve_test_bank_match',a)).isError,true);assert.equal(h.writes(),1);});

test('VAT booking checks native net and VAT postings; incorrect VAT account stays pending',async()=>{for(const badVat of [false,true]){const h=harness({vat:true,badVat}),a=book((await h.draft()).revision);const r=await h.call('book_test_daybook_draft',a);assert.equal(!!r.isError,badVat,JSON.stringify(r));const retry=await h.call('book_test_daybook_draft',a);assert.equal(!!retry.isError,badVat);assert.equal(h.writes(),1);}});

test('explicit partial deduction booking preserves supplied expense VAT and bank amounts without deriving a percentage',async()=>{
 for(const badPostings of [false,true]){const h=harness({partial:true,badPostings}),a=book((await h.draft()).revision);const r=await h.call('book_test_daybook_draft',a);assert.equal(!!r.isError,badPostings);if(!badPostings){const ps=data(r).result.postings;assert.equal(ps.find((x:any)=>x.accountId==='vatAccount').amount,13.75);assert.equal(ps.find((x:any)=>x.accountId==='cost').amount,285.25);}assert.equal(h.writes(),1);}
});
