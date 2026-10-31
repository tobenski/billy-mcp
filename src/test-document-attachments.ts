import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export function attachmentOnly(a:any){return Array.isArray(a.attachmentIds)&&a.attachmentIds.length>0&&Object.keys(a).every(k=>['id','operationId','expectedRevision','reasoning','attachmentIds'].includes(k)||a[k]===undefined);}
function stable(s:any,kind:string){const {downloadUrl,updatedTime,...header}=s[kind];return canonical({header,lines:s[kind+'Lines']});}
function verify(before:any,after:any,kind:string,files:string[]){
 if(stable(before,kind)!==stable(after,kind))throw Error('Document financial/header data changed during attachment update');
 if(before.attachments.some((old:any)=>!after.attachments.some((a:any)=>canonical(a)===canonical(old))))throw Error('Existing attachment changed');
 const expected=[...new Set([...before.attachments.map((a:any)=>a.fileId),...files])].sort();
 if(canonical([...new Set(after.attachments.map((a:any)=>a.fileId))].sort())!==canonical(expected))throw Error('Attachment set incomplete or changed');
 const additions=after.attachments.filter((a:any)=>!before.attachments.some((old:any)=>old.id===a.id));
 const needed=files.filter(f=>!before.attachments.some((a:any)=>a.fileId===f));
 if(additions.length!==needed.length||new Set(additions.map((a:any)=>a.fileId)).size!==additions.length)throw Error('Ambiguous attachment additions');
}
export async function updateDocumentAttachments(read:BillyClient,write:BillyClient,db:JournalDB,org:string,kind:'invoice'|'bill',a:any,snapshot:()=>Promise<any>,provenance:(header:any)=>Promise<void>){
 z.string().uuid().parse(a.operationId);id.parse(a.id);z.string().min(1).parse(a.expectedRevision);z.string().min(1).max(4000).parse(a.reasoning);
 if(!attachmentOnly(a))throw new NoWriteError('Attachment-only operation cannot change financial fields');
 const sourceIds=z.array(id).min(1).max(kind==='invoice'?3:5).parse(a.attachmentIds),action='update_test_'+kind+'_draft',payload={action,...a},key=org+':'+a.operationId,target=org+':'+kind+':'+a.id;
 const prior=await db.prepare('SELECT fingerprint, state, result, target'+(db.guardedWrites?', write_phase':'')+' FROM operations WHERE id = ?').bind(key).first<any>();
 if(prior?.state==='pending'&&prior.write_phase!=='prepared'){
  if(prior.fingerprint!==canonical(payload)||prior.target!==target)throw Error('Pending attachment input mismatch');
  const saved=JSON.parse(prior.result??'null');if(saved?.stage!=='before_document_attachments')throw Error('No recoverable attachment evidence');
  const after=await snapshot();await provenance(after[kind]);verify(saved.before,after,kind,saved.files);
  if((await snapshot()).revision!==after.revision)throw Error('Document changed during recovery');
  const result={...after,financialDataUnchanged:true,attachmentOnly:true,recovery:{nativeWrites:0},reasoning:a.reasoning};
  const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),key,prior.fingerprint,target).run();if(!r.success||r.meta.changes!==1)throw Error('Journal changed during recovery');
  return{operationId:a.operationId,replayed:false,result};
 }
 return journalRun(db,org,a.operationId,kind+':'+a.id,payload,async()=>{
  let before:any;const files:string[]=[];
  try{
   before=await snapshot();await provenance(before[kind]);const h=before[kind];
   if(!['draft','approved'].includes(h.state)||![kind,'creditNote'].includes(h.type))throw new NoWriteError('Unsupported document state/type');
   if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read document again');
   for(const sourceId of new Set(sourceIds)){
    const {attachment}=await read.get('/attachments/'+sourceId);if(attachment?.id!==sourceId||attachment.organizationId!==org)throw new NoWriteError('Unexpected attachment ownership');
    const fileId=id.parse(attachment.fileId),{file}=await read.get('/files/'+fileId);if(file?.id!==fileId)throw new NoWriteError('Source file missing');if(!files.includes(fileId))files.push(fileId);
   }
   if((await snapshot()).revision!==before.revision)throw new NoWriteError('Document changed during preflight');
  }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Attachment preflight failed; no write performed');}
  const {downloadUrl,...header}=before[kind];const evidence={stage:'before_document_attachments',before:{...before,[kind]:header},files};
  const saved=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify(evidence),key).run();if(!saved.success||saved.meta.changes!==1)throw new NoWriteError('Cannot preserve attachment evidence');
  for(const fileId of files)if(!before.attachments.some((x:any)=>x.fileId===fileId))await write.post('/attachments',{attachment:{organizationId:org,ownerReference:kind+':'+a.id,fileId}});
  const after=await snapshot();verify(before,after,kind,files);
  return{...after,financialDataUnchanged:true,attachmentOnly:true,reasoning:a.reasoning};
 });
}
