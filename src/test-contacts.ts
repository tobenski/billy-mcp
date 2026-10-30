import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {sha256} from './test-files.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';

export const contactDescriptions:Record<string,string>={
 create_test_contact:'Create a test-marked Danish customer/supplier with duplicate checks across native contacts (name, registration number and supplied email). Default country DK; other countries and domainName refused in phase 1. CVR/vatNumber map to one registrationNo and must agree. Optional email creates a named primary contact person. No messages sent. Persistent operation replay.',
 update_test_contact:'Update only supplied fields of an active test-tool-marked Danish contact using revision from get_contact. Null clears supported optional fields. Preserves unrelated contact persons; email targets one unambiguous primary/sole person. No messages sent. domainName and foreign countries refused. Duplicate checks and persistent operation replay.',
};
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const normalized=(s:any)=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';
const reg=(s:any)=>typeof s==='string'?s.toUpperCase().replace(/[\s-]/g,'').replace(/^DK/,''):'';
const emailKey=(s:any)=>typeof s==='string'?s.trim().toLowerCase():'';

async function persons(read:BillyClient,contactId:string){
 const rows=await read.fetchAll('/contactPersons','contactPersons',{contactId});
 for(const row of rows){id.parse(row.id);if(row.contactId!==contactId)throw new NoWriteError('Unexpected contact person ownership');}
 return rows.sort((a:any,b:any)=>a.id.localeCompare(b.id));
}
export async function contactSnapshot(read:BillyClient,orgId:string,contactId:string){
 id.parse(contactId);const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 const {contact}=await read.get('/contacts/'+contactId);
 if(contact?.id!==contactId||contact.organizationId!==orgId)throw new NoWriteError('Unexpected contact');
 const contactPersons=await persons(read,contactId);
 return{contact,contactPersons,revision:await sha256(new TextEncoder().encode(stable({contact,contactPersons})))};
}
function fields(a:any,create:boolean){
 if(a.domainName!==undefined)throw new NoWriteError('domainName has no verified native mapping; omit it');
 if(a.countryCode!==undefined&&a.countryCode!=='DK')throw new NoWriteError('Phase 1 supports DK contacts only');
 const out:any={};
 if(create||a.countryCode!==undefined)out.countryId='DK';
 if(a.name!==undefined){z.string().min(1).max(100).refine(s=>s.trim()===s&&!/[\u0000-\u001f]/.test(s)).parse(a.name);out.name=a.name;}
 if(a.roles!==undefined){z.array(z.enum(['customer','supplier'])).min(1).max(2).refine(v=>new Set(v).size===v.length).parse(a.roles);out.isCustomer=a.roles.includes('customer');out.isSupplier=a.roles.includes('supplier');}
 if(create&&(out.name===undefined||a.roles===undefined))throw new NoWriteError('Name and roles are required');
 for(const [input,native] of [['street','street'],['zip','zipcodeText'],['city','cityText']])if(a[input]!==undefined){z.string().max(input==='zip'?20:500).nullable().parse(a[input]);out[native]=a[input];}
 if(a.cvr!==undefined||a.vatNumber!==undefined){
  const values=[a.cvr,a.vatNumber].filter(v=>v!==undefined).map(v=>v===null?null:reg(v));
  if(values.some(v=>v!==null&&!/^\d{8}$/.test(v)))throw new NoWriteError('Danish registration numbers require eight digits (optional DK prefix)');
  if(values.length===2&&values[0]!==values[1])throw new NoWriteError('cvr and vatNumber map to one Billy field and must agree');
  out.registrationNo=values[0];
 }
 if(a.email!==undefined&&a.email!==null)z.email().max(254).parse(a.email);
 if(!create&&Object.keys(out).length===0&&a.email===undefined)throw new NoWriteError('Supply at least one supported change');
 return out;
}
async function duplicates(read:BillyClient,orgId:string,candidate:any,email:string|null|undefined,except?:string){
 const contacts=await read.fetchAll('/contacts','contacts',{organizationId:orgId},1000);
 for(const c of contacts){
  id.parse(c.id);if(c.organizationId!==orgId)throw new NoWriteError('Unexpected contact organization');
  if(c.id===except)continue;
  if((c.countryId===candidate.countryId&&normalized(c.name)===normalized(candidate.name))||(candidate.registrationNo&&c.countryId===candidate.countryId&&reg(c.registrationNo)===reg(candidate.registrationNo)))throw new NoWriteError('Possible duplicate contact: '+c.id+'; read and reuse it instead');
  if(email&&(await persons(read,c.id)).some((p:any)=>emailKey(p.email)===emailKey(email)))throw new NoWriteError('Email already belongs to contact '+c.id);
 }
}
function equalField(actual:any,expected:any){return expected===null?(actual===null||actual===''):actual===expected;}
function omit(record:any,keys:string[]){return Object.fromEntries(Object.entries(record).filter(([k])=>!keys.includes(k)));}

