import type {BillyClient} from './billy-client.js';
import {bankSnapshot} from './test-bank.js';
import {draftSnapshot} from './test-extended-drafts.js';
import {validate,posted} from './test-finalize.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const cents=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>1e-7)throw new NoWriteError('Invalid amount');return Math.round(n*100);};
async function evidence(read:BillyClient,org:string,transactionId:string,bank:any){
 id.parse(transactionId);const {transaction}=await read.get('/transactions/'+transactionId);
 if(transaction?.id!==transactionId||transaction.organizationId!==org||transaction.isVoid||transaction.isVoided||!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Expected active test daybook transaction');
 const source=await draftSnapshot(read,transaction.originatorReference.split(':')[1],org);validate(source,'approved');
 const ledger=await posted(read,org,source);if(ledger.transaction.id!==transactionId)throw new NoWriteError('Wrong native transaction');
 const legs=ledger.postings.filter((p:any)=>p.accountId===bank.account.id);
 if(legs.length!==1||legs[0].currencyId!=='DKK'||legs[0].side!==bank.bankLine.side||cents(legs[0].amount)!==cents(bank.bankLine.amount)||typeof legs[0].isBankMatched!=='boolean')throw new NoWriteError('Expected exactly one bank posting with identical amount and side');
 return {source,...ledger,bankPosting:legs[0]};
}
function supported(b:any){
 if(!b.match||typeof b.match.isApproved!=='boolean'||b.lines.length!==1||b.account.isBankAccount!==true||b.account.isArchived||b.account.currencyId!=='DKK'||b.match.differenceType||b.match.feeAccountId||b.match.amount!==b.bankLine.amount||b.match.side!==b.bankLine.side)throw new NoWriteError('Only single-line DKK matches without fees/differences supported');
}
export async function postedBankHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string,a:any){try{
 const linking=name==='reconcile_test_bank_line';id.parse(a.bankLineId);
 if(linking){if(a.subjects?.length!==1||a.subjects[0].type!=='transaction')throw new NoWriteError('Expected exactly one native transaction');id.parse(a.subjects[0].id);}
 else {id.parse(a.matchId);if(!/^posting:[A-Za-z0-9_-]{1,100}$/.test(a.subjectReference))throw new NoWriteError('Expected exact posting reference');}
 const initial=await bankSnapshot(read,org,a.bankLineId);
 return jsonResult(await journalRun(db,org,a.operationId,'bankmatch:'+(initial.match?.id??a.bankLineId),{action:name,...a},async()=>{
 let before:any,entry:any,reference:string,association:any;
 try{
 before=initial;supported(before);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read bank line again');
 let transactionId:string;
 if(linking){if(before.match.isApproved||before.associations.length)throw new NoWriteError('Link requires an empty unapproved match');transactionId=a.subjects[0].id;}
 else{if(before.match.id!==a.matchId||before.associations.length!==1||before.associations[0].subjectReference!==a.subjectReference)throw new NoWriteError('Expected sole exact posting association');association=before.associations[0];id.parse(association.id);const {posting}=await read.get('/postings/'+a.subjectReference.split(':')[1]);if(posting?.id!==a.subjectReference.split(':')[1]||posting.organizationId!==org)throw new NoWriteError('Unexpected posting');transactionId=posting.transactionId;}
 entry=await evidence(read,org,transactionId,before);reference='posting:'+entry.bankPosting.id;
 if(linking){if(entry.bankPosting.isBankMatched!==false)throw new NoWriteError('Posting already matched');if(a.subjects[0].amount!==undefined&&cents(a.subjects[0].amount)!==cents(before.bankLine.amount))throw new NoWriteError('Partial allocation is not supported');}
 else if(reference!==a.subjectReference||entry.bankPosting.isBankMatched!==before.match.isApproved)throw new NoWriteError('Posting match status differs');
 if((await bankSnapshot(read,org,a.bankLineId)).revision!==before.revision||(await draftSnapshot(read,entry.source.daybookTransaction.id,org)).revision!==entry.source.revision)throw new NoWriteError('STALE_REVISION: bank or source changed');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Posted bank preflight failed. No write performed.');}
 if(!linking&&before.match.isApproved){
  await write.put('/bankLineMatches/'+before.match.id,{bankLineMatch:{isApproved:false}});
  const opened=await bankSnapshot(read,org,a.bankLineId);
  const {posting}=await read.get('/postings/'+entry.bankPosting.id);
  if(opened.match?.isApproved!==false||opened.match.id!==before.match.id||stable(opened.lines)!==stable(before.lines)||stable(opened.associations)!==stable(before.associations)||posting?.isBankMatched!==false)throw new Error('Reopening readback mismatch; inspect before further writes');
 }
 if(linking)await write.post('/bankLineSubjectAssociations',{bankLineSubjectAssociation:{matchId:before.match.id,subjectReference:reference!}});
 else await write.del('/bankLineSubjectAssociations/'+association.id);
 const after=await bankSnapshot(read,org,a.bankLineId);
 if(after.match?.id!==before.match.id||after.match.isApproved!==false||stable(after.lines)!==stable(before.lines)||after.associations.length!==(linking?1:0)||linking&&after.associations[0].subjectReference!==reference!)throw new Error('Posted bank association readback mismatch');
 const source=await draftSnapshot(read,entry.source.daybookTransaction.id,org);
 const {posting}=await read.get('/postings/'+entry.bankPosting.id);
 const {isBankMatched:oldMatched,...oldPosting}=entry.bankPosting;const {isBankMatched:newMatched,...newPosting}=posting??{};
 if(source.revision!==entry.source.revision||newMatched!==false||stable(newPosting)!==stable(oldPosting))throw new Error('Source or posting changed unexpectedly');
 return{...after,transactionId:entry.transaction.id,postingId:entry.bankPosting.id,reopened:!linking&&before.match.isApproved,linked:linking,sourceUnchanged:true,bankLinePreserved:true,before,reasoning:a.reasoning,limitations:['Reapproval is separate.','No ledger amount changes.','Optimistic checks cannot lock concurrent Billy UI edits.']};
 }));
}catch(e){return errorResult(e);}}
