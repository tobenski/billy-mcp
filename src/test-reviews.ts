import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {documentFactsView} from './test-document-facts.js';
import {sha256} from './test-files.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';

export const reviewDescriptions:Record<string,string>={
 create_test_review:'Create an explicit chat-supplied review note for a native transaction or attachment in the test-worker journal. No Billy mutation or automatic accounting judgment. Use reviewRevision from get_transaction/get_test_document as expectedRevision. reviewId is the operation UUID. Read reviews through the same getters. Open reviews are advisory; they do not automatically block booking.',
 resolve_test_review:'Close one existing OPEN review note in the test-worker journal using fresh reviewRevision from get_transaction/get_test_document as expectedRevision. reasoning records the supplied resolution; the tool does not determine whether the accounting issue is actually fixed. Preserves issue and history; no Billy, ledger or document-fact changes. Unknown/already-closed review IDs are refused.',
};
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),kind=z.enum(['transaction','attachment']);
const common={subjectType:kind,subjectId:id,operationId:z.string().uuid(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),reasoning:z.string().min(1).max(4000)};
const createSchema=z.object({...common,issue:z.string().min(1).max(4000).refine(s=>s.trim().length>0)}).strict();
const resolveSchema=z.object({...common,reviewId:z.string().uuid()}).strict();
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const hash=(v:any)=>sha256(new TextEncoder().encode(stable(v)));
const target=(type:string,subjectId:string)=>'reviews:'+type+':'+subjectId;
const sorted=(rows:any[])=>rows.sort((a,b)=>a.id.localeCompare(b.id));

