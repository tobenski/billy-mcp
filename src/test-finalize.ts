import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {draftSnapshot} from './test-extended-drafts.js';
import {bankSnapshot} from './test-bank.js';
import {errorResult,jsonResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const money=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<=0||n>1000000||Math.abs(n*100-Math.round(n*100))>1e-7)throw new NoWriteError('Invalid two-decimal amount');return Math.round(n*100);};
const financial=(rows:any[])=>rows.map(l=>stable({accountId:l.accountId,amount:l.amount,side:l.side,currencyId:l.currencyId,text:l.text??''})).sort();
export function validate(snapshot:any,state:string){
 const h=snapshot.daybookTransaction;
 if(h.state!==state||!h.apiType?.startsWith('mcp-test:'))throw new NoWriteError('Expected a test-tool-created '+state+' entry');
 if(snapshot.daybookTransactionLines.length<2||snapshot.daybookTransactionLines.length>50)throw new NoWriteError('Expected 2 to 50 lines');
 let balance=0;for(const l of snapshot.daybookTransactionLines){id.parse(l.accountId);if(l.currencyId!=='DKK'||l.taxRateId||l.contraTaxRateId||l.contraAccountId||l.paidInvoiceId||l.paidBillId||l.paidExternalInvoiceId||!['debit','credit'].includes(l.side))throw new NoWriteError('Only DKK without tax or linked payments supported');balance+=money(l.amount)*(l.side==='debit'?1:-1);}if(balance!==0)throw new NoWriteError('Unbalanced entry');
}
export async function posted(read:BillyClient,orgId:string,snapshot:any){
 const ref='daybookTransaction:'+snapshot.daybookTransaction.id;
 const all=await read.fetchAll('/transactions','transactions',{organizationId:orgId});
 const txs=all.filter((t:any)=>t.originatorReference===ref&&!t.isVoided&&!t.isVoid);
 if(txs.length!==1||txs[0].organizationId!==orgId)throw new Error('Expected exactly one posted native transaction');
 const transaction=txs[0];id.parse(transaction.id);
 const postings=await read.fetchAll('/postings','postings',{organizationId:orgId,transactionId:transaction.id});
 if(postings.some((p:any)=>p.transactionId!==transaction.id||p.organizationId!==orgId||p.isVoided||p.entryDate!==snapshot.daybookTransaction.entryDate)||stable(financial(postings))!==stable(financial(snapshot.daybookTransactionLines)))throw new Error('Native posted lines differ from approved entry');
 return{transaction,postings};
}
export const finalizeDescriptions:Record<string,string>={
 book_test_daybook_draft:'Phase 1: explicitly book a test-tool-created balanced DKK draft without VAT. Requires revision and current description from get_daybook_transaction. Preserves lines/files and verifies native transaction/postings. Irreversible via draft tools; reasoning recorded in operation journal.',
 approve_test_bank_match:'Phase 1: explicitly approve one unapproved single-line DKK bank match against exactly one already-booked test entry. Accepts a daybook/transaction subject or its exact native bank posting association. Revalidates amount, side, account, native postings and revisions. No draft auto-booking, fees, split payments or differences. expectedRevision from get_test_bank_line.',
};
export function finalizeHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,name:string){return async(a:any)=>{try{
 const {organization}=await read.get('/organization');if(organization?.id!==orgId||organization.baseCurrencyId!=='DKK')throw new Error('Expected DKK test organization');
 const booking=name==='book_test_daybook_draft';id.parse(booking?a.daybookTransactionId:a.matchId);
 return jsonResult(await journalRun(db,orgId,a.operationId,booking?a.daybookTransactionId:'bankmatch:'+a.matchId,{action:name,...a},async()=>{
 let before:any,bank:any,ledger:any;
 try{
 if(booking){
 before=await draftSnapshot(read,a.daybookTransactionId,orgId);validate(before,'draft');
 if(before.revision!==a.expectedRevision||before.daybookTransaction.description!==a.expectedDescription)throw new NoWriteError('STALE_REVISION or description; read draft again');
 for(const accountId of new Set(before.daybookTransactionLines.map((l:any)=>l.accountId))){const {account}=await read.get('/accounts/'+accountId);if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Invalid account');}
 }else{
 const {bankLineMatch:match}=await read.get('/bankLineMatches/'+a.matchId);if(match?.id!==a.matchId)throw new NoWriteError('Match not found');id.parse(match.accountId);
 const {account}=await read.get('/accounts/'+match.accountId);if(account?.organizationId!==orgId)throw new NoWriteError('Wrong organization');
 const lines:any[]=[];for(const status of ['booked','pending'])lines.push(...await read.fetchAll('/bankLines','bankLines',{accountId:match.accountId,status}));
 const grouped=Array.from(new Map(lines.filter(l=>l.matchId===a.matchId).map(l=>[l.id,l])).values());if(grouped.length!==1)throw new NoWriteError('Exactly one bank line required');
 bank=await bankSnapshot(read,orgId,grouped[0].id);
 if(bank.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read bank line again');
 if(bank.match?.id!==a.matchId||bank.match.isApproved!==false||bank.lines.length!==1||bank.associations.length!==1||bank.match.differenceType||bank.match.feeAccountId||bank.account.currencyId!=='DKK'||bank.account.isArchived||bank.account.isBankAccount!==true)throw new NoWriteError('Only unapproved single-line DKK matches without differences/fees supported');
 const ref=bank.associations[0].subjectReference;let draftId:string;
 if(/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(ref))draftId=ref.split(':')[1];
 else if(/^transaction:[A-Za-z0-9_-]{1,100}$/.test(ref)){const {transaction}=await read.get('/transactions/'+ref.split(':')[1]);if(transaction?.organizationId!==orgId||transaction.isVoided||!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Unsupported booked subject');draftId=transaction.originatorReference.split(':')[1];}
 else if(/^posting:[A-Za-z0-9_-]{1,100}$/.test(ref)){
 const {posting}=await read.get('/postings/'+ref.split(':')[1]);
 if(posting?.id!==ref.split(':')[1]||posting.organizationId!==orgId||posting.accountId!==bank.account.id||posting.isVoided||posting.isBankMatched!==false)throw new NoWriteError('Unsupported posting subject');
 const {transaction}=await read.get('/transactions/'+id.parse(posting.transactionId));
 if(transaction?.organizationId!==orgId||transaction.isVoided||transaction.isVoid||!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Unsupported posting source');draftId=transaction.originatorReference.split(':')[1];
 }
 else throw new NoWriteError('Expected one test daybook subject');
 before=await draftSnapshot(read,draftId,orgId);validate(before,'approved');ledger=await posted(read,orgId,before);
 const bankPostings=ledger.postings.filter((p:any)=>p.accountId===bank.account.id);
 if(ref.startsWith('posting:')&&ref!=='posting:'+bankPostings[0]?.id)throw new NoWriteError('Wrong bank posting association');
 if(bankPostings.length!==1||money(bankPostings[0].amount)!==money(bank.bankLine.amount)||bankPostings[0].side!==bank.bankLine.side||bankPostings[0].isBankMatched)throw new NoWriteError('Bank amount/side mismatch or posting already matched');
 }
 if((await draftSnapshot(read,before.daybookTransaction.id,orgId)).revision!==before.revision)throw new NoWriteError('STALE_REVISION: entry changed during preflight');
 if(booking&&before.daybookTransaction.apiType?.startsWith('mcp-test:correction:')){const {verifyCorrection}=await import('./test-corrections.js');await verifyCorrection(read,db,orgId,before);}
 if(bank&&(await bankSnapshot(read,orgId,bank.bankLine.id)).revision!==bank.revision)throw new NoWriteError('STALE_REVISION: bank changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Finalization preflight failed. No write performed.');}
 if(booking)await write.put('/daybookTransactions/'+a.daybookTransactionId,{daybookTransaction:{state:'approved'}});
 else await write.put('/bankLineMatches/'+a.matchId,{bankLineMatch:{isApproved:true}});
 const after=await draftSnapshot(read,before.daybookTransaction.id,orgId);validate(after,'approved');
 if(stable(financial(after.daybookTransactionLines))!==stable(financial(before.daybookTransactionLines))||stable(after.attachments)!==stable(before.attachments)||after.daybookTransaction.entryDate!==before.daybookTransaction.entryDate||after.daybookTransaction.description!==before.daybookTransaction.description)throw new Error('Entry or attachments changed during finalization');
 const verified=await posted(read,orgId,after);
 if(booking){
 if(before.daybookTransaction.apiType?.startsWith('mcp-test:correction:')){const {verifyCorrection}=await import('./test-corrections.js');await verifyCorrection(read,db,orgId,before);}
 return{...after,...verified,reasoning:a.reasoning};
 }
 const bankAfter=await bankSnapshot(read,orgId,bank.bankLine.id);
 if(bankAfter.match?.id!==a.matchId||bankAfter.match.isApproved!==true||bankAfter.bankLine.accountId!==bank.bankLine.accountId||bankAfter.bankLine.amount!==bank.bankLine.amount||bankAfter.bankLine.side!==bank.bankLine.side)throw new Error('Bank approval readback mismatch');
 const bp=verified.postings.filter((p:any)=>p.accountId===bank.account.id);if(bp.length!==1||bp[0].isBankMatched!==true||bankAfter.associations.length!==1||bankAfter.associations[0].subjectReference!=='posting:'+bp[0].id)throw new Error('Native bank posting is not matched');
 return{...bankAfter,...verified,daybookTransaction:after.daybookTransaction,reasoning:a.reasoning};
 }));
 }catch(e){return errorResult(e);}};}
