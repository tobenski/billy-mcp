import type {BillyClient} from './billy-client.js';
import {contactSnapshot} from './test-contacts.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
export const archiveDescription='Archive or restore one test-tool-marked contact using a fresh get_contact revision. Changes only isArchived, preserves contact persons and unrelated fields. No deletion, delivery or ledger changes. Exact operation replay.';
export function archiveContactHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string){return async(a:any)=>{try{
 z.string().uuid().parse(a.operationId);z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(a.id);z.boolean().parse(a.isArchived);z.string().min(1).parse(a.reasoning);
 const {organization}=await read.get('/organization');if(organization?.id!==org)throw new NoWriteError('Test organization mismatch');
 return jsonResult(await journalRun(db,org,a.operationId,'contacts',{action:'archive_test_contact',...a},async()=>{
 let before:any;
 try{before=await contactSnapshot(read,org,a.id);if(!before.contact.contactNo?.startsWith('mcp-test:')||typeof before.contact.isArchived!=='boolean')throw new NoWriteError('Expected test-tool-marked contact');
 const marker=/^mcp-test:([a-f0-9-]{36})$/.exec(before.contact.contactNo)?.[1];if(!marker)throw new NoWriteError('Missing test contact marker');
 const row=await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(org+':'+marker).first<{fingerprint:string;state:string;result:string}>();
 if(row?.state!=='complete'||JSON.parse(row.fingerprint).action!=='create_test_contact'||JSON.parse(row.result).contact?.id!==a.id)throw new NoWriteError('Contact provenance cannot be proved');
 if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_contact again');
 if(before.contact.isArchived===a.isArchived)throw new NoWriteError('Contact already has requested archive state');
 if((await contactSnapshot(read,org,a.id)).revision!==before.revision)throw new NoWriteError('Contact changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Archive preflight failed; no write performed');}
 await write.put('/contacts/'+a.id,{contact:{isArchived:a.isArchived}});
 const after=await contactSnapshot(read,org,a.id);
 const comparable=(v:any)=>{const {isArchived,updatedTime,...rest}=v;return rest;};
 if(after.contact.isArchived!==a.isArchived||canonical(comparable(before.contact))!==canonical(comparable(after.contact))||canonical(before.contactPersons)!==canonical(after.contactPersons))throw Error('Unexpected archive readback');
 return{...after,before,reasoning:a.reasoning,deleted:false,ledgerChanges:false};
 }));
 }catch(e){return errorResult(e);}};}
