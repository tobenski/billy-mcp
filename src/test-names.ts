import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';

export const nameDescriptions:Record<string,string>={
 rename_test_account:'Rename one account in the locked test company after checking expectedName. Sends only name; verifies all other fields except updatedTime remain unchanged. Archived accounts refused. Uses persistent operation replay; no postings or account numbers changed.',
 rename_test_account_group:'Rename a CUSTOM account group in the locked test company after checking expectedName. Predefined groups are read-only and refused before writing. Sends only name; preserves all other fields except updatedTime, including subtotal logic. Custom group writes have automated coverage but await positive live verification. Uses persistent operation replay.',
};
const schema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),name:z.string().min(1).max(100).refine(s=>s.trim()===s&&!/[\u0000-\u001f\u007f]/.test(s),'Use a nonblank name without surrounding whitespace or control characters'),expectedName:z.string(),operationId:z.string().uuid(),reasoning:z.string().min(1).max(4000)}).strict();
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
function unchanged(record:any){const {name,updatedTime,...rest}=record;return stable(rest);}
export function nameHandler(read:BillyClient,write:BillyClient,db:JournalDB,orgId:string,tool:string){return async(input:any)=>{try{
 const a=schema.parse(input);if(!(tool in nameDescriptions))throw new NoWriteError('Unknown rename tool');
 const singular=tool==='rename_test_account'?'account':'accountGroup',path='/'+singular+'s/'+a.id;
 const {organization}=await read.get('/organization');if(organization?.id!==orgId)throw new NoWriteError('Test organization mismatch');
 return jsonResult(await journalRun(db,orgId,a.operationId,singular+':'+a.id,{action:tool,...a},async()=>{
 let before:any;
 try{
  before=(await read.get(path))[singular];
  if(before?.id!==a.id||before.organizationId!==orgId||before.isArchived)throw new NoWriteError('Expected active record in the test organization');
  if(singular==='accountGroup'&&before.predefinedAccountGroupId)throw new NoWriteError('Predefined account groups are read-only in Billy; only custom groups may be renamed');
  if(before.name!==a.expectedName)throw new NoWriteError('STALE_NAME: read the current name before renaming');
  if(before.name===a.name)return{changed:false,[singular]:before,reasoning:a.reasoning};
  const current=(await read.get(path))[singular];if(stable(current)!==stable(before))throw new NoWriteError('Record changed during preflight; read again');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Rename preflight failed. No write performed.');}
 try{await write.put(path,{[singular]:{name:a.name}});}catch(e){
  const match=(e instanceof Error?e.message:'').match(/failed with (\d+): ([\s\S]*)/);
  let diagnostic:any;try{const body=JSON.parse(match?.[2]??'{}');diagnostic={errorCode:typeof body.errorCode==='string'||typeof body.errorCode==='number'?body.errorCode:undefined,errorMessage:typeof body.errorMessage==='string'?body.errorMessage.slice(0,300):undefined};}catch{}
  await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify({phase:'rename_request',resource:singular,httpStatus:match?Number(match[1]):null,diagnostic,outcome:'unknown; inspect current record before resolving'}),orgId+':'+a.operationId).run();
  throw e;
 }
 const after=(await read.get(path))[singular];
 if(!after||after.name!==a.name||unchanged(after)!==unchanged(before))throw new Error('Rename readback mismatch; inspect operation before further writes');
 return{changed:true,previousName:before.name,[singular]:after,reasoning:a.reasoning};
 }));
 }catch(e){return errorResult(e);}};}