export function contactHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,tool:string){return async(a:any)=>{try{
 const create=tool==='create_test_contact';if(!create&&tool!=='update_test_contact')throw new NoWriteError('Unknown contact tool');
 z.string().uuid().parse(a.operationId);z.string().min(1).max(4000).parse(a.reasoning);
 if(!create){id.parse(a.id);z.string().min(1).parse(a.expectedRevision);}
 const patch=fields(a,create);
 const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 // Serialize contact mutations in this worker to make duplicate checks effective across simultaneous calls.
 return jsonResult(await journalRun(db,orgId,a.operationId,'contacts',{action:tool,...a},async()=>{
 let before:any,person:any,candidate:any;
 try{
  if(create)candidate={organizationId:orgId,...patch,contactNo:'mcp-test:'+a.operationId,type:'company'};
  else{
   before=await contactSnapshot(read,orgId,a.id);
   if(before.contact.isArchived||before.contact.countryId!=='DK'||!before.contact.contactNo?.startsWith('mcp-test:'))throw new NoWriteError('Only active test-tool-marked DK contacts may be updated');
   if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_contact again');
   candidate={...before.contact,...patch};
   if(a.email!==undefined){
    const primary=before.contactPersons.filter((p:any)=>p.isPrimary===true);
    if(primary.length>1||primary.length===0&&before.contactPersons.length>1)throw new NoWriteError('Ambiguous email recipient; select a primary person in Billy first');
    person=primary[0]??before.contactPersons[0];
    if(a.email===null&&person&&!person.name?.trim())throw new NoWriteError('Cannot clear email of unnamed contact person; give it a name first');
   }
  }
  await duplicates(read,orgId,candidate,a.email,create?undefined:a.id);
  if(!create&&(await contactSnapshot(read,orgId,a.id)).revision!==before.revision)throw new NoWriteError('Contact changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Contact preflight failed. No write performed.');}
 let contactId=create?undefined:a.id,stage='contact';
 try{
  if(create){
   const payload={...candidate,...(a.email?{contactPersons:[{name:a.name,email:a.email,isPrimary:true}]}:{})};
   const response=await write.post('/contacts',{contact:payload});contactId=id.parse(response.contacts?.[0]?.id);
  }else{
   if(Object.keys(patch).some(k=>!equalField(before.contact[k],patch[k])))await write.put('/contacts/'+a.id,{contact:patch});
   stage='contact_person';
   if(a.email!==undefined){
    if(person){if(!equalField(person.email,a.email))await write.put('/contactPersons/'+person.id,{contactPerson:{email:a.email}});}
    else if(a.email!==null)await write.post('/contactPersons',{contactPerson:{contactId:a.id,name:candidate.name,email:a.email,isPrimary:true}});
   }
  }
  stage='readback';const after=await contactSnapshot(read,orgId,contactId!);
  for(const [key,value] of Object.entries(create?candidate:patch))if(!equalField(after.contact[key],value))throw new Error('Contact readback mismatch: '+key);
  if(!create){
   if(stable(omit(before.contact,[...Object.keys(patch),'updatedTime']))!==stable(omit(after.contact,[...Object.keys(patch),'updatedTime'])))throw new Error('Unrelated contact fields changed');
   for(const old of before.contactPersons){const saved=after.contactPersons.find((p:any)=>p.id===old.id);const ignored=['updatedTime',...(old.id===person?.id&&a.email!==undefined?['email']:[])];if(!saved||stable(omit(old,ignored))!==stable(omit(saved,ignored)))throw new Error('Unrelated contact person changed');}
  }
  if(a.email!==undefined){
   const selected=person?after.contactPersons.find((p:any)=>p.id===person.id):after.contactPersons.find((p:any)=>p.isPrimary);
   if(a.email!==null&&(!selected||!equalField(selected.email,a.email)))throw new Error('Email readback mismatch');
   if(a.email===null&&selected&&!equalField(selected.email,null))throw new Error('Email not cleared');
  }
  const expectedCount=create?(a.email?1:0):before.contactPersons.length+(!person&&a.email!==undefined&&a.email!==null?1:0);
  if(after.contactPersons.length!==expectedCount)throw new Error('Unexpected contact-person count');
  return{...after,created:create,reasoning:a.reasoning,limitations:['DK only; domainName unsupported.','CVR format checked only, not registry-validated.','Duplicate/revision checks are optimistic against external Billy edits.']};
 }catch(e){
  const match=(e instanceof Error?e.message:'').match(/failed with (\d+): ([\s\S]*)/);let errorMessage:string|undefined;
  try{const body=JSON.parse(match?.[2]??'{}');if(typeof body.errorMessage==='string')errorMessage=body.errorMessage.slice(0,300);}catch{}
  await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify({stage,contactId:contactId??null,httpStatus:match?Number(match[1]):null,errorMessage,outcome:'Inspect contact and contact persons before resolving; no automatic retry.'}),orgId+':'+a.operationId).run();throw e;
 }
 }));
 }catch(e){return errorResult(e);}};}
