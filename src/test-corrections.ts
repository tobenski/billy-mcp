import {standardVatRates} from './test-vat.js';
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
 propose_test_booked_change:'Create a correction DRAFT containing reversal of all original posted DKK lines plus the supplied full replacement. Original is never changed or voided. Test entries only; bank-matched entries allow non-bank reclassification only with identical bank account, amount and side in the full replacement; no new bank lines are created. VAT and currency conversions refused. transactionId is a native transaction ID; expectedRevision comes from get_transaction. Copies source attachment links. Requires separate book_test_daybook_draft after review.',
 propose_test_reversal:'Create a reversal-only DRAFT for a native test transaction, preserving the original. EUR with ordinary Danish K/S VAT or no VAT preserves original gross amount/baseAmount on reversal; no replacement corrections or bank matching. DKK with no VAT or supported Danish VAT (including predefined KR with one-quarter VAT deduction), full-deduction reverse-charge purchases, non-EU goods invoice codes or EU sales with native Rubrik B mapping, SVU/SYU/SOB with native Rubrik C mapping and SF/KF without turnover mapping; VAT reversals retain original gross lines and tax codes. Bank-matched entries refused. Uses expectedRevision from get_transaction. No immediate ledger effect, no native void and no deletion; book separately after review. After inspecting a pending reversal operation, the exact same request can verify and recover one already-created complete reversal draft without any native writes. Missing/changed evidence stays pending.',
};
export async function correctionSource(read:BillyClient,orgId:string,transactionId:string,verifiedRates?:any[]){
 id.parse(transactionId);const {organization}=await read.get('/organization');if(organization?.id!==orgId||organization.baseCurrencyId!=='DKK')throw new Error('Expected DKK test organization');
 const {transaction}=await read.get('/transactions/'+transactionId);
 if(transaction?.id!==transactionId||transaction.organizationId!==orgId||transaction.isVoided||transaction.isVoid||!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Only active native daybook transactions may be corrected');
 const source=await draftSnapshot(read,transaction.originatorReference.split(':')[1],orgId);validate(source,'approved',true,true);const taxRates=verifiedRates??await standardVatRates(read,orgId,source.daybookTransactionLines);
 if(source.daybookTransaction.apiType.startsWith('mcp-test:correction:'))throw new NoWriteError('Corrections of correction drafts are not supported in phase 1');
 const ledger=await posted(read,orgId,source,transaction,taxRates);
 if(ledger.transaction.id!==transactionId||ledger.postings.some((p:any)=>typeof p.isBankMatched!=='boolean'))throw new NoWriteError('Unknown bank status');
 let preservedBank:any=null;
 const hasFx=source.daybookTransactionLines.some((l:any)=>l.currencyId==='EUR');
 const matched=ledger.postings.filter((p:any)=>p.isBankMatched);
 if(matched.length&&(taxRates.length||hasFx))throw new NoWriteError('VAT bank-matched corrections are not supported');
 if(matched.length){
  if(matched.length!==1)throw new NoWriteError('Exactly one matched bank posting supported');
  const posting=matched[0];
  const associations=await read.fetchAll('/bankLineSubjectAssociations','bankLineSubjectAssociations',{subjectReference:'posting:'+posting.id});
  const links=associations.filter((a:any)=>a.subjectReference==='posting:'+posting.id);
  if(links.length!==1)throw new NoWriteError('Expected one native bank association');
  const rows=[];for(const status of ['booked','pending'])rows.push(...await read.fetchAll('/bankLines','bankLines',{accountId:posting.accountId,status}));
  const lines=Array.from(new Map(rows.filter((l:any)=>l.matchId===links[0].matchId).map((l:any)=>[l.id,l])).values()) as any[];
  if(lines.length!==1)throw new NoWriteError('Expected one matched bank line');
  const {account}=await read.get('/accounts/'+posting.accountId);
  const {bankLineMatch:match}=await read.get('/bankLineMatches/'+links[0].matchId);
  const matchLinks=await read.fetchAll('/bankLineSubjectAssociations','bankLineSubjectAssociations',{matchId:links[0].matchId});
  if(account?.id!==posting.accountId||account.organizationId!==orgId||lines[0].accountId!==posting.accountId||match?.id!==links[0].matchId||match.accountId!==posting.accountId||matchLinks.some((l:any)=>l.matchId!==match.id))throw new NoWriteError('Bank evidence ownership mismatch');
  const bank={bankLine:lines[0],account,match,lines,associations:matchLinks};
  if(bank.account.isBankAccount!==true||bank.account.isArchived||bank.account.currencyId!=='DKK'||bank.match?.isApproved!==true||bank.match.differenceType||bank.match.feeAccountId||bank.lines.length!==1||bank.associations.length!==1||bank.associations[0].subjectReference!=='posting:'+posting.id||bank.bankLine.amount!==posting.amount||bank.bankLine.side!==posting.side||bank.match.amount!==posting.amount||bank.match.side!==posting.side)throw new NoWriteError('Unsupported bank match');
  const bankAccountIds:string[]=[];
  for(const accountId of new Set(ledger.postings.map((p:any)=>p.accountId))){
   const account=accountId===posting.accountId?bank.account:(await read.get('/accounts/'+accountId)).account;
   if(account?.organizationId!==orgId||typeof account.isBankAccount!=='boolean')throw new NoWriteError('Unknown account bank status');
   if(account.isBankAccount)bankAccountIds.push(accountId as string);
  }
  if(bankAccountIds.length!==1||bankAccountIds[0]!==posting.accountId||ledger.postings.filter((p:any)=>p.accountId===posting.accountId).length!==1)throw new NoWriteError('Exactly one bank leg supported');
  preservedBank={posting,bank};
 }
 const evidence=preservedBank?{source,ledger,preservedBank}:{source,ledger};
 const revision=await sha256(new TextEncoder().encode(stable(evidence)));
 return{...ledger,source,revision,preservedBank,hasVat:taxRates.length>0,hasFx,taxRates};
}
export async function transactionWithRevision(read:BillyClient,orgId:string,transactionId:string){
 // Ordinary records remain readable even when not eligible for correction.
 id.parse(transactionId);const {transaction}=await read.get('/transactions/'+transactionId);if(transaction?.organizationId!==orgId||transaction.id!==transactionId)throw new Error('Unexpected transaction');
 try {const source=await correctionSource(read,orgId,transactionId);return {...source,correctionEligible:!source.hasVat&&!source.hasFx,correctionMode:source.hasVat||source.hasFx?'reversal_only':source.preservedBank?'non_bank_reclassification':'reversal_and_replacement',reversalEligible:!source.preservedBank};}
 catch{return {transaction,correctionEligible:false,revision:null,limitation:'Only active test-created DKK entries with supported VAT and bank evidence are eligible; VAT permits reversal only. A lookup failure can also prevent eligibility verification.'};}
}
export async function verifyCorrection(read:BillyClient,db:JournalDB,orgId:string,draft:any,verifiedRates?:any[]){
 const row=await db.prepare("SELECT result FROM operations WHERE state = 'complete' AND id LIKE ? AND json_extract(result, '$.correctionDraft.daybookTransaction.id') = ?").bind(orgId+':%',draft.daybookTransaction.id).first<{result:string}>();
 if(!row)throw new NoWriteError('Correction provenance is missing');const saved=JSON.parse(row.result);
 if(draft.revision!==saved.correctionDraft.revision)throw new NoWriteError('Correction draft changed; delete and prepare a new proposal');
 const current=await correctionSource(read,orgId,saved.sourceTransactionId,verifiedRates);
 if(current.revision!==saved.sourceRevision)throw new NoWriteError('Correction source changed; prepare a fresh proposal');
 if(saved.bankMatchPreserved){
  for(const accountId of new Set(draft.daybookTransactionLines.map((l:any)=>l.accountId))){
   const {account}=await read.get('/accounts/'+accountId);
   if(account?.organizationId!==orgId||account.isBankAccount!==false)throw new NoWriteError('Bank-preserving correction may contain only verified non-bank accounts');
  }
 }
}
export function correctionHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,name:string){return async(a:any)=>{try{
 id.parse(a.transactionId);z.iso.date().parse(a.entryDate);if(!a.description||a.description.length>100)throw new NoWriteError('Description must be 1 to 100 characters');
 const reversalOnly=name==='propose_test_reversal';
 const replacement=reversalOnly?[]:a.lines.map((l:any)=>{id.parse(l.accountId);if(l.text.length>100||l.currencyId&&l.currencyId!=='DKK'||l.taxRateId!=null||l.baseAmount!==undefined&&l.baseAmount!==l.amount)throw new NoWriteError('Only DKK without tax/conversion supported');return{accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:'DKK'};});
 if(!reversalOnly)validate({daybookTransaction:{state:'draft',apiType:'mcp-test:validation'},daybookTransactionLines:replacement},'draft');
 if(reversalOnly){const {recoverPendingReversal}=await import('./test-reversal-recovery.js');const recovered=await recoverPendingReversal(read,db,orgId,a);if(recovered)return jsonResult(recovered);}
 return jsonResult(await journalRun(db,orgId,a.operationId,'correction:'+a.transactionId,{action:name,...a},async()=>{
 let original:any,lines:any[];
 const marker='mcp-test:correction:'+a.transactionId;
 try{
 original=await correctionSource(read,orgId,a.transactionId);
 if((original.hasVat||original.hasFx)&&!reversalOnly)throw new NoWriteError('VAT sources support reversal only; replacement corrections are not implemented');
 if(original.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_transaction again');
 if(a.entryDate<original.transaction.entryDate)throw new NoWriteError('Correction date cannot precede original posting date');
 const existing=await read.fetchAll('/daybookTransactions','daybookTransactions',{organizationId:orgId,apiType:marker});
 if(existing.some((h:any)=>h.apiType===marker&&h.state!=='voided'))throw new NoWriteError('An active correction proposal or booked correction already exists for this source');
 let sourceLines=(original.hasVat||original.hasFx)?original.source.daybookTransactionLines:original.postings,replacementLines=replacement;
 if(original.preservedBank){
  if(reversalOnly)throw new NoWriteError('BANK_MATCH_PRESERVED: reversal requires separately resolving bank reconciliation');
  const bp=original.preservedBank.posting;
  const bankLines=[];
  for(const l of replacement){
   const {account}=await read.get('/accounts/'+l.accountId);
   if(account?.organizationId!==orgId||typeof account.isBankAccount!=='boolean')throw new NoWriteError('Unknown replacement account bank status');
   if(account.isBankAccount)bankLines.push(l);
  }
  if(bankLines.length!==1||bankLines[0].accountId!==bp.accountId||bankLines[0].amount!==bp.amount||bankLines[0].side!==bp.side)throw new NoWriteError('BANK_MATCH_PRESERVED: bank account, amount and side must remain identical; resolve reconciliation separately for bank amount changes');
  sourceLines=original.postings.filter((p:any)=>p.id!==bp.id);
  replacementLines=replacement.filter((l:any)=>l.accountId!==bp.accountId);
 }
 const reversal=sourceLines.map((p:any)=>({accountId:p.accountId,amount:p.amount,side:p.side==='debit'?'credit':'debit',text:('Tilbagefoersel: '+(p.text??'')).slice(0,100),currencyId:p.currencyId,...(p.currencyId==='EUR'?{baseAmount:p.baseAmount}:{}),...(p.taxRateId?{taxRateId:p.taxRateId}:{})}));
 lines=[...reversal,...replacementLines];validate({daybookTransaction:{state:'draft',apiType:marker},daybookTransactionLines:lines},'draft',original.hasVat,original.hasFx);
 for(const accountId of new Set(lines.map(l=>l.accountId))){const {account}=await read.get('/accounts/'+accountId);if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Invalid account');}
 if((await correctionSource(read,orgId,a.transactionId,original.taxRates)).revision!==original.revision)throw new NoWriteError('Source changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Correction preflight failed. No write performed.');}
 const response=await write.post('/daybookTransactions',{daybookTransaction:{organizationId:orgId,daybookId:original.source.daybookTransaction.daybookId,entryDate:a.entryDate,description:a.description,extendedDescription:'Korrektionskladde for transaction '+a.transactionId+'. '+a.reasoning,apiType:marker,state:'draft',lines:lines!}});
 const draftId=id.parse(response.daybookTransactions?.[0]?.id);
 for(const fileId of new Set(original.source.attachments.map((x:any)=>x.fileId))){id.parse(fileId);await write.post('/attachments',{attachment:{organizationId:orgId,ownerReference:'daybookTransaction:'+draftId,fileId}});}
 const after=await draftSnapshot(read,draftId,orgId);validate(after,'draft',original.hasVat,original.hasFx);
 const canon=(ls:any[])=>ls.map(l=>stable({accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:l.currencyId,...(l.currencyId==='EUR'?{baseAmount:l.baseAmount}:{}),taxRateId:l.taxRateId??null})).sort();
 if(stable(canon(after.daybookTransactionLines))!==stable(canon(lines!))||after.daybookTransaction.entryDate!==a.entryDate||after.daybookTransaction.description!==a.description)throw new Error('Correction readback mismatch');
 const files=(xs:any[])=>[...new Set(xs.map(x=>x.fileId))].sort();if(stable(files(after.attachments))!==stable(files(original.source.attachments)))throw new Error('Copied file links differ');
 if((await correctionSource(read,orgId,a.transactionId,original.taxRates)).revision!==original.revision)throw new Error('Original changed during proposal creation');
 return{kind:original.preservedBank?'non_bank_reclassification':reversalOnly?'reversal_only':'reversal_and_replacement',bankMatchPreserved:!!original.preservedBank,sourceTransactionId:a.transactionId,sourceRevision:original.revision,originalUnchanged:true,correctionDraft:after,reasoning:a.reasoning,ledgerEffect:'none_until_separately_booked',nativeVoid:false};
 }));
 }catch(e){return errorResult(e);}};}

export function validateReversalRecoveryLines(original:any,draft:any){
 const expected=((original.hasVat||original.hasFx)?original.source.daybookTransactionLines:original.postings).map((p:any)=>({accountId:p.accountId,amount:p.amount,side:p.side==='debit'?'credit':'debit',text:('Tilbagefoersel: '+(p.text??'')).slice(0,100),currencyId:p.currencyId,...(p.currencyId==='EUR'?{baseAmount:p.baseAmount}:{}),taxRateId:p.taxRateId??null}));
 const canon=(ls:any[])=>ls.map(l=>stable({accountId:l.accountId,amount:l.amount,side:l.side,text:l.text,currencyId:l.currencyId,...(l.currencyId==='EUR'?{baseAmount:l.baseAmount}:{}),taxRateId:l.taxRateId??null})).sort();
 if(stable(canon(draft.daybookTransactionLines))!==stable(canon(expected)))throw Error('Pending reversal lines mismatch');
}
