import {test} from 'node:test';import assert from 'node:assert/strict';
import {journalRun,NoWriteError} from '../src/test-drafts.js';
import {guardedWriteClient} from '../src/test-write-attempts.js';
import {database} from './guarded-db.js';
const key='a1111111-1111-4111-8111-111111111111';
test('expired pre-write request resumes once; its suspended predecessor cannot write or overwrite evidence',async()=>{
 const {sql,db}=database();let native=0,release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const write=guardedWriteClient({post:async()=>{native++;return{};}} as any);
 const old=journalRun(db,'org',key,'target',{x:1},async()=>{entered();await waiting;
  const checkpoint=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind('{"stale":true}','org:'+key).run();assert.equal(checkpoint.meta.changes,0);
  await write.post('/attachments',{});return{old:true};
 });
 const oldRejected=assert.rejects(old,/expired|superseded/);await ready;
 await assert.rejects(journalRun(db,'org',key,'target',{x:1},async()=>{throw Error('must not run');}),/pending/);
 sql.prepare('UPDATE operations SET lease_until=0 WHERE id=?').run('org:'+key);
 const next=await journalRun(db,'org',key,'target',{x:1},async()=>{await write.post('/attachments',{});return{current:true};});
 assert.deepEqual(next.result,{current:true});release();await oldRejected;assert.equal(native,1);
 assert.deepEqual((await journalRun(db,'org',key,'target',{x:1},async()=>{throw Error('no replay write');})).result,{current:true});sql.close();
});
test('uncertain native write is never repeated, even after lease expiry or a misclassified NoWriteError',async()=>{
 for(const error of [Error('lost response'),new NoWriteError('misclassified')]){
  const {sql,db}=database();let count=0;const write=guardedWriteClient({put:async()=>{count++;throw error;}} as any);
  await assert.rejects(journalRun(db,'org',key,'target',{},()=>write.put('/invoices/id',{})));
  sql.prepare('UPDATE operations SET lease_until=0 WHERE id=?').run('org:'+key);
  await assert.rejects(journalRun(db,'org',key,'target',{},()=>write.put('/invoices/id',{})),/pending/);
  assert.equal(count,1);assert.equal(sql.prepare('SELECT write_phase FROM operations').get()?.write_phase,'writing');sql.close();
 }
});
test('legacy unknown operations, mismatched input, and another target lock stay blocked',async()=>{
 const {sql,db}=database();sql.prepare("INSERT INTO operations(id,fingerprint,target,state) VALUES(?,?,?,'pending')").run('org:'+key,'{}','org:target');
 await assert.rejects(journalRun(db,'org',key,'target',{},async()=>({})),/pending/);
 await assert.rejects(journalRun(db,'org',key,'target',{changed:true},async()=>({})),/different input/);
 await assert.rejects(journalRun(db,'org','other','target',{},async()=>({})),/locks/);sql.close();
});
test('guard refuses native writes outside a journal and before-write validation releases only its own reservation',async()=>{
 const {sql,db}=database();let writes=0;const client=guardedWriteClient({postBinary:async()=>{writes++;return{};}} as any);
 await assert.rejects(client.postBinary('/files',new Uint8Array(),{fileName:'a',contentType:'b'}),/active guarded/);
 await assert.rejects(journalRun(db,'org',key,'target',{},async()=>{throw new NoWriteError('invalid');}),/invalid/);
 assert.equal(sql.prepare('SELECT count(*) n FROM operations').get()?.n,0);assert.equal(writes,0);sql.close();
});