async function source(read:BillyClient,db:JournalDB,orgId:string,type:string,subjectId:string,suppliedAttachment?:any){
 const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 async function attachmentData(attachment:any){
  id.parse(attachment?.id);if(attachment.organizationId!==orgId)throw new NoWriteError('Unexpected attachment organization');
  const facts=await documentFactsView(db,orgId,attachment);return{attachment,factsRevision:facts.revision};
 }
 if(type==='attachment'){
  const attachment=suppliedAttachment??(await read.get('/attachments/'+subjectId)).attachment;
  if(attachment?.id!==subjectId)throw new NoWriteError('Unexpected attachment identity');return attachmentData(attachment);
 }
 const {transaction}=await read.get('/transactions/'+subjectId);if(transaction?.id!==subjectId||transaction.organizationId!==orgId)throw new NoWriteError('Unexpected transaction');
 const postings=await read.fetchAll('/postings','postings',{organizationId:orgId,transactionId:subjectId});
 for(const p of postings){id.parse(p.id);if(p.organizationId!==orgId||p.transactionId!==subjectId)throw new NoWriteError('Unexpected posting ownership');}
 const attachments:any[]=[];
 if(transaction.originatorReference){
  if(!/^[A-Za-z]+:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Unsupported transaction originator');
  const links=await read.fetchAll('/attachments','attachments',{organizationId:orgId,ownerReference:transaction.originatorReference});
  for(const a of sorted(links)){if(a.ownerReference!==transaction.originatorReference)throw new NoWriteError('Unexpected attachment owner');attachments.push(await attachmentData(a));}
 }
 return{transaction,postings:sorted(postings),attachments};
}
export async function reviewView(read:BillyClient,db:JournalDB,orgId:string,subjectType:string,subjectId:string,attachment?:any){
 kind.parse(subjectType);id.parse(subjectId);
 const reviewSource=await source(read,db,orgId,subjectType,subjectId,attachment),reviewSourceRevision=await hash(reviewSource);
 const row=await db.prepare("SELECT result FROM operations WHERE target = ? AND state = 'complete' ORDER BY rowid DESC LIMIT 1").bind(orgId+':'+target(subjectType,subjectId)).first<{result:string}>();
 const saved=row?JSON.parse(row.result):null;
 if(saved&&(saved.organizationId!==orgId||saved.subjectId!==subjectId||saved.subjectType!==subjectType||saved.storage!=='test_worker_reviews'||!Array.isArray(saved.reviews)))throw new Error('Invalid review history');
 const stored=saved?.reviews??[];
 const reviewRevision=await hash({reviewSourceRevision,reviews:stored,operationId:saved?.operationId??null});
 return{reviewRevision,reviewSourceRevision,reviewSource,reviewStorage:'test_worker_journal',reviews:stored.map((r:any)=>({...r,sourceChangedSinceOpened:r.openedSourceRevision!==reviewSourceRevision,...(r.status==='resolved'?{sourceChangedSinceResolved:r.resolvedSourceRevision!==reviewSourceRevision}:{})})),reviewNotes:['Chat-supplied review notes, not native Billy review states.','Closure records the supplied resolution, not independently verified correctness.','Open notes do not automatically block booking.']};
}
export async function reviewRead(read:BillyClient,db:JournalDB,orgId:string,subjectType:string,subjectId:string,attachment?:any){
 try{return await reviewView(read,db,orgId,subjectType,subjectId,attachment);}
 catch{return{reviewRevision:null,reviewsUnavailable:true,reviewNotes:['Review evidence/history could not be verified. This is not evidence of no open reviews. Review writes require a successful fresh read.']};}
}
export function reviewHandler(read:BillyClient,db:JournalDB,orgId:string,tool:string){return async(input:any)=>{try{
 if(!(tool in reviewDescriptions))throw new NoWriteError('Unknown review tool');const create=tool==='create_test_review';
 const a=(create?createSchema:resolveSchema).parse(input);
 const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 return jsonResult(await journalRun(db,orgId,a.operationId,target(a.subjectType,a.subjectId),{action:tool,...a},async()=>{
 let before:any;
 try{
  before=await reviewView(read,db,orgId,a.subjectType,a.subjectId);
  if(before.reviewRevision!==a.expectedRevision)throw new NoWriteError('STALE_REVIEW_REVISION: use reviewRevision from a fresh subject read');
  if((await reviewView(read,db,orgId,a.subjectType,a.subjectId)).reviewRevision!==before.reviewRevision)throw new NoWriteError('Subject or review history changed during preflight');
  const reviews=before.reviews.map(({sourceChangedSinceOpened,sourceChangedSinceResolved,...r}:any)=>r);
  const now=new Date().toISOString();let reviewId:string;
  if(create){
   if(reviews.length>=100)throw new NoWriteError('Review limit reached for this test subject');
   const issue=(a as z.infer<typeof createSchema>).issue;
   if(reviews.some((r:any)=>r.status==='open'&&r.issue.trim()===issue.trim()))throw new NoWriteError('An identical open review already exists');
   reviewId=a.operationId;reviews.push({id:reviewId,status:'open',issue,openedAt:now,openedSourceRevision:before.reviewSourceRevision,openingReasoning:a.reasoning});
  }else{
   reviewId=(a as z.infer<typeof resolveSchema>).reviewId;const r=reviews.find((r:any)=>r.id===reviewId);
   if(!r)throw new NoWriteError('Unknown review ID for this subject');if(r.status!=='open')throw new NoWriteError('Review is already closed');
   Object.assign(r,{status:'resolved',resolvedAt:now,resolution:a.reasoning,resolutionOperationId:a.operationId,resolvedSourceRevision:before.reviewSourceRevision});
  }
  if(new TextEncoder().encode(JSON.stringify(reviews)).length>131072)throw new NoWriteError('Review history exceeds 128 KiB');
  return{storage:'test_worker_reviews',organizationId:orgId,subjectType:a.subjectType,subjectId:a.subjectId,operationId:a.operationId,reviewId,reviews,reviewRevision:await hash({reviewSourceRevision:before.reviewSourceRevision,reviews,operationId:a.operationId}),billyWritePerformed:false,ledgerEffect:'none'};
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Review preflight failed. No review saved.');}
 }));
 }catch(e){return errorResult(e);}};}
