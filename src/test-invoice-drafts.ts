import {attachmentOnly,updateDocumentAttachments} from './test-document-attachments.js';
import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import {sha256} from './test-files.js';
import {sourceCurrencies,isForeignCurrency} from './test-currency.js';
import {standardVatRates} from './test-vat.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const ordered=(xs:any[])=>[...xs].sort((a,b)=>(a.priority??0)-(b.priority??0)||a.id.localeCompare(b.id));
export const invoiceDraftDescriptions:Record<string,string>={
 create_test_invoice_draft:'Create an unsent test invoice draft with explicit existing test products, revenue accounts and expected native sales VAT codes. Up to five lines/three products/three source attachments; uniform gross or net basis. DKK or EUR/USD/GBP/SEK/NOK with explicit native exchangeRate. Description maps to contactMessage. Due date maps to net payment days and is verified. No booking, payment or sending.',
 update_test_invoice_draft:'Attachment-only input also adds files to journal-proven draft or approved invoices/credit notes without financial edits; exact pending replay can verify a completed attachment write. Update description/due date, replace up to five lines via individual native invoice-line writes or add file links on a journal-proven unsent test invoice draft. Date/contact/currency/rate are immutable. Fresh get_invoice revision required. A partial failure retains the operation lock; never retry with a new ID. No booking or sending.',
 delete_test_invoice_draft:'Delete only a journal-proven unsent test invoice draft with a fresh get_invoice revision. Verify deletion and preservation of attachment-file metadata. Never delete approved invoices or send messages.',
};
export async function invoiceSnapshot(read:BillyClient,org:string,invoiceId:string){
 id.parse(invoiceId);const {organization}=await read.get('/organization');if(organization?.id!==org)throw new NoWriteError('Organization mismatch');
 const {invoice}=await read.get('/invoices/'+invoiceId);if(invoice?.id!==invoiceId||invoice.organizationId!==org)throw new NoWriteError('Unexpected invoice ownership');
 const invoiceLines=ordered(await read.fetchAll('/invoiceLines','invoiceLines',{invoiceId}));
 const attachments=(await read.fetchAll('/attachments','attachments',{ownerReference:'invoice:'+invoiceId})).sort((a,b)=>a.id.localeCompare(b.id));
 if(invoiceLines.some(l=>l.invoiceId!==invoiceId)||attachments.some(a=>a.organizationId!==org||a.ownerReference!=='invoice:'+invoiceId))throw new NoWriteError('Unexpected invoice child ownership');
 const value={invoice,invoiceLines,attachments};const {downloadUrl,...stableInvoice}=invoice;return{...value,revision:await sha256(new TextEncoder().encode(canonical({...value,invoice:stableInvoice})))};
}
export async function invoiceProvenance(db:JournalDB,org:string,record:any,kind:'invoice'|'product'){
 const marker=(kind==='invoice'?/^TEST-([a-f0-9-]{36})$/:/^mcp-test:([a-f0-9-]{36})$/).exec(kind==='invoice'?record.invoiceNo:record.productNo)?.[1];if(!marker)throw new NoWriteError('Expected test '+kind);
 const r=await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(org+':'+marker).first<{fingerprint:string;state:string;result:string}>();
 if(r?.state!=='complete'||!(kind==='invoice'?['create_test_invoice_draft','create_test_credit_note_draft']:['create_test_product']).includes(JSON.parse(r.fingerprint).action)||JSON.parse(r.result)[kind]?.id!==record.id)throw new NoWriteError('Missing '+kind+' provenance');
}
export function netDays(entryDate:string,dueDate:string){z.iso.date().parse(entryDate);z.iso.date().parse(dueDate);return z.number().int().min(0).max(365).parse((Date.parse(dueDate+'T00:00:00Z')-Date.parse(entryDate+'T00:00:00Z'))/86400000);}
function supported(i:any,credit=false){if(i.state!=='draft'||!(credit?['invoice','creditNote']:['invoice']).includes(i.type)||i.sentState!=='unsent'||i.isPaid!==false||(!credit&&i.creditedInvoiceId)||!sourceCurrencies.includes(i.currencyId)||!['incl','excl'].includes(i.taxMode)||typeof i.exchangeRate!=='number'||!Number.isFinite(i.exchangeRate)||i.exchangeRate<=0||i.currencyId==='DKK'&&i.exchangeRate!==1)throw new NoWriteError('Expected unsent unpaid supported-currency invoice draft');}
export async function resolvedInvoiceTax(read:BillyClient,org:string,rulesetId:string,contact:any){
 const {salesTaxRuleset:set}=await read.get('/salesTaxRulesets/'+id.parse(rulesetId));if(set?.id!==rulesetId||set.organizationId!==org)throw new NoWriteError('Unexpected tax ruleset');
 const rules=await read.fetchAll('/salesTaxRules','salesTaxRules',{rulesetId});
 const priorities=new Set<number>();for(const r of rules){if(r.rulesetId!==rulesetId||r.stateId||r.cityId||!Number.isInteger(r.priority)||priorities.has(r.priority)||r.contactType!=null&&!['company','person'].includes(r.contactType))throw new NoWriteError('Unsupported or ambiguous tax rule');priorities.add(r.priority);}
 const groups=new Map<string,string[]>();
 for(const r of [...rules].sort((a,b)=>a.priority-b.priority)){
 if(r.countryId&&r.countryId!==contact.countryId||r.contactType&&r.contactType!==contact.type)continue;
 if(r.countryGroupId){if(!groups.has(r.countryGroupId)){const {countryGroup}=await read.get('/countryGroups/'+id.parse(r.countryGroupId));if(countryGroup?.id!==r.countryGroupId||!Array.isArray(countryGroup.memberCountryIds))throw new NoWriteError('Invalid native country group');groups.set(r.countryGroupId,countryGroup.memberCountryIds);}if(!groups.get(r.countryGroupId)!.includes(contact.countryId))continue;}
 return id.parse(r.taxRateId);
 }
 return id.parse(set.fallbackTaxRateId);
}
function inputLines(ls:any[]){if(!Array.isArray(ls)||!ls.length||ls.length>5)throw new NoWriteError('Supply one to five invoice lines');const modes=new Set(ls.map(l=>l.amountBasis));if(modes.size!==1||![...modes].every(m=>['gross','net'].includes(m)))throw new NoWriteError('Use one explicit gross or net basis for all lines');
 return ls.map((l,i)=>{id.parse(l.accountId);id.parse(l.productId);id.parse(l.taxRateId);z.string().min(1).max(500).parse(l.description);z.number().positive().max(10000).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7).parse(l.quantity);z.number().positive().max(1e6).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-7).parse(l.unitPrice);return{...l,priority:i};});}
