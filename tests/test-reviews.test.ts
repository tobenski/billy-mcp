import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewHandler,reviewView,reviewRead} from '../src/test-reviews.js';
const key='11111111-1111-4111-8111-111111111111',key2='22222222-2222-4222-8222-222222222222',key3='33333333-3333-4333-8333-333333333333';
const parse=(r:any)=>JSON.parse(r.content[0].text);
function harness(options:any={}){
 const rows=new Map<string,any>();let sourceReads=0;const calls:string[]=[];
 const attachment:any={id:'att',organizationId:'org',fileId:'file',ownerReference:'daybookTransaction:daybook'};
 const transaction:any={id:'tx',organizationId:'org',originatorReference:'daybookTransaction:daybook',entryDate:'2026-10-01'};
 const postings:any[]=[{id:'p',organizationId:options.postingOrg??'org',transactionId:'tx',accountId:'bank',amount:7,side:'debit'}];
 const read:any={async get(path:string){calls.push(path);if(path==='/organization')return{organization:{id:options.org??'org'}};sourceReads++;if(options.race&&sourceReads===3)attachment.fileId='changed';if(path==='/attachments/att')return{attachment:structuredClone(attachment)};if(path==='/transactions/tx')return{transaction:structuredClone(transaction)};throw Error(path);},async fetchAll(path:string){calls.push(path);if(options.lookupFailure)throw Error('Private upstream failure');return structuredClone(path==='/postings'?postings:[attachment]);}};
 const db:any={prepare(sql:string){return{bind(...v:any[]){return{async first(){if(sql.includes('ORDER BY rowid'))return [...rows.values()].reverse().find(r=>r.target===v[0]&&r.state==='complete')??null;return rows.get(v[0])??null;},async run(){if(sql.startsWith('INSERT')){if(rows.has(v[0])||[...rows.values()].some(r=>r.target===v[2]&&r.state==='pending'))return{success:true,meta:{changes:0}};rows.set(v[0],{fingerprint:v[1],target:v[2],state:'pending'});}else if(sql.startsWith('DELETE'))rows.delete(v[0]);else{if(options.saveFailure)return{success:false,meta:{changes:0}};Object.assign(rows.get(v[1]),{...(sql.includes("state = 'complete'")?{state:'complete'}:{}),result:v[0]});}return{success:true,meta:{changes:1}};}};}};}};
 return{view:(type='attachment',id=type==='attachment'?'att':'tx')=>reviewView(read,db,'org',type,id),safe:()=>reviewRead(read,db,'org','transaction','tx'),call:(name:string,a:any)=>reviewHandler(read,db,'org',name)(a),attachment,transaction,postings,rows,calls};
}
const base=(revision:string,patch:any={})=>({subjectType:'attachment',subjectId:'att',expectedRevision:revision,operationId:key,reasoning:'Synthetic review test',...patch});
test('create and resolve advisory review preserve source, issue and history; identical retries replay',async()=>{
 const h=harness(),original=structuredClone(h.attachment),a=base((await h.view()).reviewRevision,{issue:'Check synthetic receipt'});
 const opened=await h.call('create_test_review',a);assert.notEqual(opened.isError,true,JSON.stringify(opened));assert.equal(parse(opened).result.reviewId,key);assert.equal(parse(opened).result.billyWritePerformed,false);assert.equal(parse(await h.call('create_test_review',a)).replayed,true);
 const fresh=await h.view();assert.equal(fresh.reviews[0].status,'open');assert.equal(fresh.reviewRevision,parse(opened).result.reviewRevision);
 const close=base(fresh.reviewRevision,{operationId:key2,reviewId:key,reasoning:'Manually verified synthetic receipt'});const closed=await h.call('resolve_test_review',close);assert.notEqual(closed.isError,true,JSON.stringify(closed));assert.equal(parse(await h.call('resolve_test_review',close)).replayed,true);
 const final=await h.view();assert.equal(final.reviews[0].status,'resolved');assert.equal(final.reviews[0].issue,a.issue);assert.equal(final.reviews[0].resolution,close.reasoning);assert.deepEqual(h.attachment,original);assert.equal(h.rows.size,2);
});
test('stale tokens, unknown IDs and already-closed notes refuse without adding history',async()=>{
 const h=harness();const start=await h.view();await h.call('create_test_review',base(start.reviewRevision,{issue:'Issue'}));
 assert.equal((await h.call('resolve_test_review',base(start.reviewRevision,{operationId:key2,reviewId:key}))).isError,true);
 const current=await h.view();assert.equal((await h.call('resolve_test_review',base(current.reviewRevision,{operationId:key2,reviewId:key3}))).isError,true);
 await h.call('resolve_test_review',base(current.reviewRevision,{operationId:key2,reviewId:key}));assert.equal((await h.call('resolve_test_review',base((await h.view()).reviewRevision,{operationId:key3,reviewId:key}))).isError,true);assert.equal(h.rows.size,2);
});
test('multiple notes preserve one another and duplicate open issue is rejected',async()=>{
 const h=harness();await h.call('create_test_review',base((await h.view()).reviewRevision,{issue:'One'}));assert.equal((await h.call('create_test_review',base((await h.view()).reviewRevision,{operationId:key2,issue:'One'}))).isError,true);
 await h.call('create_test_review',base((await h.view()).reviewRevision,{operationId:key2,issue:'Two'}));await h.call('resolve_test_review',base((await h.view()).reviewRevision,{operationId:key3,reviewId:key}));const v=await h.view();assert.deepEqual(v.reviews.map((r:any)=>r.status),['resolved','open']);assert.equal(v.reviews[1].issue,'Two');
});
test('changed native source invalidates token and is flagged; fresh review may explicitly close after correction',async()=>{
 const h=harness();await h.call('create_test_review',base((await h.view()).reviewRevision,{issue:'Check file'}));const old=await h.view();h.attachment.fileId='newfile';assert.equal((await h.call('resolve_test_review',base(old.reviewRevision,{operationId:key2,reviewId:key}))).isError,true);const fresh=await h.view();assert.equal(fresh.reviews[0].sourceChangedSinceOpened,true);assert.notEqual((await h.call('resolve_test_review',base(fresh.reviewRevision,{operationId:key2,reviewId:key}))).isError,true);h.attachment.fileId='another';assert.equal((await h.view()).reviews[0].sourceChangedSinceResolved,true);
});
test('native transaction reviews include postings and attachments; scope never crosses subjects',async()=>{
 const h=harness();const s=await h.view('transaction');assert.equal((s.reviewSource as any).postings.length,1);const a=base(s.reviewRevision,{subjectType:'transaction',subjectId:'tx',issue:'Check posting'});assert.notEqual((await h.call('create_test_review',a)).isError,true);h.postings[0].amount=8;assert.equal((await h.view('transaction')).reviews[0].sourceChangedSinceOpened,true);assert.equal((await h.view()).reviews.length,0);
 assert.equal((await h.call('resolve_test_review',base((await h.view()).reviewRevision,{operationId:key2,reviewId:key}))).isError,true);
});
test('identity, foreign postings, concurrent source changes and failed commit fail closed',async()=>{
 const wrong=harness({org:'wrong'});assert.equal((await wrong.call('create_test_review',base('a'.repeat(64),{issue:'Issue'}))).isError,true);assert.equal(wrong.rows.size,0);
 const foreign=harness({postingOrg:'other'});await assert.rejects(foreign.view('transaction'));
 const race=harness({race:true});assert.equal((await race.call('create_test_review',base((await race.view()).reviewRevision,{issue:'Issue'}))).isError,true);assert.equal(race.rows.size,0);
 const fail=harness({saveFailure:true}),a=base((await fail.view()).reviewRevision,{issue:'Issue'});assert.equal((await fail.call('create_test_review',a)).isError,true);assert.equal((await fail.view()).reviews.length,0);assert.equal((await fail.call('create_test_review',{...a,operationId:key2})).isError,true);assert.equal(fail.rows.size,1);
});
test('read failure reports unavailable reviews, never a misleading empty list',async()=>{const h=harness({lookupFailure:true});const r=await h.safe();assert.equal(r.reviewRevision,null);assert.equal((r as any).reviewsUnavailable,true);assert.equal((r as any).reviews,undefined);assert.ok(!JSON.stringify(r).includes('Private upstream'));});
