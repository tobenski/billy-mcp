import {standardVatRates} from './test-vat.js';
import type {McpServer} from '@modelcontextprotocol/server';
import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {sha256} from './test-files.js';
import {errorResult,jsonResult} from './tools/helpers.js';
import * as z from 'zod/v4';
export const extendedNames=new Set(['create_test_extended_draft','update_test_extended_draft']);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const validId=(id:any)=>z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(id);
export async function draftSnapshot(read:BillyClient,id:string,orgId:string){
 validId(id);
 const {daybookTransaction:header}=await read.get('/daybookTransactions/'+id);
 if(header?.organizationId!==orgId)throw new Error('Unexpected organization');
 const lines=await read.fetchAll('/daybookTransactionLines','daybookTransactionLines',{daybookTransactionId:id});
 const attachments=await read.fetchAll('/attachments','attachments',{organizationId:orgId,ownerReference:'daybookTransaction:'+id});
 if(lines.some((l:any)=>l.daybookTransactionId!==id)||attachments.some((a:any)=>a.ownerReference!=='daybookTransaction:'+id))throw new Error('Unexpected related record');
 const sorted=(xs:any[])=>[...xs].sort((a,b)=>a.id.localeCompare(b.id));
 return {daybookTransaction:header,daybookTransactionLines:lines,attachments,revision:await sha256(new TextEncoder().encode(stable({header,lines:sorted(lines),attachments:sorted(attachments)})))};
}
function normalize(lines:any[]){
 if(lines.length<2||lines.length>50)throw new NoWriteError('Use 2 to 50 lines');
 let balance=0;
 const result=lines.map(l=>{
 validId(l.accountId);
 if(!Number.isFinite(l.amount)||l.amount<=0||l.amount>1000000||Math.abs(l.amount*100-Math.round(l.amount*100))>1e-7)throw new NoWriteError('Invalid amount; use positive amounts with at most two decimals');
 const currency=l.currencyId??'DKK';
 if(!['DKK','EUR'].includes(currency))throw new NoWriteError('Only DKK and explicit EUR draft amounts supported');
 if(currency==='EUR'){if(l.taxRateId!=null||!Number.isFinite(l.baseAmount)||l.baseAmount<=0||l.baseAmount>1000000||Math.abs(l.baseAmount*100-Math.round(l.baseAmount*100))>1e-7)throw new NoWriteError('EUR drafts require positive two-decimal DKK baseAmount and no VAT');}
 else if(l.baseAmount!==undefined&&l.baseAmount!==l.amount)throw new NoWriteError('DKK baseAmount must equal amount');
 if(l.taxRateId!=null){validId(l.taxRateId);if(l.amountBasis!=='gross')throw new NoWriteError('VAT lines require explicit amountBasis gross; net input is not supported');}
 if(l.amountBasis!==undefined&&l.amountBasis!=='gross')throw new NoWriteError('Only gross amountBasis is supported');
 if(l.text.length>100)throw new NoWriteError('Line text exceeds 100 characters');
 balance+=Math.round((currency==='EUR'?l.baseAmount:l.amount)*100)*(l.side==='debit'?1:-1);
 return{accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:currency,...(currency==='EUR'?{baseAmount:l.baseAmount}:{}),...(l.taxRateId!=null?{taxRateId:l.taxRateId}:{})};
 });
 if(balance!==0)throw new NoWriteError('Unbalanced draft');return result;
}
function comparable(lines:any[]){return lines.map(l=>stable({accountId:l.accountId,amount:l.amount,side:l.side,text:l.text??'',currencyId:l.currencyId??'DKK',...(l.currencyId==='EUR'?{baseAmount:l.baseAmount}:{}),taxRateId:l.taxRateId??null})).sort();}
export function extendedHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,name:string){
 return async(a:any)=>{try{
 const {organization:org}=await read.get('/organization');if(org?.id!==orgId||org.baseCurrencyId!=='DKK')throw new Error('Expected DKK test organization');
 const creating=name==='create_test_extended_draft';
 if(a.currencyId&&a.currencyId!=='DKK')throw new NoWriteError('Only DKK supported');
 for(const key of ['contactId','invoiceId','bankLineId','reviewNote'])if(a[key]!==undefined)throw new NoWriteError(key+' is not supported in phase 1; use existing attachment tools');
 if(a.entryDate!==undefined)z.iso.date().parse(a.entryDate);
 for(const key of ['description','voucherNo'])if(a[key]!==undefined&&a[key].length>100)throw new NoWriteError(key+' exceeds 100 characters');
 if(a.description==='')throw new NoWriteError('Description cannot be empty');
 const attachmentIds=z.array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)).max(5).parse(a.attachmentIds??[]);
 const lines=a.lines?normalize(a.lines):undefined;
 if(!creating&&!attachmentIds.length&&!['entryDate','description','voucherNo','lines'].some(k=>a[k]!==undefined))throw new NoWriteError('Supply a change');
 if(creating)validId(a.daybookId);else validId(a.id);
 return jsonResult(await journalRun(db,orgId,a.operationId,creating?'create:'+a.operationId:a.id,{action:name,...a},async()=>{
 let before:any;const sources:any[]=[];let taxRates:any[]=[];
 try{
 if(creating){const books=await read.fetchAll('/daybooks','daybooks',{organizationId:orgId});if(!books.some((b:any)=>b.id===a.daybookId))throw new NoWriteError('Invalid daybook');}
 else{
 before=await draftSnapshot(read,a.id,orgId);const h=before.daybookTransaction;
 if(h.state!=='draft'||!h.apiType?.startsWith('mcp-test:'))throw new NoWriteError('Only test-tool-created drafts can be changed');
 if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_daybook_transaction again');
 if(before.daybookTransactionLines.some((l:any)=>l.contraAccountId||l.contraTaxRateId||l.paidInvoiceId||l.paidBillId||l.paidExternalInvoiceId||!['DKK','EUR'].includes(l.currencyId)))throw new NoWriteError('Existing draft has unsupported tax/currency/payment lines');
 }
 if(before)normalize(before.daybookTransactionLines.map((l:any)=>({...l,text:l.text??'',baseAmount:l.baseAmount??undefined,amountBasis:'gross'})));
 const effectiveLines=lines??before?.daybookTransactionLines??[];
 if(effectiveLines.some((l:any)=>l.currencyId==='EUR')&&effectiveLines.some((l:any)=>l.taxRateId))throw new NoWriteError('EUR drafts cannot contain VAT lines in this phase');
 // Validate both existing and proposed tax codes, including header-only changes.
 taxRates=await standardVatRates(read,orgId,[...(lines??[]),...(before?.daybookTransactionLines??[])]);
 for(const sourceId of new Set(attachmentIds)){
 const {attachment}=await read.get('/attachments/'+sourceId);
 if(attachment?.id!==sourceId||attachment.organizationId!==orgId)throw new NoWriteError('Invalid attachment organization or ID');
 validId(attachment.fileId);sources.push(attachment);
 }
 for(const id of new Set((lines??[]).map(l=>l.accountId))){const {account}=await read.get('/accounts/'+id);if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Invalid account');}
 for(const source of sources){const r=await read.get('/attachments/'+source.id);if(stable(r.attachment)!==stable(source))throw new NoWriteError('Source attachment changed during preflight');}
 if(before&&(await draftSnapshot(read,a.id,orgId)).revision!==before.revision)throw new NoWriteError('STALE_REVISION: changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Preflight failed. No write performed.');}
 const fields:any={};for(const k of ['entryDate','description','voucherNo'])if(a[k]!==undefined)fields[k]=a[k];if(lines)fields.lines=lines;
 let id=a.id;
 if(creating){const r=await write.post('/daybookTransactions',{daybookTransaction:{...fields,organizationId:orgId,daybookId:a.daybookId,state:'draft',apiType:'mcp-test:'+a.operationId}});id=r.daybookTransactions?.[0]?.id;validId(id);}
 else if(Object.keys(fields).length)await write.put('/daybookTransactions/'+id,{daybookTransaction:fields});
 const ownerReference='daybookTransaction:'+id;
 const existing=await read.fetchAll('/attachments','attachments',{organizationId:orgId,ownerReference});
 if(existing.some((x:any)=>x.ownerReference!==ownerReference))throw new Error('Unexpected attachment owner');
 if(before&&before.attachments.some((x:any)=>!existing.some((y:any)=>stable(x)===stable(y))))throw new Error('Existing attachment changed');
 const attachmentReuse:any[]=[];const byFile=new Map(existing.map((x:any)=>[x.fileId,x]));
 for(const source of sources){
 let target:any=byFile.get(source.fileId);const reused=!!target;
 if(!target){const r=await write.post('/attachments',{attachment:{organizationId:orgId,ownerReference,fileId:source.fileId}});
 target=r.attachments?.find((x:any)=>x.fileId===source.fileId&&x.ownerReference===ownerReference);validId(target?.id);byFile.set(source.fileId,target);}
 attachmentReuse.push({sourceAttachmentId:source.id,fileId:source.fileId,attachmentId:target.id,reused});
 }
 const after=await draftSnapshot(read,id,orgId);
 for(const source of sources){const r=await read.get('/attachments/'+source.id);if(stable(r.attachment)!==stable(source))throw new Error('Source attachment changed');}
 for(const link of attachmentReuse)if(!after.attachments.some((x:any)=>x.id===link.attachmentId&&x.fileId===link.fileId))throw new Error('Attachment readback mismatch');
 if(after.attachments.length!==existing.length+attachmentReuse.filter(x=>!x.reused).length)throw new Error('Unexpected attachment count');
 if(after.daybookTransaction.state!=='draft')throw new Error('Unexpected saved state');
 for(const k of ['entryDate','description','voucherNo'])if(fields[k]!==undefined&&after.daybookTransaction[k]!==fields[k])throw new Error('Header readback mismatch');
 if(stable(comparable(after.daybookTransactionLines))!==stable(comparable(lines??before.daybookTransactionLines)))throw new Error('Line replacement readback mismatch');
 if(existing.some((x:any)=>!after.attachments.some((y:any)=>stable(x)===stable(y))))throw new Error('Existing attachment changed');
 return {...after,attachmentReuse,taxRates,amountBasis:'gross',reasoning:a.reasoning,limitations:['EUR drafts only: explicit DKK baseAmount, no VAT; booking and full reversal supported, no bank matching. DKK; gross amounts only; supported Danish VAT (including predefined KR with one-quarter VAT deduction), full-deduction reverse-charge purchases, non-EU goods invoice codes, EU sales with native Rubrik B mapping, SVU/SYU/SOB with native Rubrik C mapping and SF/KF without turnover mapping or no VAT. Zero-rate gross is the invoice amount; non-EU goods import VAT is separate and never inferred from the invoice.','Booking and reversal require separate explicit tools; no linked payments.','Attachment IDs add existing files without moving source attachments; omitted or empty never removes links.','Draft and attachment writes are not atomic; partial failures remain pending.','Revision checks are optimistic; Billy UI changes are not atomically locked.']};
 }));
 }catch(e){return errorResult(e);}};
}
