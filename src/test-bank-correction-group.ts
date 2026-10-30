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
function supported(b:any){if(!b.match||b.match.isApproved!==false||b.lines.length!==1||b.account.isBankAccount!==true||b.account.isArchived||b.account.currencyId!=='DKK'||b.match.differenceType||b.match.feeAccountId||b.match.amount!==b.bankLine.amount||b.match.side!==b.bankLine.side)throw new NoWriteError('Expected unapproved single-line DKK match without fees/differences');}
const refs=(b:any)=>b.associations.map((a:any)=>a.subjectReference).sort();
const canon=(ps:any[])=>ps.map(p=>{const {isBankMatched,...rest}=p;return stable(rest);}).sort();
async function groupEvidence(read:BillyClient,org:string,bank:any,transactionIds:string[]){
 if(transactionIds.length!==2||new Set(transactionIds).size!==2)throw new NoWriteError('Exactly one original and one correction transaction required');
 const entries:any[]=[];
 for(const txid of transactionIds){
  id.parse(txid);const {transaction}=await read.get('/transactions/'+txid);
  if(transaction?.id!==txid||transaction.organizationId!==org||transaction.isVoid||transaction.isVoided||!/^daybookTransaction:[A-Za-z0-9_-]{1,100}$/.test(transaction.originatorReference))throw new NoWriteError('Invalid native test transaction');
  const source=await draftSnapshot(read,transaction.originatorReference.split(':')[1],org);validate(source,'approved');
  const ledger=await posted(read,org,source,transaction);entries.push({source,...ledger});
 }
 const originals=entries.filter(e=>!e.source.daybookTransaction.apiType.startsWith('mcp-test:correction:'));
 if(originals.length!==1||!entries.some(e=>e.source.daybookTransaction.apiType==='mcp-test:correction:'+originals[0].transaction.id))throw new NoWriteError('Transactions are not an original/correction pair');
 const bankPostings=entries.flatMap(e=>e.postings.filter((p:any)=>p.accountId===bank.account.id));
 if(bankPostings.length<2||bankPostings.length>3||bankPostings.some(p=>p.currencyId!=='DKK'||p.isBankMatched!==false))throw new NoWriteError('Expected 2 to 3 unmatched DKK bank postings');
 const net=bankPostings.reduce((sum,p)=>sum+cents(p.amount)*(p.side==='debit'?1:-1),0);
 const expected=cents(bank.bankLine.amount)*(bank.bankLine.side==='debit'?1:-1);
 if(net!==expected)throw new NoWriteError('BANK_DIFFERENCE: original and correction bank postings do not equal the bank line; no link or approval performed');
 return{entries,bankPostings};
}
async function freshSources(read:BillyClient,org:string,g:any){for(const e of g.entries)if((await draftSnapshot(read,e.source.daybookTransaction.id,org)).revision!==e.source.revision)throw new NoWriteError('STALE_REVISION: correction source changed');}
async function verifiedPostings(read:BillyClient,org:string,g:any,matched:boolean){
 const out:any[]=[];
 for(const e of g.entries){const ps=await read.fetchAll('/postings','postings',{organizationId:org,transactionId:e.transaction.id});if(stable(canon(ps))!==stable(canon(e.postings)))throw new Error('Ledger changed during bank operation');out.push(...ps);}
 if(g.bankPostings.some((p:any)=>out.find(q=>q.id===p.id)?.isBankMatched!==matched))throw new Error('Native bank posting status mismatch');
 return out;
}
export async function correctionGroupLink(read:BillyClient,write:BillyClient,db:JournalDB,org:string,a:any){try{
 id.parse(a.bankLineId);if(a.subjects?.length!==2||a.subjects.some((s:any)=>s.type!=='transaction'||s.amount!==undefined))throw new NoWriteError('Supply two complete native transactions without partial amounts');
 const before=await bankSnapshot(read,org,a.bankLineId);
 return jsonResult(await journalRun(db,org,a.operationId,'bankmatch:'+(before.match?.id??a.bankLineId),{action:'reconcile_test_bank_line',...a},async()=>{
 let g:any;
 try{supported(before);if(before.associations.length)throw new NoWriteError('Correction group needs an empty match');if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read bank line again');g=await groupEvidence(read,org,before,a.subjects.map((s:any)=>s.id));await freshSources(read,org,g);if((await bankSnapshot(read,org,a.bankLineId)).revision!==before.revision)throw new NoWriteError('STALE_REVISION: bank changed');}catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Correction group preflight failed; no write performed');}
 for(const p of g.bankPostings)await write.post('/bankLineSubjectAssociations',{bankLineSubjectAssociation:{matchId:before.match.id,subjectReference:'posting:'+p.id}});
 const after=await bankSnapshot(read,org,a.bankLineId);
 if(after.match?.id!==before.match.id||after.match.isApproved!==false||stable(after.lines)!==stable(before.lines)||stable(refs(after))!==stable(g.bankPostings.map((p:any)=>'posting:'+p.id).sort()))throw new Error('Correction group link readback mismatch');
 await verifiedPostings(read,org,g,false);
 return{...after,transactionIds:g.entries.map((e:any)=>e.transaction.id),postingIds:g.bankPostings.map((p:any)=>p.id),reasoning:a.reasoning,ledgerEffect:'none',requiresSeparateApproval:true};
 }));
}catch(e){return errorResult(e);}}
export async function correctionGroupApprove(read:BillyClient,write:BillyClient,db:JournalDB,org:string,a:any){try{
 id.parse(a.matchId);
 return jsonResult(await journalRun(db,org,a.operationId,'bankmatch:'+a.matchId,{action:'approve_test_bank_match',...a},async()=>{
 let before:any,g:any;
 try{
 const {bankLineMatch:m}=await read.get('/bankLineMatches/'+a.matchId);if(m?.id!==a.matchId)throw new NoWriteError('Missing match');id.parse(m.accountId);
 const rows=await read.fetchAll('/bankLines','bankLines',{accountId:m.accountId,status:'booked'});const lines=rows.filter((l:any)=>l.matchId===a.matchId);if(lines.length!==1)throw new NoWriteError('Expected one bank line');
 before=await bankSnapshot(read,org,lines[0].id);supported(before);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read bank line again');
 if(before.associations.length<2||before.associations.length>3)throw new NoWriteError('Expected correction group posting associations');
 const txids=new Set<string>();for(const r of refs(before)){if(!/^posting:[A-Za-z0-9_-]{1,100}$/.test(r))throw new NoWriteError('Expected posting associations');const {posting:p}=await read.get('/postings/'+r.split(':')[1]);if(p?.id!==r.split(':')[1]||p.organizationId!==org||p.accountId!==before.account.id)throw new NoWriteError('Unexpected posting association');txids.add(p.transactionId);}
 g=await groupEvidence(read,org,before,[...txids]);if(stable(refs(before))!==stable(g.bankPostings.map((p:any)=>'posting:'+p.id).sort()))throw new NoWriteError('Incomplete or duplicate correction group');
 await freshSources(read,org,g);if((await bankSnapshot(read,org,before.bankLine.id)).revision!==before.revision)throw new NoWriteError('STALE_REVISION: bank changed');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Correction approval preflight failed; no write performed');}
 await write.put('/bankLineMatches/'+a.matchId,{bankLineMatch:{isApproved:true}});
 const after=await bankSnapshot(read,org,before.bankLine.id);
 if(after.match?.id!==a.matchId||after.match.isApproved!==true||stable(after.lines)!==stable(before.lines)||stable(refs(after))!==stable(refs(before)))throw new Error('Correction group approval readback mismatch');
 const postings=await verifiedPostings(read,org,g,true);
 return{...after,postings,transactionIds:g.entries.map((e:any)=>e.transaction.id),reasoning:a.reasoning,ledgerEffect:'none'};
 }));
}catch(e){return errorResult(e);}}
