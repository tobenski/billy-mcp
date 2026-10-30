import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {sha256} from './test-files.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';

export const factsDescription='Save a FULL snapshot of chat-supplied document facts as test-worker database annotations linked to one Billy attachment. Does NOT write Billy OCR fields, file contents, comments or ledger entries. Optional fields omitted from this snapshot are removed from prior annotations; null means unknown. Read get_test_document for expectedRevision and saved documentFacts. Native search filters do not search these annotations. No OCR or accounting analysis. Persistent replay and revision checks.';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const text=(max:number)=>z.string().max(max);
const amount=z.number().finite().min(-1e12).max(1e12);
const factSchema=z.object({
 documentType:z.enum(['invoice','credit_note','receipt','card_receipt','order_confirmation','missing','other']),
 date:z.iso.date().nullable(),dueDate:z.iso.date().nullable().optional(),currencyId:z.string().regex(/^[A-Z]{3}$/).nullable(),
 vendorName:text(500).nullable(),vendorVatNumber:text(100).nullable().optional(),vendorAddress:text(2000).nullable().optional(),customerName:text(500).nullable().optional(),
 invoiceNumber:text(200).nullable().optional(),totalAmount:amount.nullable(),totalVatAmount:amount.nullable().optional(),amountDue:amount.nullable().optional(),summary:text(8000),
 lineItems:z.array(z.object({description:text(2000),amount,vatAmount:amount.nullable().optional()}).strict()).max(200).optional(),
}).strict();
const inputSchema=factSchema.extend({attachmentId:id,operationId:z.string().uuid(),reasoning:z.string().min(1).max(4000),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const hash=(v:any)=>sha256(new TextEncoder().encode(stable(v)));
const target=(attachmentId:string)=>'document-facts:'+attachmentId;

export async function documentFactsView(db:JournalDB,orgId:string,attachment:any){
 id.parse(attachment.id);id.parse(attachment.fileId);if(attachment.organizationId!==orgId)throw new NoWriteError('Unexpected attachment organization');
 // The completed journal is an append-only annotation history. Pending operations never become visible as saved facts.
 const row=await db.prepare("SELECT result FROM operations WHERE target = ? AND state = 'complete' ORDER BY rowid DESC LIMIT 1").bind(orgId+':'+target(attachment.id)).first<{result:string}>();
 const saved=row?JSON.parse(row.result):null;
 if(saved&&(saved.attachmentId!==attachment.id||saved.organizationId!==orgId||saved.storage!=='test_worker_journal'))throw new Error('Invalid stored document facts');
 const facts=saved?factSchema.parse(saved.facts):null;
 const nativeRevision=await hash(attachment);
 const revision=await hash({attachment,facts,operationId:saved?.operationId??null});
 return{revision,documentFacts:saved?{values:facts,storage:'test_worker_journal',source:'chat_supplied',operationId:saved.operationId,recordedAt:saved.recordedAt,reasoning:saved.reasoning,fileIdAtSave:saved.fileId,nativeAttachmentChanged:saved.nativeRevision!==nativeRevision,appliesToCurrentAttachment:saved.fileId===attachment.fileId&&saved.nativeRevision===nativeRevision}:null};
}
async function snapshot(read:BillyClient,db:JournalDB,orgId:string,attachmentId:string){
 const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 const {attachment}=await read.get('/attachments/'+attachmentId);
 if(attachment?.id!==attachmentId||attachment.organizationId!==orgId)throw new NoWriteError('Unexpected attachment');
 return{attachment,...await documentFactsView(db,orgId,attachment)};
}
export function factsHandler(read:BillyClient,db:JournalDB,orgId:string){return async(input:any)=>{try{
 const a=inputSchema.parse(input);const {attachmentId,operationId,reasoning,expectedRevision,...facts}=a;
 if(new TextEncoder().encode(JSON.stringify(facts)).length>65536)throw new NoWriteError('Document facts exceed 64 KiB');
 // Verify token even when replaying a completed operation.
 const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 return jsonResult(await journalRun(db,orgId,operationId,target(attachmentId),{action:'set_test_document_facts',...a},async()=>{
 let before:any;
 try{
  before=await snapshot(read,db,orgId,attachmentId);
  if(before.revision!==expectedRevision)throw new NoWriteError('STALE_REVISION: read get_test_document again');
  if((await snapshot(read,db,orgId,attachmentId)).revision!==before.revision)throw new NoWriteError('Attachment or facts changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Document-facts preflight failed. No facts saved.');}
 // journalRun commits this entire result atomically to D1; there is no Billy write and no intermediate side table.
 return{storage:'test_worker_journal',organizationId:orgId,attachmentId,fileId:before.attachment.fileId,facts,operationId,reasoning,recordedAt:new Date().toISOString(),nativeRevision:await hash(before.attachment),revision:await hash({attachment:before.attachment,facts,operationId}),billyWritePerformed:false,ledgerEffect:'none'};
 }));
 }catch(e){return errorResult(e);}};}
