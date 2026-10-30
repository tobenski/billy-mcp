import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactHandler,contactSnapshot} from '../src/test-contacts.js';
const key='11111111-1111-4111-8111-111111111111',key2='22222222-2222-4222-8222-222222222222';
const input={operationId:key,reasoning:'Synthetic test',name:'TEST Firma',roles:['customer','supplier'],email:'test@example.invalid',street:'Testvej 1',zip:'0000',city:'Testby'};
const data=(r:any)=>JSON.parse(r.content[0].text);
function harness(options:any={}){
 const contacts:any[]=structuredClone(options.contacts??[]),people:any[]=structuredClone(options.people??[]),rows=new Map<string,any>(),writes:any[]=[];let reads=0;
 const read:any={async get(path:string){if(path==='/organization')return{organization:{id:options.org??'org'}};reads++;if(options.race&&reads===2&&contacts[0])contacts[0].phone='Concurrent edit';return{contact:structuredClone(contacts.find(c=>path==='/contacts/'+c.id))};},async fetchAll(path:string,_key:string,q:any){return structuredClone(path==='/contacts'?contacts:options.foreignPerson?[{id:'bad',contactId:'other'}]:people.filter(p=>p.contactId===q.contactId));}};
 const write:any={async post(path:string,b:any){writes.push({path,body:b});if(path==='/contacts'){const {contactPersons=[],...fields}=b.contact;const c={id:'new',phone:'Keep',isArchived:false,...fields};contacts.push(c);people.push(...contactPersons.map((p:any,i:number)=>({id:'p'+i,contactId:c.id,...p})));if(options.timeout)throw Error('Lost response');return{contacts:[c]};}const p={id:'added',...b.contactPerson};people.push(p);return{contactPersons:[p]};},async put(path:string,b:any){writes.push({path,body:b});if(path.startsWith('/contacts/')){Object.assign(contacts.find(c=>path==='/contacts/'+c.id),b.contact,{updatedTime:'now'});if(options.drift)contacts[0].phone='Unexpected change';}else {if(options.emailTimeout)throw Error('Lost person response');Object.assign(people.find(p=>path==='/contactPersons/'+p.id),b.contactPerson,{updatedTime:'now'});}return{};}};
 const db:any={prepare(sql:string){return{bind(...v:any[]){return{async first(){return rows.get(v[0])??null;},async run(){if(sql.startsWith('INSERT')){if(rows.has(v[0])||[...rows.values()].some(r=>r.target===v[2]&&r.state==='pending'))return{success:true,meta:{changes:0}};rows.set(v[0],{fingerprint:v[1],target:v[2],state:'pending'});}else if(sql.startsWith('DELETE'))rows.delete(v[0]);else Object.assign(rows.get(v[1]),{...(sql.includes("state = 'complete'")?{state:'complete'}:{}),result:v[0]});return{success:true,meta:{changes:1}};}};}};}};
 return{create:(a:any=input)=>contactHandler(read,write,db,'org','create_test_contact')(a),update:(a:any)=>contactHandler(read,write,db,'org','update_test_contact')(a),snapshot:(id='new')=>contactSnapshot(read,'org',id),contacts,people,rows,writes};
}
const update=(s:any,patch:any={})=>({id:s.contact.id,expectedRevision:s.revision,operationId:key2,reasoning:'Update test',...patch});
test('create maps fields, marks contact, creates named primary email and replays',async()=>{
 const h=harness();const a={...input,cvr:'12 34 56 78',vatNumber:'DK12345678'};const r=await h.create(a);assert.notEqual(r.isError,true,JSON.stringify(r));const s=data(r).result;assert.equal(s.contact.registrationNo,'12345678');assert.equal(s.contact.isSupplier,true);assert.equal(s.contact.isCustomer,true);assert.equal(s.contact.countryId,'DK');assert.equal(s.contact.zipcodeText,'0000');assert.match(s.contact.contactNo,/^mcp-test:/);assert.equal(s.contactPersons[0].email,input.email);assert.equal(data(await h.create(a)).replayed,true);assert.equal(h.writes.length,1);
});
test('update preserves unrelated people and fields, changes only primary email; clear nulls and replay',async()=>{
 const h=harness();await h.create();h.people.push({id:'secondary',contactId:'new',name:'Other',email:'other@example.invalid',isPrimary:false});
 const s=await h.snapshot();const a=update(s,{name:'TEST Firma 2',roles:['supplier'],email:'updated@example.invalid',street:null});const r=await h.update(a);assert.notEqual(r.isError,true,JSON.stringify(r));assert.equal(h.contacts[0].phone,'Keep');assert.equal(h.contacts[0].isCustomer,false);assert.equal(h.people[1].email,'other@example.invalid');assert.equal(h.people[0].email,'updated@example.invalid');assert.equal(h.writes[1].body.contact.contactPersons,undefined);assert.deepEqual(h.writes[2].body,{contactPerson:{email:'updated@example.invalid'}});assert.equal(data(await h.update(a)).replayed,true);
 const fresh=await h.snapshot();const clear=await h.update({...update(fresh,{email:null,zip:null,city:null}),operationId:'33333333-3333-4333-8333-333333333333'});assert.notEqual(clear.isError,true,JSON.stringify(clear));assert.equal(h.people.length,2);assert.equal(h.people[0].email,null);
});
test('duplicate normalized name, registration and email are refused before another contact is created',async()=>{
 const h=harness();await h.create({...input,cvr:'12345678'});
 for(const patch of [{name:' test   FIRMA ',email:undefined},{name:'Other',cvr:'DK12345678',email:undefined},{name:'Other',email:'TEST@example.invalid'}]){const r=await h.create({...input,...patch,operationId:key2});assert.equal(r.isError,true);}
 assert.equal(h.writes.length,1);
});
test('stale revisions include contact-person changes; wrong identity/ownership and unmarked contacts refuse',async()=>{
 const h=harness();await h.create();const old=await h.snapshot();h.people[0].email='externally-changed@example.invalid';assert.equal((await h.update(update(old,{name:'New'}))).isError,true);assert.equal(h.writes.length,1);
 const fresh=await h.snapshot();h.contacts[0].contactNo='external';assert.equal((await h.update(update(fresh,{name:'New'}))).isError,true);
 const foreign=harness({org:'other'});assert.equal((await foreign.create()).isError,true);assert.equal(foreign.writes.length,0);
 const bad=harness({contacts:[{id:'new',organizationId:'other'}]});await assert.rejects(bad.snapshot());
 const person=harness({contacts:[{id:'new',organizationId:'org'}],foreignPerson:true});await assert.rejects(person.snapshot());
});
test('unsupported domain/country, conflicting registration and malformed input refuse before writes',async()=>{
 const h=harness();for(const patch of [{domainName:'example.invalid'},{countryCode:'DE'},{cvr:'12345678',vatNumber:'87654321'},{cvr:'abc'},{email:'not-email'},{roles:[]},{roles:['supplier','supplier']}])assert.equal((await h.create({...input,...patch})).isError,true);assert.equal(h.writes.length,0);
});
test('email addition uses separate person endpoint; ambiguous primary and unnamed clear refuse',async()=>{
 const h=harness();await h.create({...input,email:undefined});const r=await h.update(update(await h.snapshot(),{email:'new@example.invalid'}));assert.notEqual(r.isError,true,JSON.stringify(r));assert.equal(h.writes[1].path,'/contactPersons');
 h.people.push({id:'second',contactId:'new',name:'Second',email:'second@example.invalid',isPrimary:true});const a=update(await h.snapshot(),{email:'x@example.invalid'});a.operationId='33333333-3333-4333-8333-333333333333';assert.equal((await h.update(a)).isError,true);
 h.people.pop();h.people[0].name=null;assert.equal((await h.update({...a,expectedRevision:(await h.snapshot()).revision,email:null})).isError,true);assert.equal(h.writes.length,2);
});
test('uncertain create blocks new operations; partial email failure stores contact ID and stays pending',async()=>{
 const h=harness({timeout:true});assert.equal((await h.create()).isError,true);assert.equal((await h.create()).isError,true);assert.equal((await h.create({...input,operationId:key2,name:'Another'})).isError,true);assert.equal(h.writes.length,1);
 const p=harness({emailTimeout:true});await p.create();assert.equal((await p.update(update(await p.snapshot(),{name:'Changed',email:'new@example.invalid'}))).isError,true);const row=p.rows.get('org:'+key2);assert.equal(row.state,'pending');assert.equal(JSON.parse(row.result).contactId,'new');assert.equal(JSON.parse(row.result).stage,'contact_person');
});
test('readback changes to unrelated fields keep operation pending',async()=>{const h=harness({drift:true});await h.create();assert.equal((await h.update(update(await h.snapshot(),{name:'Changed'}))).isError,true);assert.equal(h.rows.get('org:'+key2).state,'pending');});
