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
 if(l.currencyId&&l.currencyId!=='DKK'||l.taxRateId!=null||l.baseAmount!==undefined&&l.baseAmount!==l.amount)throw new NoWriteError('Only DKK without VAT or conversion is supported');
 if(l.text.length>100)throw new NoWriteError('Line text exceeds 100 characters');
 balance+=Math.round(l.amount*100)*(l.side==='debit'?1:-1);
 return{accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:'DKK'};
 });
 if(balance!==0)throw new NoWriteError('Unbalanced draft');return result;
}
function comparable(lines:any[]){return lines.map(l=>stable({accountId:l.accountId,amount:l.amount,side:l.side,text:l.text??'',currencyId:l.currencyId??'DKK'})).sort();}
export function extendedHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,name:string){
 return async(a:any)=>{try{
 const {organization:org}=await read.get('/organization');if(org?.id!==orgId||org.baseCurrencyId!=='DKK')throw new Error('Expected DKK test organization');
 const creating=name==='create_test_extended_draft';
 if(a.currencyId&&a.currencyId!=='DKK')throw new NoWriteError('Only DKK supported');
 for(const key of ['attachmentIds','contactId','invoiceId','bankLineId','reviewNote'])if(a[key]!==undefined)throw new NoWriteError(key+' is not supported in phase 1; use existing attachment tools');
 if(a.entryDate!==undefined)z.iso.date().parse(a.entryDate);
 for(const key of ['description','voucherNo'])if(a[key]!==undefined&&a[key].length>100)throw new NoWriteError(key+' exceeds 100 characters');
 if(a.description==='')throw new NoWriteError('Description cannot be empty');
 const lines=a.lines?normalize(a.lines):undefined;
 if(!creating&&!['entryDate','description','voucherNo','lines'].some(k=>a[k]!==undefined))throw new NoWriteError('Supply a change');
 if(creating)validId(a.daybookId);else validId(a.id);
 return jsonResult(await journalRun(db,orgId,a.operationId,creating?'create:'+a.operationId:a.id,{action:name,...a},async()=>{
 let before:any;
 try{
 if(creating){const books=await read.fetchAll('/daybooks','daybooks',{organizationId:orgId});if(!books.some((b:any)=>b.id===a.daybookId))throw new NoWriteError('Invalid daybook');}
 else{
 before=await draftSnapshot(read,a.id,orgId);const h=before.daybookTransaction;
 if(h.state!=='draft'||!h.apiType?.startsWith('mcp-test:'))throw new NoWriteError('Only test-tool-created drafts can be changed');
 if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_daybook_transaction again');
 if(before.daybookTransactionLines.some((l:any)=>l.taxRateId||l.contraAccountId||l.contraTaxRateId||l.paidInvoiceId||l.paidBillId||l.paidExternalInvoiceId||l.currencyId!=='DKK'))throw new NoWriteError('Existing draft has unsupported tax/currency/payment lines');
 }
 for(const id of new Set((lines??[]).map(l=>l.accountId))){const {account}=await read.get('/accounts/'+id);if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Invalid account');}
 if(before&&(await draftSnapshot(read,a.id,orgId)).revision!==before.revision)throw new NoWriteError('STALE_REVISION: changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Preflight failed. No write performed.');}
 const fields:any={};for(const k of ['entryDate','description','voucherNo'])if(a[k]!==undefined)fields[k]=a[k];if(lines)fields.lines=lines;
 let id=a.id;
 if(creating){const r=await write.post('/daybookTransactions',{daybookTransaction:{...fields,organizationId:orgId,daybookId:a.daybookId,state:'draft',apiType:'mcp-test:'+a.operationId}});id=r.daybookTransactions?.[0]?.id;validId(id);}
 else await write.put('/daybookTransactions/'+id,{daybookTransaction:fields});
 const after=await draftSnapshot(read,id,orgId);
 if(after.daybookTransaction.state!=='draft')throw new Error('Unexpected saved state');
 for(const k of ['entryDate','description','voucherNo'])if(fields[k]!==undefined&&after.daybookTransaction[k]!==fields[k])throw new Error('Header readback mismatch');
 if(stable(comparable(after.daybookTransactionLines))!==stable(comparable(lines??before.daybookTransactionLines)))throw new Error('Line replacement readback mismatch');
 if(before&&stable(before.attachments)!==stable(after.attachments))throw new Error('Attachments changed');
 return {...after,reasoning:a.reasoning,limitations:['DKK only; no VAT or linked payments.','Revision checks are optimistic; Billy UI changes are not atomically locked.']};
 }));
 }catch(e){return errorResult(e);}};
}
