import type {McpServer} from '@modelcontextprotocol/server';
import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {sha256} from './test-files.js';
import {draftSnapshot} from './test-extended-drafts.js';
import {validate,posted} from './test-finalize.js';
import {standardVatRates} from './test-vat.js';
import {errorResult,jsonResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), revision=z.string().regex(/^[a-f0-9]{64}$/), reasoning=z.string().min(1).max(4000);
export const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=(v:any)=>sha256(new TextEncoder().encode(canonical(v)));
async function identity(read:BillyClient,orgId:string){const {organization:o}=await read.get('/organization');if(o?.id!==orgId||o.baseCurrencyId!=='DKK')throw new NoWriteError('Expected locked DKK test organization');return o;}
export async function vatPeriod(read:BillyClient,orgId:string,returnId:string){
 id.parse(returnId);await identity(read,orgId);
 const {salesTaxReturn:r}=await read.get('/salesTaxReturns/'+returnId);
 if(r?.id!==returnId||r.organizationId!==orgId)throw new NoWriteError('Unexpected VAT period ownership');
 const payments=await read.fetchAll('/salesTaxPayments','salesTaxPayments',{returnId});
 if(payments.some((p:any)=>p.returnId!==returnId||p.organizationId!==orgId))throw new NoWriteError('Unexpected VAT payment ownership');
 const evidence={salesTaxReturn:r,salesTaxPayments:[...payments].sort((a,b)=>a.id.localeCompare(b.id))};
 return {...evidence,revision:await hash(evidence),authoritySubmission:'not_verified'};
}
export async function closeBooking(read:BillyClient,db:JournalDB,orgId:string,a:any){
 await identity(read,orgId);z.string().uuid().parse(a.operationId);revision.parse(a.expectedRevision);reasoning.parse(a.reasoning);
 const journalId=orgId+':'+a.operationId;
 const row=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<{fingerprint:string;state:string;result:string|null;target:string}>();
 if(!row||row.state!=='pending')throw Error('Expected an existing pending booking operation');
 const input=JSON.parse(row.fingerprint);
 if(input.action!=='book_test_daybook_draft'||input.operationId!==a.operationId||row.target!==orgId+':'+id.parse(input.daybookTransactionId))throw Error('Pending operation is not the expected booking');
 const after=await draftSnapshot(read,input.daybookTransactionId,orgId);validate(after,'approved',true);
 if(after.revision!==a.expectedRevision||after.daybookTransaction.description!==input.expectedDescription)throw Error('STALE_REVISION or description');
 const sorted=(xs:any[])=>[...xs].sort((a,b)=>a.id.localeCompare(b.id));
 const header={...after.daybookTransaction,state:'draft'};
 const reconstructed=await hash({header,lines:sorted(after.daybookTransactionLines),attachments:sorted(after.attachments)});
 if(reconstructed!==input.expectedRevision)throw Error('Approved content does not match the original pre-booking revision');
 const before={...after,daybookTransaction:header,revision:reconstructed};
 const rates=await standardVatRates(read,orgId,after.daybookTransactionLines);
 if(header.apiType.startsWith('mcp-test:correction:')){const {verifyCorrection}=await import('./test-corrections.js');await verifyCorrection(read,db,orgId,before,rates);}
 const ledger=await posted(read,orgId,after,undefined,rates);
 if((await draftSnapshot(read,header.id,orgId)).revision!==after.revision||canonical(await posted(read,orgId,after,undefined,rates))!==canonical(ledger))throw Error('Booking evidence changed during recovery');
 const result={...after,...ledger,reasoning:input.reasoning,recovery:{previousState:'pending',nativeWrites:0,reasoning:a.reasoning}};
 const saved=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,row.fingerprint,row.target).run();
 if(!saved.success||saved.meta.changes!==1)throw Error('Pending journal changed; inspect before continuing');
 return {operationId:a.operationId,replayed:false,result};
}
export async function settleVat(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,a:any){
 await identity(read,orgId);
 // Recover only the observed zero-return transition, proving the original revision.
 const journalId=orgId+':'+a.operationId;
 const pending=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<{fingerprint:string;state:string;target:string}>();
 if(pending?.state==='pending'){
 const fingerprint=canonical({action:'set_test_vat_return_settlement',...a});
 if(pending.fingerprint!==fingerprint||pending.target!==orgId+':vatreturn:'+a.returnId)throw Error('Pending settlement input mismatch');
 const after=await vatPeriod(read,orgId,a.returnId),r=after.salesTaxReturn;
 if(a.isSettled!==true||r.isSettled!==true||r.totalAmount!==0||r.settledAmount!==0||r.isPaid!==false||r.skatTransactionId!=null||after.salesTaxPayments.length)throw Error('Pending settlement cannot be recovered automatically');
 const previous={salesTaxReturn:{...r,isSettled:false,settledAmount:null},salesTaxPayments:after.salesTaxPayments};
 if(await hash(previous)!==a.expectedRevision||(await vatPeriod(read,orgId,a.returnId)).revision!==after.revision)throw Error('Pending settlement evidence differs from original revision');
 const result={before:{...previous,revision:a.expectedRevision,authoritySubmission:'not_verified'},after,reasoning:a.reasoning,authoritySubmission:'not_performed',payment:'not_performed',recovery:{previousState:'pending',nativeWrites:0}};
 const saved=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,pending.target).run();
 if(!saved.success||saved.meta.changes!==1)throw Error('Pending settlement journal changed');
 return {operationId:a.operationId,replayed:false,result};
 }
 return journalRun(db,orgId,a.operationId,'vatreturn:'+a.returnId,{action:'set_test_vat_return_settlement',...a},async()=>{
 let before:any;
 try{
 before=await vatPeriod(read,orgId,a.returnId);const r=before.salesTaxReturn;
 if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read VAT period again');
 z.iso.date().parse(r.startDate);z.iso.date().parse(r.endDate);
 if(r.startDate>r.endDate||r.endDate>=new Date().toISOString().slice(0,10))throw new NoWriteError('Only ended VAT periods can be settled or reopened');
 if(typeof r.isSettled!=='boolean'||r.isSettled===a.isSettled||r.isPaid!==false||before.salesTaxPayments.length)throw new NoWriteError('Expected changed settlement state and an unpaid period without payment records');
 if((await vatPeriod(read,orgId,a.returnId)).revision!==before.revision)throw new NoWriteError('VAT period changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('VAT period preflight failed; no write performed');}
 await write.put('/salesTaxReturns/'+a.returnId,{salesTaxReturn:{isSettled:a.isSettled}});
 const after=await vatPeriod(read,orgId,a.returnId);
 const withoutState=(r:any)=>{const {isSettled,settledAmount,updatedTime,...rest}=r;return rest;};
 if(a.isSettled?after.salesTaxReturn.settledAmount!==before.salesTaxReturn.totalAmount:after.salesTaxReturn.settledAmount!==null&&after.salesTaxReturn.settledAmount!==before.salesTaxReturn.settledAmount)throw Error('Unexpected settled amount');
 if(after.salesTaxReturn.isSettled!==a.isSettled||canonical(withoutState(after.salesTaxReturn))!==canonical(withoutState(before.salesTaxReturn))||canonical(after.salesTaxPayments)!==canonical(before.salesTaxPayments))throw Error('Unexpected VAT settlement readback; inspect operation');
 return {before,after,reasoning:a.reasoning,authoritySubmission:'not_performed',payment:'not_performed'};
 });
}
export async function createPartialVat(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,a:any){
 await identity(read,orgId);
 return journalRun(db,orgId,a.operationId,'taxrate:'+a.abbreviation.toLowerCase(),{action:'create_test_partial_vat_rate',...a},async()=>{
 const share=a.deductionPercent/100;
 try{
 const rates=await read.fetchAll('/taxRates','taxRates',{organizationId:orgId});
 if(rates.some((r:any)=>r.organizationId!==orgId))throw new NoWriteError('Unexpected VAT configuration ownership');
 if(rates.some((r:any)=>r.name?.toLowerCase()===a.name.toLowerCase()||r.abbreviation?.toLowerCase()===a.abbreviation.toLowerCase()))throw new NoWriteError('VAT name or abbreviation already exists');
 const {account}=await read.get('/accounts/'+a.purchaseTaxAccountId);
 if(account?.organizationId!==orgId||account.systemRole!=='purchaseTax'||account.isArchived||account.isBankAccount!==false||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Expected active DKK purchaseTax account');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('VAT configuration preflight failed; no write performed');}
 const description='mcp-test:partial-vat:'+a.operationId;
 const response=await write.post('/taxRates',{taxRate:{organizationId:orgId,name:a.name,abbreviation:a.abbreviation,description,rate:0.25,appliesToSales:false,appliesToPurchases:true,isActive:true,netAmountMetaFieldId:null,deductionComponents:[{source:'tax',share,accountId:a.purchaseTaxAccountId}]}});
 const taxId=id.parse(response.taxRates?.[0]?.id);
 const {taxRate:r}=await read.get('/taxRates/'+taxId);
 const components=await read.fetchAll('/taxRateDeductionComponents','taxRateDeductionComponents',{taxRateId:taxId});
 if(r?.organizationId!==orgId||r.id!==taxId||r.isPredefined!==false||r.rate!==0.25||r.name!==a.name||r.abbreviation!==a.abbreviation||r.description!==description||r.appliesToSales!==false||r.appliesToPurchases!==true||r.isActive!==true||r.netAmountMetaFieldId!=null||components.length!==1||components[0].taxRateId!==taxId||components[0].share!==share||components[0].source!=='tax'||components[0].accountId!==a.purchaseTaxAccountId)throw Error('Unexpected partial VAT configuration readback');
 return {taxRate:r,deductionComponents:components,reasoning:a.reasoning,bookingEnabled:false,limitation:'Custom code booking remains disabled until native rounding and reporting have been verified. Billy may refuse custom codes on a predefined chart.'};
 });
}
export function registerVatManagement(server:McpServer,read:BillyClient,orgId:string,write?:BillyClient,db?:JournalDB){
 const wrap=(fn:(a:any)=>Promise<any>)=>async(a:any)=>{try{return jsonResult(await fn(a));}catch(e){return errorResult(e);}};
 server.registerTool('get_test_vat_period',{description:'Read native VAT return and payments with an optimistic revision. Billy settlement status is not proof of authority submission.',inputSchema:z.object({returnId:id}).strict(),annotations:{readOnlyHint:true}},wrap(a=>vatPeriod(read,orgId,a.returnId)));
 if(!write||!db)return;
 server.registerTool('close_test_booking_operation',{description:'Verify that a pending booking already succeeded; complete only its journal record. Requires fresh approved draft revision. No native Billy writes; refuses changed content or ambiguous postings.',inputSchema:z.object({operationId:z.string().uuid(),expectedRevision:revision,reasoning}).strict(),annotations:{readOnlyHint:false,destructiveHint:false}},wrap(a=>closeBooking(read,db,orgId,a)));
 server.registerTool('set_test_vat_return_settlement',{description:'Set or reopen the Billy settlement flag for an ended, unpaid test VAT period without payments. Does not submit to tax authorities or pay. Requires get_test_vat_period revision.',inputSchema:z.object({operationId:z.string().uuid(),returnId:id,expectedRevision:revision,isSettled:z.boolean(),reasoning}).strict(),annotations:{readOnlyHint:false,destructiveHint:true}},wrap(a=>settleVat(read,write,db,orgId,a)));
 server.registerTool('create_test_partial_vat_rate',{description:'Create a TEST custom Danish 25% purchase VAT code with explicit deduction percentage and purchaseTax account. Native API may refuse custom codes on predefined charts. Does not enable booking with the code until native rounding/reporting are verified.',inputSchema:z.object({operationId:z.string().uuid(),name:z.string().regex(/^TEST /).max(100),abbreviation:z.string().regex(/^TEST[A-Z0-9]{1,10}$/),deductionPercent:z.number().min(0.01).max(99.99).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-7),purchaseTaxAccountId:id,reasoning}).strict(),annotations:{readOnlyHint:false,destructiveHint:false}},wrap(a=>createPartialVat(read,write,db,orgId,a)));
}
