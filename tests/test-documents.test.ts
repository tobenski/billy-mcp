import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentHandler} from '../src/test-documents.js';
const attachment={id:'att',organizationId:'org',fileId:'file',ownerReference:null,amount:null,supplier:null,documentDate:null,currencyId:'DKK'};
const file={id:'file',fileName:'test.pdf',downloadUrl:'https://example.invalid/signed'};
function harness(options:{org?:string;attachment?:any;file?:any;missingFile?:boolean;page?:any}={}){
 const calls:any[]=[];const read:any={async get(path:string,query:any){calls.push({path,query});if(path==='/organization')return{organization:{id:options.org??'org'}};if(path==='/attachments/att')return{attachment:options.attachment??attachment};if(path==='/files/file'){if(options.missingFile)throw Error('private upstream response');return{file:options.file??file};}if(path==='/attachments')return options.page??{meta:{paging:{page:1,pageCount:1,total:1}},attachments:[attachment],files:[file]};throw Error('Unexpected path');}};
 return{calls,call:(name:string,a:any)=>documentHandler(read,'org',name)(a)};
}
const data=(r:any)=>JSON.parse(r.content[0].text);
test('single document preserves null facts; metadata optional and no document download',async()=>{
 const h=harness();const r=data(await h.call('get_test_document',{attachmentId:'att'}));assert.deepEqual(r.attachment,attachment);assert.equal(r.partial,false);assert.equal(r.files,undefined);assert.equal(h.calls.length,2);
 const withFile=data(await h.call('get_test_document',{attachmentId:'att',includeFiles:true}));assert.deepEqual(withFile.files,[file]);assert.equal(withFile.coverage.documentBytesDownloaded,false);assert.equal(h.calls.at(-1).path,'/files/file');
});
test('missing file metadata returns attachment with explicit partial flag and sanitized error',async()=>{
 const h=harness({missingFile:true});const r=await h.call('get_test_document',{attachmentId:'att',includeFiles:true});assert.notEqual(r.isError,true);assert.equal(data(r).partial,true);assert.equal(data(r).attachment.id,'att');assert.ok(!r.content[0].text.includes('private upstream'));
});
test('wrong organization, attachment identity and path input fail closed',async()=>{
 for(const options of [{org:'other'},{attachment:{...attachment,organizationId:'other'}},{attachment:{...attachment,id:'wrong'}}]){const h=harness(options);assert.equal((await h.call('get_test_document',{attachmentId:'att',includeFiles:true})).isError,true);assert.ok(!h.calls.some(c=>c.path==='/files/file'));}
 const h=harness();assert.equal((await h.call('get_test_document',{attachmentId:'../organization'})).isError,true);assert.equal(h.calls.length,0);
});
test('search maps documented date/vendor/amount/text filters and deduplicates referenced files',async()=>{
 const h=harness({page:{meta:{paging:{page:2,pageCount:3,total:6}},attachments:[attachment,{...attachment,id:'att2'}],files:[file,{id:'unrelated'}]}});
 const r=data(await h.call('search_test_documents',{fromDate:'2026-01-01',toDate:'2026-10-30',vendor:' Test ',query:' AB ',amount:0,page:2,pageSize:2}));
 const q=h.calls.at(-1).query;assert.equal(q.sortProperty,'createdTime');assert.equal(q.sortDirection,'DESC');assert.equal(q.documentDatePeriod,'dates:2026-01-01...2026-10-30');assert.equal(q.supplier,'Test');assert.equal(q.q,'AB');assert.equal(q.amount,0);assert.equal(r.files.length,1);assert.equal(r.coverage.nextPage,3);
});
test('empty currency-filtered page keeps native totals and next page; missing values are not zero',async()=>{
 const h=harness({page:{meta:{paging:{page:1,pageCount:2,total:2}},attachments:[{...attachment,currencyId:null}],files:[file]}});
 const r=data(await h.call('search_test_documents',{currencyId:'EUR'}));assert.deepEqual(r.attachments,[]);assert.equal(r.meta.paging.total,2);assert.equal(r.coverage.nextPage,2);assert.equal(r.coverage.unknownCurrency,1);assert.equal(r.coverage.excludedByCurrency,1);assert.deepEqual(r.files,[]);
});
test('unsupported invoice filter, bad dates and short query reject before network',async()=>{
 for(const args of [{invoiceNumber:'123'},{fromDate:'2026-02-30'},{fromDate:'2026-12-01',toDate:'2026-01-01'},{query:'a'},{vendor:' '}]){const h=harness();assert.equal((await h.call('search_test_documents',args)).isError,true);assert.equal(h.calls.length,0);}
});
test('search refuses ignored status/foreign records; missing file and paging are explicit',async()=>{
 for(const [args,row] of [[{status:'handled'},attachment],[{}, {...attachment,organizationId:'other'}]] as const){const h=harness({page:{attachments:[row]}});assert.equal((await h.call('search_test_documents',args)).isError,true);}
 const h=harness({page:{attachments:[attachment]}});const r=data(await h.call('search_test_documents',{}));assert.equal(r.partial,true);assert.equal(r.coverage.hasMore,null);assert.equal(r.fileErrors[0].code,'FILE_METADATA_UNAVAILABLE');
});
