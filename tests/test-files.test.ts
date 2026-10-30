import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { registerTestFileTools, decodeFile, downloadBytes, sha256 } from '../src/test-files.js';
import { BillyClient } from '../src/billy-client.js';
const uploadKey='55555555-5555-4555-8555-555555555555';
const attachKey='66666666-6666-4666-8666-666666666666';
const pdf=Buffer.from('%PDF-1.4\nSynthetic test fixture\n%%EOF');
const args={operationId:uploadKey,fileName:'test.pdf',contentType:'application/pdf',base64:pdf.toString('base64')};
function harness(options:{org?:string;state?:string;timeout?:boolean;fileSize?:number;expectedBytes?:Buffer}={}) {
  const rows=new Map<string,any>(); const handlers:Record<string,any>={}; const schemas:Record<string,any>={};let writes=0;let linked:any=null;
  const db:any={prepare(sql:string){return{bind(...a:any[]){return{
    async first(){return rows.get(a[0])??null},async run(){
      if(sql.startsWith('INSERT')) {if(rows.has(a[0])||[...rows.values()].some(x=>x.target===a[2]&&x.state==='pending'))return{success:true,meta:{changes:0}};rows.set(a[0],{fingerprint:a[1],target:a[2],state:'pending',result:null});}
      else if(sql.startsWith('DELETE'))rows.delete(a[0]);else{const row=rows.get(a[1]);if(sql.includes("state = 'complete'"))row.state='complete';row.result=a[0];}
      return{success:true,meta:{changes:1}};
    }
  }}}}};
  const read:any={async get(path:string){
    if(path==='/organization')return{organization:{id:options.org??'org'}};
    if(path==='/daybookTransactions/draft')return{daybookTransaction:{organizationId:'org',state:options.state??'draft',apiType:'mcp-test:example',description:'test'}};
    if(path==='/attachments/link')return{attachment:linked};
    if(path==='/files/file')return{file:{id:'file',fileSize:options.fileSize,downloadUrl:'https://download.billy.dk/test.pdf?token=synthetic'}};
    throw Error('Unexpected read '+path);
  },async fetchAll(){return linked?[linked]:[]}};
  const write:any={async postBinary(path:string,bytes:Uint8Array,opts:any){writes++;assert.equal(path,'/files');assert.deepEqual(Buffer.from(bytes),options.expectedBytes??pdf);assert.equal(opts.organizationId,'org');if(options.timeout)throw Error('timeout');return{files:[{id:'file'}]};},async post(path:string,body:any){writes++;assert.equal(path,'/attachments');linked={id:'link',...body.attachment};return{attachments:[linked]};}};
  registerTestFileTools({registerTool(name:string,config:any,handler:any){handlers[name]=handler;schemas[name]=config.inputSchema;}} as any,read,write,db,'org');
  return{async call(name:string,input:any){return handlers[name](schemas[name].parse(input));},writes:()=>writes,rows};
}
test('upload replay, attach readback and repeated links preserve one file and one association',async()=>{
  const h=harness();const first=await h.call('upload_test_file',args);assert.notEqual(first.isError,true);
  assert.equal(JSON.parse(first.content[0].text).result.sha256,await sha256(pdf));
  const replay=await h.call('upload_test_file',args);assert.equal(JSON.parse(replay.content[0].text).replayed,true);assert.equal(h.writes(),1);
  const attach={operationId:attachKey,uploadOperationId:uploadKey,daybookTransactionId:'draft',expectedDescription:'test'};
  assert.notEqual((await h.call('attach_test_file_to_draft',attach)).isError,true);
  assert.notEqual((await h.call('attach_test_file_to_draft',attach)).isError,true);
  const second=await h.call('attach_test_file_to_draft',{...attach,operationId:'77777777-7777-4777-8777-777777777777'});
  assert.equal(JSON.parse(second.content[0].text).result.alreadyLinked,true);assert.equal(h.writes(),2);
});
test('wrong identity, missing upload and approved draft are blocked',async()=>{
  const wrong=harness({org:'foreign'});assert.equal((await wrong.call('upload_test_file',args)).isError,true);assert.equal(wrong.writes(),0);
  const h=harness({state:'approved'});
  const input={operationId:attachKey,uploadOperationId:uploadKey,daybookTransactionId:'draft',expectedDescription:'test'};
  assert.equal((await h.call('attach_test_file_to_draft',input)).isError,true);
  await h.call('upload_test_file',args);assert.equal((await h.call('attach_test_file_to_draft',input)).isError,true);assert.equal(h.writes(),1);
});
test('upload timeout persists pending and blocks second binary upload',async()=>{
  const h=harness({timeout:true});assert.equal((await h.call('upload_test_file',args)).isError,true);assert.equal((await h.call('upload_test_file',args)).isError,true);assert.equal(h.writes(),1);
});
test('encoding, extension, MIME and size checks reject invalid uploads',()=>{
  assert.throws(()=>decodeFile('%%%','test.pdf','application/pdf'));
  assert.throws(()=>decodeFile(pdf.toString('base64'),'test.png','image/png'));
  assert.throws(()=>decodeFile(Buffer.alloc(2*1024*1024+1).toString('base64'),'test.pdf','application/pdf'));
  assert.throws(()=>decodeFile('AB==','test.pdf','application/pdf'));
});
test('download verifies content hash, returns chunks, and sends no Billy credential',async t=>{
  const h=harness();await h.call('upload_test_file',args);
  t.mock.method(globalThis,'fetch',async (_input,init)=>{assert.equal(init?.headers,undefined);assert.equal(init?.redirect,'manual');return new Response(pdf);});
  const r=await h.call('download_test_file',{uploadOperationId:uploadKey,includeContent:true,offset:0,chunkSize:5});
  assert.notEqual(r.isError,true,JSON.stringify(r));const d=JSON.parse(r.content[0].text);assert.equal(d.verified,true);assert.equal(d.nextOffset,5);assert.equal(Buffer.from(d.base64,'base64').toString(),'%PDF-');
});
test('changed download bytes are rejected',async t=>{
  const h=harness();await h.call('upload_test_file',args);t.mock.method(globalThis,'fetch',async()=>new Response('different'));
  assert.equal((await h.call('download_test_file',{uploadOperationId:uploadKey})).isError,true);
});
test('download blocks arbitrary hosts, credentials, redirects and oversized streams',async t=>{
  const f=t.mock.method(globalThis,'fetch',async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1'}}));
  for(const url of ['http://download.billy.dk/x','https://evil.invalid/x','https://download.billy.dk.evil.invalid/x','https://user:pass@download.billy.dk/x','https://download.billy.dk:1234/x'])await assert.rejects(downloadBytes(url));
  assert.equal(f.mock.callCount(),0);await assert.rejects(downloadBytes('https://download.billy.dk/x'),/redirects/);
  f.mock.mockImplementation(async()=>new Response(new Uint8Array(2*1024*1024+1)));await assert.rejects(downloadBytes('https://download.billy.dk/x'),/too large/);
});
test('binary upload sends exact bytes and organization with no redirects',async t=>{
  t.mock.method(globalThis,'fetch',async(input,init)=>{assert.equal(String(input),'https://api.billysbilling.com/v2/files');assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('x-organizationid'),'org');assert.deepEqual(Buffer.from(init?.body as Uint8Array),pdf);return Response.json({files:[{id:'file'}]});});
  await new BillyClient({accessToken:'synthetic'}).postBinary('/files',pdf,{fileName:'test.pdf',contentType:'application/pdf',organizationId:'org'});
});

