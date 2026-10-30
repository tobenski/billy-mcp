import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {draftSnapshot} from './test-extended-drafts.js';
import {sha256} from './test-files.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const sorted=(rows:any[])=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const cents=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>1e-7)throw new NoWriteError('Expected positive amount with at most two decimals');return Math.round(n*100);};
export const bankDescriptions:Record<string,string>={
 get_test_bank_line:'Implemented and live-tested phase 1: read one bank line, account, native match, grouped bank lines and associations with optimistic revision. No writes or analysis.',
 reconcile_test_bank_line:'Implemented and live-tested phase 1. Link exactly one test-tool-created DKK draft to an existing unapproved match containing exactly one bank line. Exact amount, side and bank account required. Also accepts one booked native test transaction, or exactly two transactions forming an original/correction pair with 2-3 unmatched bank postings whose signed net equals the bank line. No partial allocations. Split amounts, fees and approval are refused. expectedRevision from get_test_bank_line.',
 unlink_test_bank_line:'Implemented and live-tested phase 1. Delete one association for a test-tool-created draft from an unapproved single-line match. Preserve line, group, draft and other associations. expectedRevision from get_test_bank_line. An exact posting:ID reference also supports a booked test entry: an approved match is reopened and the sole posting association removed, with before/after evidence. An explicit group:MATCH_ID reference reopens and removes all 2-3 posting associations of a verified original/correction pair. A posting:ID request never removes its peers. Never deletes a bank line or ledger posting; reapproval is separate.',
};
export async function bankSnapshot(read:BillyClient,orgId:string,lineId:string){
 id.parse(lineId);const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new Error('Test organization mismatch');
 const {bankLine}=await read.get('/bankLines/'+lineId);if(bankLine?.id!==lineId)throw new Error('Unexpected bank line');id.parse(bankLine.accountId);
 const {account}=await read.get('/accounts/'+bankLine.accountId);if(account?.id!==bankLine.accountId||account.organizationId!==orgId)throw new Error('Bank account organization mismatch');
 let match:any=null,associations:any[]=[],lines:any[]=[bankLine];
 if(bankLine.matchId){id.parse(bankLine.matchId);const result=await read.get('/bankLineMatches/'+bankLine.matchId);match=result.bankLineMatch;
 if(match?.id!==bankLine.matchId||match.accountId!==account.id)throw new Error('Bank match account mismatch');
 associations=await read.fetchAll('/bankLineSubjectAssociations','bankLineSubjectAssociations',{matchId:match.id});
 if(associations.some(a=>a.matchId!==match.id))throw new Error('Unexpected association match');
 const all:any[]=[];for(const status of ['booked','pending']){const rows=await read.fetchAll('/bankLines','bankLines',{accountId:account.id,status});if(rows.some((l:any)=>l.accountId!==account.id))throw new Error('Unexpected bank account in line list');all.push(...rows);}
 lines=Array.from(new Map(all.filter(l=>l.matchId===match.id).map(l=>[l.id,l])).values());
 if(!lines.some(l=>l.id===lineId))throw new Error('Bank line missing from its match');
 }
 const state={bankLine,account,match,lines:sorted(lines),associations:sorted(associations)};
 return {...state,revision:await sha256(new TextEncoder().encode(stable(state)))};
}
function writable(s:any,lineId:string){
 if(!s.match)throw new NoWriteError('Phase 1 requires an existing bank match');
 if(s.match.isApproved!==false)throw new NoWriteError('Only explicitly unapproved bank matches can be changed');
 if(s.lines.length!==1||s.lines[0].id!==lineId)throw new NoWriteError('Phase 1 requires exactly one bank line in the match');
 if(s.account.isBankAccount!==true||s.account.isArchived||s.account.currencyId!=='DKK'||s.bankLine.currencyId&&s.bankLine.currencyId!=='DKK')throw new NoWriteError('Only active DKK bank accounts are supported');
 if(s.match.differenceType||s.match.feeAccountId)throw new NoWriteError('Matches with differences or fees are not supported');
}
async function testDraft(read:BillyClient,orgId:string,draftId:string){
 id.parse(draftId);const d=await draftSnapshot(read,draftId,orgId);if(d.daybookTransaction.state!=='draft'||!d.daybookTransaction.apiType?.startsWith('mcp-test:'))throw new NoWriteError('Only test-tool-created drafts may be linked or unlinked');return d;
}
export function bankHandler(read:BillyClient,orgId:string,name:string,write?:BillyClient,db?:JournalDB){
 return async(a:any)=>{try{
 if(name==='get_test_bank_line')return jsonResult(await bankSnapshot(read,orgId,a.id));
 if(!write||!db)throw new NoWriteError('Test writes disabled');
 id.parse(a.bankLineId);
 if(name==='unlink_test_bank_line'&&a.subjectReference?.startsWith('group:')){const {correctionGroupUnlink}=await import('./test-bank-correction-group.js');return correctionGroupUnlink(read,write,db,orgId,a);}
 if(name==='reconcile_test_bank_line'&&a.subjects?.length>1){const {correctionGroupLink}=await import('./test-bank-correction-group.js');return correctionGroupLink(read,write,db,orgId,a);}
 if(name==='reconcile_test_bank_line'&&a.subjects?.[0]?.type==='transaction'||name==='unlink_test_bank_line'&&a.subjectReference?.startsWith('posting:')){const {postedBankHandler}=await import('./test-bank-posted.js');return postedBankHandler(read,write,db,orgId,name,a);}
 const linking=name==='reconcile_test_bank_line';
 let reference:string;
 if(linking){if(a.subjects.length!==1||a.subjects[0].type!=='daybookTransaction')throw new NoWriteError('Phase 1 supports exactly one daybookTransaction subject');id.parse(a.subjects[0].id);reference='daybookTransaction:'+a.subjects[0].id;}
 else {id.parse(a.matchId);if(!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(a.subjectReference))throw new NoWriteError('Expected daybookTransaction reference');reference=a.subjectReference;}
 const initial=await bankSnapshot(read,orgId,a.bankLineId);
 const target='bankmatch:'+(initial.match?.id??a.bankLineId);
 return jsonResult(await journalRun(db,orgId,a.operationId,target,{action:name,...a},async()=>{
 let before:any,draft:any,existing:any;
 try{
 before=await bankSnapshot(read,orgId,a.bankLineId);writable(before,a.bankLineId);
 if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_test_bank_line again');
 if(!linking&&before.match.id!==a.matchId)throw new NoWriteError('Wrong match ID');
 draft=await testDraft(read,orgId,reference.split(':')[1]);
 const found=before.associations.filter((x:any)=>x.subjectReference===reference);if(found.length>1)throw new NoWriteError('Duplicate existing associations require inspection');existing=found[0];
 if(linking){
 if(before.associations.some((x:any)=>x.subjectReference!==reference))throw new NoWriteError('Match already has other subjects');
 const bankLines=draft.daybookTransactionLines.filter((l:any)=>l.accountId===before.account.id);
 if(bankLines.length!==1)throw new NoWriteError('Draft must have exactly one line on the bank account');
 const bank=bankLines[0];if(bank.currencyId!=='DKK'||bank.side!==before.bankLine.side||cents(bank.amount)!==cents(before.bankLine.amount))throw new NoWriteError('Bank amount, currency or side mismatch');
 if(a.subjects[0].amount!==undefined&&cents(a.subjects[0].amount)!==cents(bank.amount))throw new NoWriteError('Partial allocation is not supported');
 let balance=0;for(const l of draft.daybookTransactionLines){if(l.currencyId!=='DKK'||l.taxRateId||l.contraAccountId||l.paidBillId||l.paidInvoiceId||l.paidExternalInvoiceId)throw new NoWriteError('Unsupported draft tax/currency/payment lines');balance+=cents(l.amount)*(l.side==='debit'?1:-1);}if(balance!==0)throw new NoWriteError('Unbalanced draft');
 }else if(!existing)throw new NoWriteError('Association does not exist');
 if((await testDraft(read,orgId,reference.split(':')[1])).revision!==draft.revision||(await bankSnapshot(read,orgId,a.bankLineId)).revision!==before.revision)throw new NoWriteError('STALE_REVISION: source changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Bank preflight failed. No write performed.');}
 if(linking&&existing)return{alreadyLinked:true,...before};
 if(linking)await write.post('/bankLineSubjectAssociations',{bankLineSubjectAssociation:{matchId:before.match.id,subjectReference:reference}});
 else await write.del('/bankLineSubjectAssociations/'+id.parse(existing.id));
 const after=await bankSnapshot(read,orgId,a.bankLineId);
 if(after.match?.id!==before.match.id||after.match.isApproved!==false||stable(after.lines)!==stable(before.lines))throw new Error('Bank line/group changed unexpectedly');
 if(before.associations.filter((x:any)=>linking||x.id!==existing.id).some((x:any)=>!after.associations.some((y:any)=>stable(x)===stable(y))))throw new Error('Other associations changed');
 const selected=after.associations.filter((x:any)=>x.subjectReference===reference);
 if(linking?selected.length!==1:selected.length!==0)throw new Error('Association readback mismatch');
 if(after.associations.length!==before.associations.length+(linking?1:-1))throw new Error('Unexpected association count');
 if((await testDraft(read,orgId,reference.split(':')[1])).revision!==draft.revision)throw new Error('Draft changed during bank operation');
 return {alreadyLinked:false,...after,reasoning:a.reasoning,limitations:['Not approved or booked.','Optimistic checks do not lock Billy UI edits.','Revalidate amounts before approval; later draft edits can invalidate this link.']};
 }));
 }catch(e){return errorResult(e);}};
}
