import type {BillyClient} from './billy-client.js';
import type {JournalDB} from './test-drafts.js';
import {correctionSource,validateReversalRecoveryLines} from './test-corrections.js';
import {draftSnapshot} from './test-extended-drafts.js';
import {validate} from './test-finalize.js';
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
// Recover evidence only. No Billy write client is available here.
export async function recoverPendingReversal(read:BillyClient,db:JournalDB,orgId:string,a:any){
 const journalId=orgId+':'+a.operationId;
 const row=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<{fingerprint:string;state:string;result:string|null;target:string}>();
 if(!row||row.state!=='pending')return undefined;
 const fingerprint=stable({action:'propose_test_reversal',...a});
 if(row.fingerprint!==fingerprint||row.target!==orgId+':correction:'+a.transactionId)throw Error('Pending reversal input/target mismatch; no recovery performed');
 const original=await correctionSource(read,orgId,a.transactionId);
 if(original.preservedBank||original.revision!==a.expectedRevision||a.entryDate<original.transaction.entryDate)throw Error('Pending reversal source changed; no recovery performed');
 const marker='mcp-test:correction:'+a.transactionId;
 const candidates=(await read.fetchAll('/daybookTransactions','daybookTransactions',{organizationId:orgId,apiType:marker})).filter((h:any)=>h.apiType===marker&&h.state!=='voided');
 if(candidates.length!==1)throw Error('Pending reversal requires exactly one existing draft; no recovery performed');
 const draft=await draftSnapshot(read,candidates[0].id,orgId);validate(draft,'draft',original.hasVat,original.hasFx);
 const h=draft.daybookTransaction;
 if(h.apiType!==marker||h.daybookId!==original.source.daybookTransaction.daybookId||h.entryDate!==a.entryDate||h.description!==a.description||h.extendedDescription!=='Korrektionskladde for transaction '+a.transactionId+'. '+a.reasoning||h.voucherNo!=null&&h.voucherNo!=='')throw Error('Pending reversal header mismatch');
 validateReversalRecoveryLines(original,draft);
 const files=(xs:any[])=>xs.map(x=>x.fileId).sort();
 const expectedFiles=[...new Set(original.source.attachments.map((x:any)=>x.fileId))].sort();
 if(stable(files(draft.attachments))!==stable(expectedFiles))throw Error('Pending reversal attachment mismatch');
 for(const accountId of new Set(draft.daybookTransactionLines.map((l:any)=>l.accountId))){const {account}=await read.get('/accounts/'+accountId);if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw Error('Pending reversal account mismatch');}
 if((await correctionSource(read,orgId,a.transactionId,original.taxRates)).revision!==original.revision||(await draftSnapshot(read,h.id,orgId)).revision!==draft.revision)throw Error('Pending reversal evidence changed during recovery');
 const result={kind:'reversal_only',bankMatchPreserved:false,sourceTransactionId:a.transactionId,sourceRevision:original.revision,originalUnchanged:true,correctionDraft:draft,reasoning:a.reasoning,ledgerEffect:'none_until_separately_booked',nativeVoid:false,recovery:{kind:'verified_existing_reversal_draft',previousState:'pending',nativeWrites:0}};
 const saved=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,row.target).run();
 if(!saved.success||saved.meta.changes!==1)throw Error('Pending reversal journal changed; inspect before continuing');
 return {replayed:false,operationId:a.operationId,result};
}