test('observed Billy EU S3 bucket is allowed; other S3 buckets are blocked',async t=>{
  const calls=t.mock.method(globalThis,'fetch',async()=>new Response(pdf));
  assert.deepEqual(Buffer.from(await downloadBytes('https://billysbilling-eu.s3.eu-north-1.amazonaws.com/test.pdf')),pdf);
  await assert.rejects(downloadBytes('https://another-bucket.s3.eu-north-1.amazonaws.com/test.pdf'));
  assert.equal(calls.mock.callCount(),1);
});

function associationHarness(options:{state?:string;sourceOrg?:string;sourceOwner?:string;targetOwner?:string;removeOthers?:boolean}={}) {
  const handlers:any={},schemas:any={},rows=new Map<string,any>();let writes=0;
  const links:any[]=[{id:'keep',organizationId:'org',ownerReference:'daybookTransaction:draft',fileId:'other'},{id:'remove',organizationId:'org',ownerReference:options.targetOwner??'daybookTransaction:draft',fileId:'file'}];
  const inbox={id:'inbox',organizationId:options.sourceOrg??'org',ownerReference:options.sourceOwner??null,fileId:'inbox-file'};
  const db:any={prepare(sql:string){return{bind(...a:any[]){return{async first(){return rows.get(a[0])??null},async run(){
    if(sql.startsWith('INSERT')){if(rows.has(a[0]))return{success:true,meta:{changes:0}};rows.set(a[0],{fingerprint:a[1],state:'pending',result:null});}
    else if(sql.startsWith('DELETE'))rows.delete(a[0]);else Object.assign(rows.get(a[1]),{...(sql.includes("state = 'complete'")?{state:'complete'}:{}),result:a[0]});return{success:true,meta:{changes:1}};
  }}}}}};
  const read:any={async get(p:string){
    if(p==='/organization')return{organization:{id:'org'}};
    if(p==='/daybookTransactions/draft')return{daybookTransaction:{organizationId:'org',state:options.state??'draft',apiType:'mcp-test:x',description:'current'}};
    if(p==='/attachments/inbox')return{attachment:inbox};
    if(p.startsWith('/attachments/'))return{attachment:links.find(a=>a.id===p.split('/').pop())};
    if(p.startsWith('/files/'))return{file:{id:p.split('/').pop()}};
    throw Error(p);
  },async fetchAll(){return links.filter(a=>a.ownerReference==='daybookTransaction:draft').map(a=>({...a}));}};
  const write:any={async post(p:string,b:any){writes++;assert.equal(p,'/attachments');const a={id:'new',...b.attachment};links.push(a);return{attachments:[a]};},async del(p:string){writes++;const at=links.findIndex(a=>p==='/attachments/'+a.id);links.splice(at,1);if(options.removeOthers)links.length=0;return{};}};
  registerTestFileTools({registerTool(n:string,c:any,h:any){handlers[n]=h;schemas[n]=c.inputSchema;}} as any,read,write,db,'org');
  return{async call(n:string,args:any){return handlers[n](schemas[n].parse(args));},links,inbox,writes:()=>writes};
}
const associationArgs={operationId:attachKey,attachmentId:'inbox',daybookTransactionId:'draft',expectedDescription:'current'};
test('inbox reuse preserves source and other links, repeat UUID and new UUID do not duplicate',async()=>{
  const h=associationHarness();for(const key of [attachKey,attachKey,uploadKey]){
    const r=await h.call('reuse_test_inbox_attachment',{...associationArgs,operationId:key});assert.notEqual(r.isError,true,JSON.stringify(r));
  }assert.equal(h.writes(),1);assert.equal(h.links.length,3);assert.equal(h.inbox.ownerReference,null);
});
test('remove association preserves file and other links; repeat UUID is replayed',async()=>{
  const h=associationHarness();const args={...associationArgs,attachmentId:'remove'};
  const r=await h.call('remove_test_draft_attachment',args);assert.notEqual(r.isError,true,JSON.stringify(r));
  assert.equal(JSON.parse(r.content[0].text).result.fileRetained,true);assert.deepEqual(h.links.map(a=>a.id),['keep']);
  assert.notEqual((await h.call('remove_test_draft_attachment',args)).isError,true);assert.equal(h.writes(),1);
});
test('reuse rejects foreign or already handled source, approved draft and stale description',async()=>{
  for(const options of [{sourceOrg:'foreign'},{sourceOwner:'bill:other'},{state:'approved'}]){
    const h=associationHarness(options);assert.equal((await h.call('reuse_test_inbox_attachment',associationArgs)).isError,true);assert.equal(h.writes(),0);
  }
  const h=associationHarness();assert.equal((await h.call('reuse_test_inbox_attachment',{...associationArgs,expectedDescription:'old'})).isError,true);assert.equal(h.writes(),0);
});
test('removal rejects attachment from other owner and reports lost unrelated associations',async()=>{
  const wrong=associationHarness({targetOwner:'bill:other'});assert.equal((await wrong.call('remove_test_draft_attachment',{...associationArgs,attachmentId:'remove'})).isError,true);assert.equal(wrong.writes(),0);
  const lost=associationHarness({removeOthers:true});assert.equal((await lost.call('remove_test_draft_attachment',{...associationArgs,attachmentId:'remove'})).isError,true);assert.equal(lost.writes(),1);
});

