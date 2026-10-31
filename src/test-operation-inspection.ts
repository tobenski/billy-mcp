import type {BillyClient} from './billy-client.js';
import {bankSnapshot} from './test-bank.js';
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);

// Observations only: never complete a journal row, release a lock or retry a write.
export async function inspectBankOperation(read:BillyClient,org:string,input:any){
 const actions=['reconcile_test_bank_line','unlink_test_bank_line','approve_test_bank_match','reconcile_test_bank_allocations'];
 if(!actions.includes(input?.action))return {supported:false,reason:'Current-state inspection is implemented for bank operations only.'};
 let lineId=input.bankLineId;
 if(input.action==='approve_test_bank_match'){
  if(!validId(input.matchId))throw new Error('Invalid journal match ID');
  const {bankLineMatch:m}=await read.get('/bankLineMatches/'+input.matchId);
  if(m?.id!==input.matchId||!validId(m.accountId))throw new Error('Unexpected match');
  const {account}=await read.get('/accounts/'+m.accountId);
  if(account?.id!==m.accountId||account.organizationId!==org)throw new Error('Unexpected organization');
  const rows:any[]=[];
  for(const status of ['booked','pending'])rows.push(...await read.fetchAll('/bankLines','bankLines',{accountId:m.accountId,status}));
  if(rows.some(l=>l.accountId!==m.accountId))throw new Error('Unexpected bank account');
  const lines=[...new Map(rows.filter(l=>l.matchId===m.id).map(l=>[l.id,l])).values()];
  if(lines.length!==1)throw new Error('Expected exactly one bank line');
  lineId=lines[0].id;
 }
 if(!validId(lineId))throw new Error('Invalid journal bank line ID');
 const bank=await bankSnapshot(read,org,lineId);
 if(input.matchId&&bank.match?.id!==input.matchId)throw new Error('Bank line now belongs to a different match');
 if(bank.associations.length>3)return {supported:true,bank,postingInspection:'not_attempted_more_than_three_associations',outcome:'undetermined',safeToRetry:false};
 const postings:any[]=[];
 for(const association of bank.associations){
  const ref=association.subjectReference;
  if(typeof ref!=='string'||!ref.startsWith('posting:'))continue;
  const postingId=ref.slice(8);if(!validId(postingId))throw new Error('Invalid posting reference');
  const {posting}=await read.get('/postings/'+postingId);
  if(posting?.id!==postingId||posting.organizationId!==org||posting.accountId!==bank.account.id)throw new Error('Unexpected associated posting');
  postings.push(posting);
 }
 const observedState=bank.match?.isApproved===true?'approved':bank.match?.isApproved===false?(bank.associations.length?'unapproved_with_associations':'unapproved_without_associations'):'unknown';
 const after=await bankSnapshot(read,org,lineId);
 return {supported:true,bank,associatedPostings:postings,observedState,bankStableDuringRead:after.revision===bank.revision,outcome:'undetermined',safeToRetry:false,
  limitations:['Current observations do not prove which operation caused them or whether all intended writes succeeded.','No journal state or lock was changed. Never retry a pending operation with a new ID.','Empty or partial associations do not identify removed postings; compare the saved preflight evidence.','Optimistic reads do not lock concurrent Billy changes.']};
}


