import {AsyncLocalStorage} from 'node:async_hooks';
import type {BillyClient} from './billy-client.js';
import type {JournalDB} from './test-drafts.js';
import {NoWriteError} from './test-drafts.js';

type Attempt={db:JournalDB;id:string;token:string};
const context=new AsyncLocalStorage<Attempt>();
export const PREWRITE_LEASE_MS=60_000;
const canonical=(v:any):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);

// Fence ALL journal updates made by a suspended old handler, including its
// recovery checkpoints. The new attempt must not inherit stale evidence.
export function guardedJournal(db:JournalDB):JournalDB {
 return {guardedWrites:true,prepare(sql:string){
  const attempt=context.getStore();
  const fence=attempt&&/^(UPDATE operations SET|DELETE FROM operations WHERE)/.test(sql);
  const statement=db.prepare(fence?sql+' AND attempt_token = ?':sql);
  return {bind(...values:unknown[]){return statement.bind(...values,...(fence?[attempt!.token]:[]));}};
 }};
}

export async function beforeNativeWrite(){
 const a=context.getStore();if(!a)throw Error('Native write requires an active guarded journal attempt');
 const r=await a.db.prepare("UPDATE operations SET write_phase = 'writing' WHERE id = ? AND state = 'pending' AND attempt_token = ? AND (write_phase = 'writing' OR (write_phase = 'prepared' AND lease_until >= ?))").bind(a.id,a.token,Date.now()).run();
 if(!r.success||r.meta.changes!==1)throw Error('Write attempt expired or was superseded; no native write performed');
}
export function guardedWriteClient(client:BillyClient):BillyClient {
 const mutations=new Set(['post','put','del','postBinary']);
 return new Proxy(client,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  return mutations.has(String(key))?async(...args:any[])=>{await beforeNativeWrite();return value.apply(target,args);}:value.bind(target);
 }});
}

export async function guardedJournalRun(db:JournalDB,org:string,key:string,target:string,payload:unknown,action:()=>Promise<unknown>){
 const id=org+':'+key,fingerprint=canonical(payload),token=crypto.randomUUID(),until=Date.now()+PREWRITE_LEASE_MS;
 const get=()=>db.prepare('SELECT fingerprint, target, state, result, attempt_token, write_phase, lease_until FROM operations WHERE id = ?').bind(id).first<any>();
 let row=await get();
 if(!row){
  const r=await db.prepare("INSERT OR IGNORE INTO operations (id,fingerprint,target,state,attempt_token,write_phase,lease_until) VALUES (?,?,?,'pending',?,'prepared',?)").bind(id,fingerprint,org+':'+target,token,until).run();
  if(!r.success)throw Error('Write journal unavailable; no native write performed');
  if(r.meta.changes!==1){row=await get();if(!row)throw Error('Another pending operation locks this target');}
 }
 if(row){
  if(row.fingerprint!==fingerprint||row.target!==org+':'+target)throw Error('Operation ID already used with different input');
  if(row.state==='complete')return{replayed:true,operationId:key,result:JSON.parse(row.result)};
  // Never infer failure from an absent response or from unchanged native data.
  // Only a durable prepared phase proves no mutation passed the write gate.
  if(row.write_phase!=='prepared'||!row.attempt_token||typeof row.lease_until!=='number'||row.lease_until>=Date.now())throw Error('Operation pending: inspect outcome; only expired pre-write attempts can resume with the exact same input');
  const r=await db.prepare("UPDATE operations SET attempt_token = ?, lease_until = ?, result = NULL WHERE id = ? AND state = 'pending' AND write_phase = 'prepared' AND attempt_token = ? AND lease_until < ?").bind(token,until,id,row.attempt_token,Date.now()).run();
  if(!r.success||r.meta.changes!==1)throw Error('Operation changed during recovery; no native write performed');
 }
 return context.run({db,id,token},async()=>{
  try{
   const result=await action();
   const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND attempt_token = ?").bind(JSON.stringify(result),id,token).run();
   if(!r.success||r.meta.changes!==1)throw Error('Attempt changed before completion; inspect journal');
   return{replayed:false,operationId:key,result};
  }catch(error){
   if(error instanceof NoWriteError){
    // A misclassified error must never release a lock after a native mutation.
    await db.prepare("DELETE FROM operations WHERE id = ? AND state = 'pending' AND attempt_token = ? AND write_phase = 'prepared'").bind(id,token).run();
   }
   throw error;
  }
 });
}