const pngOriginal=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('original')]);
const pngStored=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('stored')]);
const pngArgs={...args,fileName:'test.png',contentType:'image/png',base64:pngOriginal.toString('base64')};
test('rewritten PNG returns stored bytes in chunks without claiming original verification',async t=>{
 const h=harness({fileSize:pngStored.length,expectedBytes:pngOriginal});assert.notEqual((await h.call('upload_test_file',pngArgs)).isError,true);
 t.mock.method(globalThis,'fetch',async()=>new Response(pngStored));
 const parts:Buffer[]=[];let offset=0;
 for(;;){const r=await h.call('download_test_file',{uploadOperationId:uploadKey,includeContent:true,offset,chunkSize:5});assert.notEqual(r.isError,true,JSON.stringify(r));const d=JSON.parse(r.content[0].text);
 assert.equal(d.verified,false);assert.equal(d.originalMatches,false);assert.equal(d.representation,'billy_stored');assert.equal(d.sha256,await sha256(pngOriginal));assert.equal(d.downloadedSha256,await sha256(pngStored));assert.equal(d.downloadedSizeBytes,pngStored.length);parts.push(Buffer.from(d.base64,'base64'));if(d.nextOffset===null)break;offset=d.nextOffset;}
 assert.deepEqual(Buffer.concat(parts),pngStored);
});
test('PNG signature and stored metadata size remain mandatory for rewritten bytes',async t=>{
 const f=t.mock.method(globalThis,'fetch',async()=>new Response(pngStored));
 for(const size of [undefined,999]){const h=harness({fileSize:size,expectedBytes:pngOriginal});assert.notEqual((await h.call('upload_test_file',pngArgs)).isError,true);assert.equal((await h.call('download_test_file',{uploadOperationId:uploadKey})).isError,true);}
 const h=harness({fileSize:4,expectedBytes:pngOriginal});assert.notEqual((await h.call('upload_test_file',pngArgs)).isError,true);f.mock.mockImplementation(async()=>new Response('oops'));assert.equal((await h.call('download_test_file',{uploadOperationId:uploadKey})).isError,true);
});
