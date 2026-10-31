import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import type {JournalDB} from '../src/test-drafts.js';
import {guardedJournal} from '../src/test-write-attempts.js';
export function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of ['0001_test_write_journal.sql','0003_guarded_write_attempts.sql'])sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const raw:JournalDB={prepare(query){return{bind(...values:any[]){return{async first<T>(){return (sql.prepare(query).get(...values)??null) as T;},async run(){const r=sql.prepare(query).run(...values);return{success:true,meta:{changes:Number(r.changes)}};}};}};}};
 return{sql,db:guardedJournal(raw)};
}
