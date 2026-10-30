import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {draftSnapshot} from './test-extended-drafts.js';
import {validate,posted} from './test-finalize.js';
import {sha256} from './test-files.js';
import {errorResult,jsonResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
export const correctionDescriptions:Record<string,string>={
 propose_test_booked_change:'Create a correction DRAFT containing reversal of all original posted DKK lines plus the supplied full replacement. Original is never changed or voided. Test entries only; bank-matched entries, VAT and currency conversions refused. transactionId is a native transaction ID; expectedRevision comes from get_transaction. Copies source attachment links. Requires separate book_test_daybook_draft after review.',
 propose_test_reversal:'Create a reversal-only DRAFT for a native test transaction, preserving the original. DKK without VAT only; bank-matched entries refused. Uses expectedRevision from get_transaction. No immediate ledger effect, no native void and no deletion; book separately after review.',
};
export async function correctionSource(read:BillyClient,orgId:string,transactionId:string){
 id.parse(transactionId);const {organization}=await read.get('/organization');if(organization?.id!==orgId||organization.baseCurrencyId!=='DKK')throw new Error('Expected DKK test organization');
 const {transaction}=await read.get('/transactions/'+transactionId);
 if(transaction?.id!==transactionId||transaction.organizationId!==orgId||transaction.isVoided||transaction.isVoid||!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Only active native daybook transactions may be corrected');
 const source=await draftSnapshot(read,transaction.originatorReference.split(':')[1],orgId);validate(source,'approved');
 if(source.daybookTransaction.apiType.startsWith('mcp-test:correction:'))throw new NoWriteError('Corrections of correction drafts are not supported in phase 1');
 const ledger=await posted(read,orgId,source);if(ledger.transaction.id!==transactionId||ledger.postings.some((p:any)=>p.isBankMatched!==false))throw new NoWriteError('Bank-matched or unknown bank status: resolve reconciliation separately before correction');
 const revision=await sha256(new TextEncoder().encode(stable({source,ledger})));
 return{...ledger,source,revision};
}
export async function transactionWithRevision(read:BillyClient,orgId:string,transactionId:string){
 // Ordinary records remain readable even when not eligible for correction.
 id.parse(transactionId);const {transaction}=await read.get('/transactions/'+transactionId);if(transaction?.organizationId!==orgId||transaction.id!==transactionId)throw new Error('Unexpected transaction');
 try {const source=await correctionSource(read,orgId,transactionId);return {...source,correctionEligible:true};}
 catch{return {transaction,correctionEligible:false,revision:null,limitation:'Only active, unbankmatched, test-created DKK entries without VAT are eligible. A lookup failure can also prevent eligibility verification.'};}
}
export async function verifyCorrection(read:BillyClient,db:JournalDB,orgId:string,draft:any){
 const row=await db.prepare("SELECT result FROM operations WHERE state = 'complete' AND id LIKE ? AND json_extract(result, '$.correctionDraft.daybookTransaction.id') = ?").bind(orgId+':%',draft.daybookTransaction.id).first<{result:string}>();
 if(!row)throw new NoWriteError('Correction provenance is missing');const saved=JSON.parse(row.result);
 if(draft.revision!==saved.correctionDraft.revision)throw new NoWriteError('Correction draft changed; delete and prepare a new proposal');
 const current=await correctionSource(read,orgId,saved.sourceTransactionId);
 if(current.revision!==saved.sourceRevision)throw new NoWriteError('Correction source changed; prepare a fresh proposal');
}
export function correctionHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,name:string){return async(a:any)=>{try{
 id.parse(a.transactionId);z.iso.date().parse(a.entryDate);if(!a.description||a.description.length>100)throw new NoWriteError('Description must be 1 to 100 characters');
 const reversalOnly=name==='propose_test_reversal';
 const replacement=reversalOnly?[]:a.lines.map((l:any)=>{id.parse(l.accountId);if(l.text.length>100||l.currencyId&&l.currencyId!=='DKK'||l.taxRateId!=null||l.baseAmount!==undefined&&l.baseAmount!==l.amount)throw new NoWriteError('Only DKK without tax/conversion supported');return{accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:'DKK'};});
 if(!reversalOnly)validate({daybookTransaction:{state:'draft',apiType:'mcp-test:validation'},daybookTransactionLines:replacement},'draft');
 return jsonResult(await journalRun(db,orgId,a.operationId,'correction:'+a.transactionId,{action:name,...a},async()=>{
 let original:any,lines:any[];
 const marker='mcp-test:correction:'+a.transactionId;
 try{
 original=await correctionSource(read,orgId,a.transactionId);
 if(original.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_transaction again');
 if(a.entryDate<original.transaction.entryDate)throw new NoWriteError('Correction date cannot precede original posting date');
 const existing=await read.fetchAll('/daybookTransactions','daybookTransactions',{organizationId:orgId,apiType:marker});
 if(existing.some((h:any)=>h.apiType===marker&&h.state!=='voided'))throw new NoWriteError('An active correction proposal or booked correction already exists for this source');
 const reversal=original.postings.map((p:any)=>({accountId:p.accountId,amount:p.amount,side:p.side==='debit'?'credit':'debit',text:('Tilbagefoersel: '+(p.text??'')).slice(0,100),currencyId:'DKK'}));
 lines=[...reversal,...replacement];validate({daybookTransaction:{state:'draft',apiType:marker},daybookTransactionLines:lines},'draft');
 for(const accountId of new Set(lines.map(l=>l.accountId))){const {account}=await read.get('/accounts/'+accountId);if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Invalid account');}
 if((await correctionSource(read,orgId,a.transactionId)).revision!==original.revision)throw new NoWriteError('Source changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Correction preflight failed. No write performed.');}
 const response=await write.post('/daybookTransactions',{daybookTransaction:{organizationId:orgId,daybookId:original.source.daybookTransaction.daybookId,entryDate:a.entryDate,description:a.description,extendedDescription:'Korrektionskladde for transaction '+a.transactionId+'. '+a.reasoning,apiType:marker,state:'draft',lines:lines!}});
 const draftId=id.parse(response.daybookTransactions?.[0]?.id);
 for(const fileId of new Set(original.source.attachments.map((x:any)=>x.fileId))){id.parse(fileId);await write.post('/attachments',{attachment:{organizationId:orgId,ownerReference:'daybookTransaction:'+draftId,fileId}});}
 const after=await draftSnapshot(read,draftId,orgId);validate(after,'draft');
 const canon=(ls:any[])=>ls.map(l=>stable({accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:l.currencyId})).sort();
 if(stable(canon(after.daybookTransactionLines))!==stable(canon(lines!))||after.daybookTransaction.entryDate!==a.entryDate||after.daybookTransaction.description!==a.description)throw new Error('Correction readback mismatch');
 const files=(xs:any[])=>[...new Set(xs.map(x=>x.fileId))].sort();if(stable(files(after.attachments))!==stable(files(original.source.attachments)))throw new Error('Copied file links differ');
 if((await correctionSource(read,orgId,a.transactionId)).revision!==original.revision)throw new Error('Original changed during proposal creation');
 return{kind:reversalOnly?'reversal_only':'reversal_and_replacement',sourceTransactionId:a.transactionId,sourceRevision:original.revision,originalUnchanged:true,correctionDraft:after,reasoning:a.reasoning,ledgerEffect:'none_until_separately_booked',nativeVoid:false};
 }));
 }catch(e){return errorResult(e);}};}
