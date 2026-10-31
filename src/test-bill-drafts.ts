import {sourceCurrencies,isForeignCurrency} from './test-currency.js';
import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import {sha256} from './test-files.js';
import {standardVatRates} from './test-vat.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const cents=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<=0||n>1e6||Math.abs(n*100-Math.round(n*100))>1e-7)throw new NoWriteError('Expected positive two-decimal amount at most 1000000');return Math.round(n*100);};
const sorted=(rows:any[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
export const billDraftDescriptions:Record<string,string>={
 create_test_bill_draft:'Create a test supplier-bill draft in DKK/EUR/USD/GBP/SEK/NOK with explicit gross lines (maximum 20 lines/eight accounts/eight VAT codes), quantity 1 and validated standard purchase VAT. Foreign currency requires explicit native exchangeRate; no rate is selected. Contact must be an active test supplier. Description is an audit note in the operation journal, not a native bill field. Adds owned attachment-file links. Does not book or pay. Returns native bill, all lines/files and revision.',
 update_test_bill_draft:'Update date/dueDate, replace all gross lines or add attachment links on a journal-proven test supplier-bill draft. Description is an operation-journal note only. Contact, currency and rate cannot change. Fresh get_bill revision required. Does not book or pay.',
 delete_test_bill_draft:'Delete a journal-proven test supplier-bill draft after fresh revision and state checks. Verifies native deletion; never deletes source files or approved bills. Persistent operation replay.',
};
export async function billSnapshot(read:BillyClient,org:string,billId:string){
 id.parse(billId);const {organization}=await read.get('/organization');if(organization?.id!==org)throw new NoWriteError('Organization mismatch');
 const {bill}=await read.get('/bills/'+billId);if(bill?.id!==billId||bill.organizationId!==org)throw new NoWriteError('Unexpected bill ownership');
 const billLines=sorted(await read.fetchAll('/billLines','billLines',{billId}));
 const attachments=sorted(await read.fetchAll('/attachments','attachments',{ownerReference:'bill:'+billId}));
 if(billLines.some(l=>l.billId!==billId)||attachments.some(a=>a.organizationId!==org||a.ownerReference!=='bill:'+billId))throw new NoWriteError('Unexpected bill child ownership');
 const value={bill,billLines,attachments};return{...value,revision:await sha256(new TextEncoder().encode(canonical(value)))};
}
async function owned(db:JournalDB,org:string,b:any){
 const key=/^TEST-([a-f0-9-]{36})$/.exec(b.voucherNo??'')?.[1];if(!key)throw new NoWriteError('Expected test-tool-created bill');z.string().uuid().parse(key);
 const row=await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(org+':'+key).first<{fingerprint:string;state:string;result:string}>();
 if(row?.state!=='complete'||JSON.parse(row.fingerprint).action!=='create_test_bill_draft'||JSON.parse(row.result).bill?.id!==b.id)throw new NoWriteError('Bill provenance cannot be proved');
}
const comparableLines=(ls:any[])=>ls.map(l=>canonical({accountId:l.accountId,description:l.description,amount:l.amount,taxRateId:l.taxRateId??null})).sort();
function supported(b:any){if(b.state!=='draft'||b.type!=='bill'||b.taxMode!=='incl'||!sourceCurrencies.includes(b.currencyId)||typeof b.exchangeRate!=='number'||!Number.isFinite(b.exchangeRate)||b.exchangeRate<=0||b.currencyId==='DKK'&&b.exchangeRate!==1||b.creditedBillId||b.paymentAccountId||b.isPaid!==false)throw new NoWriteError('Only unpaid supported-currency draft bills without payment/credit links supported');}
function normalize(ls:any[]){if(!Array.isArray(ls)||!ls.length||ls.length>20)throw new NoWriteError('Supply 1-20 lines');return ls.map(l=>{id.parse(l.accountId);if(l.quantity!==1||l.productId!==undefined||l.amountBasis!=='gross')throw new NoWriteError('Bill lines require quantity 1, gross basis and no productId');cents(l.unitPrice);z.string().min(1).max(500).parse(l.description);if(l.taxRateId!==null)id.parse(l.taxRateId);return{accountId:l.accountId,description:l.description,amount:l.unitPrice,taxRateId:l.taxRateId};});}
export function billDraftHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string){return async(a:any)=>{try{
 const creating=name==='create_test_bill_draft',deleting=name==='delete_test_bill_draft';if(!billDraftDescriptions[name])throw new NoWriteError('Unsupported bill action');
 z.string().uuid().parse(a.operationId);z.string().min(1).max(4000).parse(a.reasoning);
 if(!creating){id.parse(a.id);z.string().min(1).parse(a.expectedRevision);}
 if(a.description!==undefined)z.string().min(1).max(4000).parse(a.description);
 if(a.currencyId!==undefined&&!sourceCurrencies.includes(a.currencyId))throw new NoWriteError('Unsupported bill currency');
 if(a.exchangeRate!==undefined)z.number().positive().max(1000000).parse(a.exchangeRate);
 const lines=a.lines===undefined?undefined:normalize(a.lines);const attachmentIds=z.array(id).max(5).parse(a.attachmentIds??[]);
 if(!creating&&!deleting&&!['entryDate','dueDate','lines','description'].some(k=>a[k]!==undefined)&&!attachmentIds.length)throw new NoWriteError('Supply a supported change');
 const {organization}=await read.get('/organization');if(organization?.id!==org||organization.baseCurrencyId!=='DKK')throw new NoWriteError('Expected DKK test organization');
 return jsonResult(await journalRun(db,org,a.operationId,creating?'bill-create:'+a.operationId:'bill:'+a.id,{action:name,...a},async()=>{
 let before:any;const files:string[]=[];let payload:any={};
 try{
 if(!creating){before=await billSnapshot(read,org,a.id);supported(before.bill);await owned(db,org,before.bill);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_bill again');}
 if(!deleting){
 if(before?.billLines.some((l:any)=>l.quantity!=null&&l.quantity!==1||l.productId!=null))throw new NoWriteError('Existing bill has unsupported quantities or product links');
 const contactId=creating?id.parse(a.contactId):before.bill.contactId;if(!creating&&a.contactId!==undefined&&a.contactId!==contactId)throw new NoWriteError('Bill contact is immutable');
 const {contact}=await read.get('/contacts/'+contactId);if(contact?.id!==contactId||contact.organizationId!==org||contact.isArchived||contact.isSupplier!==true||!contact.contactNo?.startsWith('mcp-test:'))throw new NoWriteError('Expected active test supplier');
 const currencyId=creating?a.currencyId:before.bill.currencyId;
 if(!creating&&(a.currencyId!==undefined&&a.currencyId!==currencyId||a.exchangeRate!==undefined&&a.exchangeRate!==before.bill.exchangeRate))throw new NoWriteError('Currency/rate changes require a new draft');
 const exchangeRate=creating?(isForeignCurrency(currencyId)?z.number().positive().max(1000000).parse(a.exchangeRate):1):before.bill.exchangeRate;if(currencyId==='DKK'&&a.exchangeRate!==undefined&&a.exchangeRate!==1)throw new NoWriteError('DKK exchangeRate must be 1');
 const entryDate=a.entryDate??before?.bill.entryDate,dueDate=a.dueDate??before?.bill.dueDate;z.iso.date().parse(entryDate);z.iso.date().parse(dueDate);if(dueDate<entryDate)throw new NoWriteError('Due date precedes bill date');
 const allLines=lines??before?.billLines;if(!allLines?.length)throw new NoWriteError('Bill lines required');
 if(new Set(allLines.map((l:any)=>l.accountId)).size>8||new Set(allLines.map((l:any)=>l.taxRateId).filter(Boolean)).size>8)throw new NoWriteError('Maximum eight accounts and eight VAT codes per bill draft');
 const rates=await standardVatRates(read,org,allLines.map((l:any)=>({...l,currencyId:'DKK',side:'debit'})));if(rates.some(r=>!r.appliesToPurchases))throw new NoWriteError('Purchase VAT code required');
 for(const accountId of new Set<string>(allLines.map((l:any)=>l.accountId))){const {account}=await read.get('/accounts/'+id.parse(accountId));if(account?.id!==accountId||account.organizationId!==org||account.isArchived||account.isBankAccount||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Expected active DKK non-bank account');}
 for(const attachmentId of new Set<string>(attachmentIds)){const {attachment}=await read.get('/attachments/'+attachmentId);if(attachment?.id!==attachmentId||attachment.organizationId!==org)throw new NoWriteError('Unexpected attachment');files.push(id.parse(attachment.fileId));}
 if(creating)payload={organizationId:org,contactId,entryDate,dueDate,currencyId,exchangeRate,taxMode:'incl',state:'draft',voucherNo:'TEST-'+a.operationId,lines};
 else{for(const k of ['entryDate','dueDate'])if(a[k]!==undefined)payload[k]=a[k];if(lines)payload.lines=lines;}
 }
 if(before&&(await billSnapshot(read,org,a.id)).revision!==before.revision)throw new NoWriteError('Bill changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Bill preflight failed; no write performed');}
 if(deleting){const response=await write.del('/bills/'+a.id);if(!response.meta?.deletedRecords?.bills?.includes(a.id))throw Error('Native deletion not confirmed');
 try{await read.get('/bills/'+a.id);throw Error('Deleted bill still readable');}catch(e){if(!(e instanceof Error)||!/^Billy API GET \/bills\/[^ ]+ failed with 404:/.test(e.message))throw e;}
 for(const fileId of new Set<string>(before.attachments.map((x:any)=>x.fileId))){const {file}=await read.get('/files/'+id.parse(fileId));if(file?.id!==fileId)throw Error('Source file missing after bill deletion');}
 return{deleted:true,billId:a.id,sourceFilesDeleted:false,sourceFileMetadataVerified:true,before,reasoning:a.reasoning};}
 let billId=a.id;
 if(creating){const response=await write.post('/bills',{bill:payload});billId=id.parse(response.bills?.[0]?.id);}else if(Object.keys(payload).length)await write.put('/bills/'+billId,{bill:payload});
 const existingFiles=new Set<string>((before?.attachments??[]).map((a:any)=>a.fileId));
 for(const fileId of new Set(files))if(!existingFiles.has(fileId)){await write.post('/attachments',{attachment:{organizationId:org,ownerReference:'bill:'+billId,fileId}});existingFiles.add(fileId);}
 const after=await billSnapshot(read,org,billId);supported(after.bill);
 for(const [key,value] of Object.entries(payload))if(key!=='lines'&&after.bill[key]!==value)throw Error('Bill readback mismatch: '+key);
 if(lines&&canonical(comparableLines(after.billLines))!==canonical(comparableLines(lines)))throw Error('Bill line readback mismatch');
 if(!lines&&before&&canonical(after.billLines)!==canonical(before.billLines))throw Error('Unrelated bill lines changed');
 if(before){const omit=(b:any)=>Object.fromEntries(Object.entries(b).filter(([k])=>![...Object.keys(payload),'updatedTime',...(lines?['amount','tax','balance','lineDescription','grossAmount']:[])].includes(k)));if(canonical(omit(before.bill))!==canonical(omit(after.bill)))throw Error('Unrelated bill fields changed');}
 if(canonical([...new Set(after.attachments.map(a=>a.fileId))].sort())!==canonical([...existingFiles].sort()))throw Error('Attachment readback mismatch');
 return{...after,description:a.description??null,descriptionStorage:'operation_journal_only',reasoning:a.reasoning,booked:false,paymentPerformed:false};
 }));
 }catch(e){return errorResult(e);}};}
