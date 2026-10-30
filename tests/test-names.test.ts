import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nameHandler} from '../src/test-names.js';
const args={id:'record',name:'Nyt navn æøå',expectedName:'Old',operationId:'11111111-1111-4111-8111-111111111111',reasoning:'Test'};
function harness(kind='account',options:any={}){
 const record:any={id:'record',organizationId:'org',name:'Old',natureId:'expense',description:'Keep',accountNo:1815,isArchived:false,...options.record};
 const rows=new Map<string,any>();let reads=0;const writes:any[]=[];
 const read:any={async get(path:string){if(path==='/organization')return{organization:{id:options.org??'org'}};assert.equal(path,'/'+kind+'s/record');reads++;if(options.race&&reads===2)record.description='Concurrent edit';return{[kind]:structuredClone(record)};}};
 const write:any={async put(path:string,body:any){writes.push({path,body});Object.assign(record,body[kind]);record.updatedTime='now';if(options.drift)record.natureId='asset';if(options.timeout)throw Error('Lost response');}};
 const db:any={prepare(sql:string){return{bind(...v:any[]){return{async first(){return rows.get(v[0])??null;},async run(){if(sql.startsWith('INSERT')){if(rows.has(v[0])||[...rows.values()].some(r=>r.target===v[2]&&r.state==='pending'))return{success:true,meta:{changes:0}};rows.set(v[0],{fingerprint:v[1],target:v[2],state:'pending'});}else if(sql.startsWith('DELETE'))rows.delete(v[0]);else Object.assign(rows.get(v[1]),{...(sql.includes("state = 'complete'")?{state:'complete'}:{}),result:v[0]});return{success:true,meta:{changes:1}};}};}};}};
 return{call:(a:any=args)=>nameHandler(read,write,db,'org',kind==='account'?'rename_test_account':'rename_test_account_group')(a),record,writes};
}
const data=(r:any)=>JSON.parse(r.content[0].text);
test('account and group rename send name only, preserve fields and replay without a second write',async()=>{
 for(const kind of ['account','accountGroup']){const h=harness(kind);const r=await h.call();assert.notEqual(r.isError,true,JSON.stringify(r));assert.equal(data(r).result[kind].name,args.name);assert.deepEqual(h.writes,[{path:'/'+kind+'s/record',body:{[kind]:{name:args.name}}}]);assert.equal(h.record.description,'Keep');assert.equal(data(await h.call()).replayed,true);assert.equal(h.writes.length,1);assert.equal((await h.call({...args,name:'Other'})).isError,true);}
});
test('identity, archived, stale name, invalid input and concurrent changes refuse before mutation',async()=>{
 for(const options of [{org:'other'},{record:{organizationId:'other'}},{record:{id:'other'}},{record:{isArchived:true}},{record:{name:'Changed'}},{race:true}]){const h=harness('account',options);assert.equal((await h.call()).isError,true);assert.equal(h.writes.length,0);}
 for(const patch of [{name:' '},{name:' New'},{name:'A\nB'},{name:'x'.repeat(101)},{id:'../accounts'},{operationId:'invalid'},{accountNo:9999}]){const h=harness();assert.equal((await h.call({...args,...patch})).isError,true);assert.equal(h.writes.length,0);}
});
test('same-name request is explicit no-op and stale rejection releases the operation',async()=>{
 const h=harness();assert.equal((await h.call({...args,expectedName:'Wrong'})).isError,true);assert.notEqual((await h.call()).isError,true);
 const n=harness();assert.equal(data(await n.call({...args,name:'Old'})).result.changed,false);assert.equal(n.writes.length,0);
});
test('lost response or changed non-name fields leave pending lock, including against a new operation UUID',async()=>{
 for(const options of [{timeout:true},{drift:true}]){const h=harness('account',options);assert.equal((await h.call()).isError,true);assert.equal((await h.call()).isError,true);assert.equal((await h.call({...args,operationId:'22222222-2222-4222-8222-222222222222'})).isError,true);assert.equal(h.writes.length,1);}
});

test('predefined account groups are rejected without a write',async()=>{const h=harness('accountGroup',{record:{predefinedAccountGroupId:'template'}});const r=await h.call();assert.equal(r.isError,true);assert.match(r.content[0].text,/Predefined/);assert.equal(h.writes.length,0);});
