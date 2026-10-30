import type {BillyClient} from './billy-client.js';
import {bankSnapshot} from './test-bank.js';
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);

// Observations only: never complete a journal row, release a lock or retry a write.
export async function inspectBankOperation(read:BillyClient,org:string,input:any){
 const actions=['reconcile_test_bank_line','unlink_test_bank_line','approve_test_bank_match'];
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
