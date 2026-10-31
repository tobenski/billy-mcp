import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerRoadmapTools,roadmapTools,numinaCoverage,unsupportedCapabilities} from '../src/test-roadmap.js';
test('every reserved handler fails closed with no network, even when writes enabled',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('Unexpected network');});
 for(const enabled of [false,true]){
 const registry=new Map<string,any>();
 registerRoadmapTools({registerTool(name:string,config:any,handler:any){assert.ok(!registry.has(name));registry.set(name,{config,handler});}} as any,enabled);
 assert.equal(registry.size,roadmapTools.length+1);
 for(const tool of roadmapTools){const item=registry.get(tool.name);assert.equal(item.config.annotations.readOnlyHint,!tool.mutation);const r=await item.handler({});assert.equal(r.isError,true);const d=JSON.parse(r.content[0].text);assert.equal(d.error_code,'NOT_IMPLEMENTED');assert.equal(d.writePerformed,false);assert.equal(d.tool,tool.name);}
 const r=await registry.get('get_test_tool_status').handler({});const d=JSON.parse(r.content[0].text);assert.equal(d.writesEnabled,enabled);assert.equal(d.tools.length,roadmapTools.length);assert.equal(Object.keys(d.numinaCoverage).length,27);
 }assert.equal(fetch.mock.callCount(),0);
});
test('reserved writes require operation identity; reject arbitrary extra fields',()=>{
 for(const tool of roadmapTools){assert.equal(tool.schema.safeParse({unexpected:'anything'}).success,false);if(tool.mutation)assert.ok('operationId' in tool.schema.shape);}
 const rename=roadmapTools.find(t=>t.name==='rename_test_account')!;
 assert.equal(rename.schema.safeParse({operationId:'11111111-1111-4111-8111-111111111111',reasoning:'Test',id:'a',expectedName:'Old',name:'New'}).success,true);
});
test('Numina comparison preserves the upload-link gap without inventing semantic parity',()=>{
 assert.equal(Object.keys(numinaCoverage).length,27);for(const [name,targets] of Object.entries(numinaCoverage))if(name==='create_upload_link')assert.deepEqual(targets,[]);else assert.ok(targets.length>0);
 assert.equal(unsupportedCapabilities.uploadLink.equivalent,false);assert.deepEqual(unsupportedCapabilities.uploadLink.alternativeTools,['upload_test_file']);assert.equal(new Set(roadmapTools.map(t=>t.name)).size,46);
});

test('supplier correction and recorded-payment reversal contracts are explicit and strict',()=>{const find=(name:string)=>roadmapTools.find(t=>t.name===name)!;const op={operationId:'51111111-1111-4111-8111-000000000001',reasoning:'test',expectedRevision:'revision'};assert.ok(find('create_test_bill_credit_note_draft').mutation);assert.equal(find('get_test_document_payment').schema.safeParse({paymentId:'pay'}).success,true);assert.equal(find('void_test_document_payment').schema.safeParse({...op,paymentId:'pay'}).success,true);assert.equal(find('void_test_document_payment').schema.safeParse({...op,paymentId:'pay',sendPayment:true}).success,false);});

test('removed native placeholders are absent from registration and status; gaps remain explicit',async()=>{for(const enabled of [true,false]){const registry=new Map<string,any>();registerRoadmapTools({registerTool(n:string,c:any,h:any){registry.set(n,h);}} as any,enabled);for(const name of ['create_test_upload_link','get_test_oss_report'])assert.equal(registry.has(name),false);const r=await registry.get('get_test_tool_status')({}),d=JSON.parse(r.content[0].text);assert.equal(d.contractVersion,3);assert.equal(d.tools.length,46);assert.ok(d.tools.every((t:any)=>!['create_test_upload_link','get_test_oss_report'].includes(t.name)));assert.equal(d.unsupportedCapabilities.ossReport.equivalent,false);assert.deepEqual(d.numinaCoverage.create_upload_link,[]);}});