export function invoiceDraftHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string){return async(a:any)=>{try{
 if(name==='update_test_invoice_draft'&&attachmentOnly(a))return jsonResult(await updateDocumentAttachments(read,write,db,org,'invoice',a,()=>invoiceSnapshot(read,org,a.id),h=>invoiceProvenance(db,org,h,'invoice')));
 const create=name==='create_test_invoice_draft',remove=name==='delete_test_invoice_draft';if(!invoiceDraftDescriptions[name])throw new NoWriteError('Unknown invoice action');z.string().uuid().parse(a.operationId);z.string().min(1).max(4000).parse(a.reasoning);if(!create){id.parse(a.id);z.string().min(1).parse(a.expectedRevision);}
 if(a.description!==undefined)z.string().min(1).max(4000).parse(a.description);if(a.currencyId!==undefined&&!sourceCurrencies.includes(a.currencyId))throw new NoWriteError('Unsupported currency');
 const supplied=a.lines===undefined?undefined:inputLines(a.lines),attachmentIds=z.array(id).max(3).parse(a.attachmentIds??[]);
 if(!create&&!remove&&!['description','dueDate','lines'].some(k=>a[k]!==undefined)&&!attachmentIds.length)throw new NoWriteError('Supply a supported change');
 const {organization}=await read.get('/organization');if(organization?.id!==org||organization.baseCurrencyId!=='DKK')throw new NoWriteError('Expected DKK test organization');
 return jsonResult(await journalRun(db,org,a.operationId,create?'invoice-create:'+a.operationId:'invoice:'+a.id,{action:name,...a},async()=>{
 let before:any,payload:any={},expected:any[]=[],dueDate:string|undefined;const files:string[]=[];
 try{
 if(!create){before=await invoiceSnapshot(read,org,a.id);supported(before.invoice,remove);await invoiceProvenance(db,org,before.invoice,'invoice');if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_invoice again');}
 if(!remove){
 const current=before?.invoice;if(current)for(const k of ['entryDate','contactId','currencyId','exchangeRate'])if(a[k]!==undefined&&a[k]!==current[k])throw new NoWriteError(k+' is immutable; create a new draft');
 const contactId=create?id.parse(a.contactId):current.contactId;const {contact}=await read.get('/contacts/'+contactId);if(contact?.id!==contactId||contact.organizationId!==org||contact.isArchived||!contact.isCustomer||!contact.contactNo?.startsWith('mcp-test:')||contact.isSalesTaxExempt!==false)throw new NoWriteError('Expected active non-exempt test customer');
 const currencyId=create?a.currencyId:current.currencyId;const exchangeRate=create?(isForeignCurrency(currencyId)?z.number().positive().max(1e6).parse(a.exchangeRate):1):current.exchangeRate;if(currencyId==='DKK'&&a.exchangeRate!==undefined&&a.exchangeRate!==1)throw new NoWriteError('DKK rate must be 1');
 const entryDate=create?a.entryDate:current.entryDate;dueDate=a.dueDate??current?.dueDate;const days=netDays(entryDate,dueDate!);
 if(current&&before.invoiceLines.some((l:any)=>l.discountMode||l.discountValue))throw new NoWriteError('Discounted invoice edits are not supported');
 const rawLines=supplied??before?.invoiceLines;if(!rawLines?.length||rawLines.length>5||new Set(rawLines.map((l:any)=>l.productId)).size>3)throw new NoWriteError('At most five lines and three products');
 const products=new Map<string,any>(),taxByRuleset=new Map<string,string>();
 for(const l of rawLines){
 if(!products.has(l.productId)){const {product}=await read.get('/products/'+id.parse(l.productId));if(product?.id!==l.productId||product.organizationId!==org||product.isArchived||product.isInInventory)throw new NoWriteError('Expected active non-inventory test product');await invoiceProvenance(db,org,product,'product');products.set(l.productId,product);}
 const p=products.get(l.productId);if(supplied&&p.accountId!==l.accountId)throw new NoWriteError('Requested revenue account differs from product');
 if(!taxByRuleset.has(p.salesTaxRulesetId))taxByRuleset.set(p.salesTaxRulesetId,await resolvedInvoiceTax(read,org,p.salesTaxRulesetId,contact));const taxRateId=taxByRuleset.get(p.salesTaxRulesetId);
 if(l.taxRateId!==taxRateId)throw new NoWriteError('Requested/native line VAT differs from current product/contact rules');
 expected.push({productId:l.productId,accountId:p.accountId,description:l.description,quantity:l.quantity,unitPrice:l.unitPrice,taxRateId,priority:expected.length});
 }
 const rates=await standardVatRates(read,org,expected.map(l=>({...l,currencyId,side:'credit'})));if(rates.some(r=>!r.appliesToSales))throw new NoWriteError('Sales VAT required');
 for(const accountId of new Set<string>(expected.map(l=>l.accountId))){const {account}=await read.get('/accounts/'+id.parse(accountId));if(account?.id!==accountId||account.organizationId!==org||account.isArchived||account.isBankAccount||account.currencyId!=='DKK'||account.natureId!=='revenue')throw new NoWriteError('Expected active DKK revenue account');}
 const mode=supplied?(supplied[0].amountBasis==='gross'?'incl':'excl'):current?.taxMode;
 if(create)payload={organizationId:org,type:'invoice',state:'draft',sentState:'unsent',invoiceNo:'TEST-'+a.operationId,contactId,entryDate,currencyId,exchangeRate,taxMode:mode,paymentTermsMode:'net',paymentTermsDays:days,contactMessage:a.description};
 else{if(a.description!==undefined)payload.contactMessage=a.description;if(a.dueDate!==undefined){payload.paymentTermsMode='net';payload.paymentTermsDays=days;}if(supplied)payload.taxMode=mode;}
 for(const attId of new Set<string>(attachmentIds)){const {attachment}=await read.get('/attachments/'+attId);if(attachment?.id!==attId||attachment.organizationId!==org)throw new NoWriteError('Unexpected attachment ownership');files.push(id.parse(attachment.fileId));}
 }
 if(before&&(await invoiceSnapshot(read,org,a.id)).revision!==before.revision)throw new NoWriteError('Invoice changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Invoice preflight failed; no write performed');}
 if(remove){const r=await write.del('/invoices/'+a.id);if(!r.meta?.deletedRecords?.invoices?.includes(a.id))throw Error('Invoice deletion not confirmed');try{await read.get('/invoices/'+a.id);throw Error('Deleted invoice remains');}catch(e){if(!(e instanceof Error)||!/^Billy API GET \/invoices\/[^ ]+ failed with 404:/.test(e.message))throw e;}
 for(const fileId of new Set<string>(before.attachments.map((x:any)=>x.fileId))){const {file}=await read.get('/files/'+id.parse(fileId));if(file?.id!==fileId)throw Error('Source file missing');}return{deleted:true,invoiceId:a.id,sourceFilesPreserved:true,before,reasoning:a.reasoning};}
 const native=(l:any)=>({productId:l.productId,description:l.description,quantity:l.quantity,unitPrice:l.unitPrice,priority:l.priority});let invoiceId=a.id;
 if(create){const r=await write.post('/invoices',{invoice:{...payload,lines:expected.map(native)}});invoiceId=id.parse(r.invoices?.[0]?.id);}else{
 if(Object.keys(payload).length)await write.put('/invoices/'+a.id,{invoice:payload});
 if(supplied){for(let i=0;i<Math.max(expected.length,before.invoiceLines.length);i++){const old=before.invoiceLines[i],line=expected[i];if(old&&line)await write.put('/invoiceLines/'+id.parse(old.id),{invoiceLine:native(line)});else if(line)await write.post('/invoiceLines',{invoiceLine:{invoiceId:a.id,...native(line)}});else await write.del('/invoiceLines/'+id.parse(old.id));}}
 }
 const retained=new Set<string>((before?.attachments??[]).map((x:any)=>x.fileId));for(const fileId of new Set(files))if(!retained.has(fileId)){await write.post('/attachments',{attachment:{organizationId:org,ownerReference:'invoice:'+invoiceId,fileId}});retained.add(fileId);}
 const after=await invoiceSnapshot(read,org,invoiceId);supported(after.invoice);
 for(const [k,v] of Object.entries(payload))if(after.invoice[k]!==v)throw Error('Invoice readback mismatch: '+k);if(after.invoice.dueDate!==dueDate)throw Error('Native due date differs from requested date');
 const shape=(ls:any[])=>ls.map(l=>({productId:l.productId,description:l.description,quantity:l.quantity,unitPrice:l.unitPrice,taxRateId:l.taxRateId,priority:l.priority}));if(canonical(shape(after.invoiceLines))!==canonical(shape(expected)))throw Error('Invoice line/VAT readback mismatch');
 if(before){const ignore=[...Object.keys(payload),'updatedTime','downloadUrl',...(a.dueDate?['dueDate']:[]),...(supplied?['amount','tax','grossAmount','balance','lineDescription']:[])];const omit=(v:any)=>Object.fromEntries(Object.entries(v).filter(([k])=>!ignore.includes(k)));if(canonical(omit(before.invoice))!==canonical(omit(after.invoice)))throw Error('Unrelated invoice fields changed');}
 if(canonical([...new Set(after.attachments.map(x=>x.fileId))].sort())!==canonical([...retained].sort()))throw Error('Attachment readback mismatch');
 return{...after,reasoning:a.reasoning,booked:false,sent:false,paymentPerformed:false};
 }));
 }catch(e){return errorResult(e);}};}