// Read-only diagnostic evidence. No DB or writable client is accepted here.
export async function inspectWriteOperation(read:BillyClient,org:string,input:any,saved:any=null){
 const action=input?.action;
 if(['reconcile_test_bank_line','unlink_test_bank_line','approve_test_bank_match','reconcile_test_bank_allocations'].includes(action))return inspectBankOperation(read,org,input);
 const envelope=(e:any)=>({supported:true,...e,outcome:'undetermined',safeToRetry:false,journalChanged:false,limitations:['Current evidence does not prove which request caused a change.','Saved results are historical; no pending lock is released and no native write is repeated.']});
 const checked=(value:any)=>{if(!validId(value))throw Error('Invalid saved subject ID');return value;};
 if(action==='void_test_document_payment'||action==='create_test_fx_adjustment_draft'){
  const {paymentSnapshot}=await import('./test-document-payments.js');const payment=await paymentSnapshot(read,org,checked(input.paymentId));return envelope({payment});
 }
 if(['create_test_credit_note_draft','create_test_bill_credit_note_draft'].includes(action)){
  if(typeof input.operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId))throw Error('Invalid credit operation ID');
  const kind=action.includes('bill')?'bill':'invoice',sourceId=checked(input.billId??input.invoiceId),marker='TEST-'+input.operationId,numberKey=kind==='bill'?'voucherNo':'invoiceNo',sourceKey=kind==='bill'?'creditedBillId':'creditedInvoiceId';
  const {invoiceSnapshot}=await import('./test-invoice-drafts.js');const {billSnapshot}=await import('./test-bill-drafts.js');const snapshot=(id:string)=>kind==='invoice'?invoiceSnapshot(read,org,id):billSnapshot(read,org,id);
  const before=await snapshot(sourceId);const candidates=(await read.fetchAll('/'+kind+'s',kind+'s',{organizationId:org,[numberKey]:marker})).filter(x=>x[numberKey]===marker);
  if(candidates.some(x=>x.organizationId!==org||x.type!=='creditNote'||x[sourceKey]!==sourceId))throw Error('Unexpected credit candidate ownership or source');
  if(candidates.length>4)return envelope({source:before,candidateCount:candidates.length,creditInspection:'not_attempted_more_than_four_candidates'});
  const credits:any[]=[];for(const candidate of candidates){const current:any=await snapshot(checked(candidate.id));if(current[kind][numberKey]!==marker||current[kind][sourceKey]!==sourceId||current[kind].type!=='creditNote')throw Error('Credit candidate changed during inspection');credits.push(current);}
  const stability:boolean[]=[];for(const credit of credits)stability.push((await snapshot(credit[kind].id)).revision===credit.revision);
  const after=await snapshot(sourceId);return envelope({source:after,creditCandidates:credits,candidateCount:credits.length,sourceStableDuringRead:before.revision===after.revision,creditCandidatesStableDuringRead:stability.every(Boolean),observedState:credits.length===0?'no_marked_credit':credits.length===1?'one_marked_credit':'multiple_marked_credits'});
 }
 if(['book_test_invoice_draft','book_test_bill_draft','record_test_invoice_payment','record_test_bill_payment','create_test_credit_note_draft','create_test_bill_credit_note_draft'].includes(action)){
  const kind=action.includes('bill')?'bill':'invoice',recordId=checked(input.id??input.billId??input.invoiceId);
  const {invoiceSnapshot}=await import('./test-invoice-drafts.js');const {billSnapshot}=await import('./test-bill-drafts.js');const snapshot=()=>kind==='invoice'?invoiceSnapshot(read,org,recordId):billSnapshot(read,org,recordId);
  const before:any=await snapshot(),reference=kind+':'+recordId;
  const allocations=(await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:reference}));if(allocations.some(x=>x.subjectReference!==reference))throw Error('Wrong allocation subject');
  const payments:any[]=[];const ids=[...new Set<string>(allocations.filter(x=>typeof x.modifierReference==='string'&&x.modifierReference.startsWith('bankPayment:')).map(x=>x.modifierReference.slice(12)))];
  if(ids.length>5)return envelope({document:before,allocations,paymentInspection:'not_attempted_more_than_five_payments'});
  for(const paymentId of ids){checked(paymentId);const {bankPayment:p}=await read.get('/bankPayments/'+paymentId);if(p?.id!==paymentId||p.organizationId!==org||p.contactId!==before[kind].contactId)throw Error('Wrong payment ownership');payments.push(p);}
  const references=[reference,...ids.map(id=>'bankPayment:'+id)];const transactions=(await read.fetchAll('/transactions','transactions',{organizationId:org})).filter(t=>references.includes(t.originatorReference));if(transactions.some(t=>t.organizationId!==org))throw Error('Wrong transaction ownership');
  if(transactions.length>6)return envelope({document:before,allocations,payments,transactions,postingInspection:'not_attempted_more_than_six_transactions'});
  const postings:any[]=[];for(const t of transactions){const ps=await read.fetchAll('/postings','postings',{organizationId:org,transactionId:checked(t.id)});if(ps.some(p=>p.organizationId!==org||p.transactionId!==t.id))throw Error('Wrong posting ownership');postings.push(...ps);}
  const after=await snapshot();return envelope({document:after,allocations,payments,transactions,postings,documentStableDuringRead:before.revision===after.revision});
 }
 if(action==='book_test_daybook_draft'){
  const {draftSnapshot}=await import('./test-extended-drafts.js');const subjectId=checked(input.daybookTransactionId);return envelope({draft:await draftSnapshot(read,subjectId,org)});
 }
 if(['record_test_vat_payment','void_test_vat_payment','set_test_vat_return_settlement'].includes(action)){
  let returnId=input.returnId??saved?.returnId??saved?.salesTaxPayment?.returnId;
  if(action==='void_test_vat_payment'){const paymentId=checked(input.paymentId);const {salesTaxPayment:p}=await read.get('/salesTaxPayments/'+paymentId);if(p?.id!==paymentId||p.organizationId!=null&&p.organizationId!==org||returnId!=null&&p.returnId!==returnId)throw Error('Wrong VAT payment ownership');returnId=p.returnId;}
  const {vatPeriod}=await import('./test-vat-management.js');return envelope({vatPeriod:await vatPeriod(read,org,checked(returnId))});
 }
 return {supported:false,reason:'No dedicated current-evidence reader for this operation type.',outcome:'undetermined',safeToRetry:false};
}
