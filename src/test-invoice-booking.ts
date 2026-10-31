import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import {invoiceSnapshot,invoiceProvenance,resolvedInvoiceTax} from './test-invoice-drafts.js';
import {standardVatRates} from './test-vat.js';
import {assertBookingDateOpen,assertVatPeriodsOpen} from './test-period-guard.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const cent=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>1e-7)throw Error('Invalid native amount');return Math.round(n*100);};
export const invoiceBookingDescriptions:Record<string,string>={
 book_test_invoice_draft:'Book a journal-proven unsent DKK test invoice or full linked credit note with one ordinary 25% sales-VAT line. Verifies native header totals, fiscal/VAT locks, product/account/rule, receivable/tax postings and original evidence. No delivery or bank payment. Exact pending-operation replay may finish the journal only after proving the existing booking; never repeats the native write.',
 create_test_credit_note_draft:'Create one full linked DKK credit-note draft against a journal-proven approved unsent invoice with one ordinary sales-VAT line and no prior credits/payments. Supplied lines must match the complete original amounts/products/tax/basis. Keeps the original unchanged; book separately. No delivery or payment.',
};
function stableHeader(i:any){const {state,approvedTime,downloadUrl,balance,isPaid,...rest}=i;return rest;}
function unchanged(before:any,after:any){if(canonical(stableHeader(before.invoice))!==canonical(stableHeader(after.invoice))||canonical(before.invoiceLines)!==canonical(after.invoiceLines)||canonical(before.attachments)!==canonical(after.attachments))throw Error('Invoice content changed during booking');}
async function configuration(read:BillyClient,db:JournalDB,org:string,s:any){
 const i=s.invoice;if(i.currencyId!=='DKK'||i.exchangeRate!==1||i.sentState!=='unsent'||!['invoice','creditNote'].includes(i.type)||s.invoiceLines.length!==1||i.type==='invoice'&&i.paymentTermsMode!=='net')throw new NoWriteError('Booking phase supports one unsent DKK invoice/credit line');
 await invoiceProvenance(db,org,i,'invoice');const l=s.invoiceLines[0];if(l.discountMode||l.discountValue||!['incl','excl'].includes(i.taxMode))throw new NoWriteError('Discounts/unknown basis unsupported');
 const {product}=await read.get('/products/'+id.parse(l.productId));if(product?.organizationId!==org||product.isArchived||product.isInInventory)throw new NoWriteError('Invalid product');await invoiceProvenance(db,org,product,'product');
 const {contact}=await read.get('/contacts/'+id.parse(i.contactId));if(contact?.organizationId!==org||contact.isArchived||contact.isSalesTaxExempt!==false)throw new NoWriteError('Invalid contact');if(await resolvedInvoiceTax(read,org,product.salesTaxRulesetId,contact)!==l.taxRateId)throw new NoWriteError('Current VAT rule changed');
 const rates=await standardVatRates(read,org,[{...l,currencyId:'DKK'}]);if(rates.length!==1||rates[0].predefinedTag!=='s_dk_25')throw new NoWriteError('Booking phase requires ordinary Danish 25% sales VAT');
 const accounts=await read.fetchAll('/accounts','accounts',{organizationId:org});if(accounts.some(a=>a.organizationId!==org))throw new NoWriteError('Account organization mismatch');
 const receivables=accounts.filter(a=>a.systemRole==='accountsReceivable'&&!a.isArchived&&a.currencyId==='DKK'&&!a.isBankAccount);const revenue=accounts.find(a=>a.id===product.accountId);if(receivables.length!==1||!revenue||revenue.isArchived||revenue.natureId!=='revenue'||revenue.currencyId!=='DKK')throw new NoWriteError('Invalid receivable/revenue configuration');
 const raw=l.quantity*l.unitPrice;const gross=i.taxMode==='incl'?Math.round(raw*100):Math.round(raw*100)+Math.round(raw*25);const tax=i.taxMode==='incl'?Math.round(gross/5):Math.round(raw*25),net=gross-tax;
 if(cent(i.grossAmount)!==gross||cent(i.amount)!==net||cent(i.tax)!==tax)throw new NoWriteError('Native invoice totals differ from explicit line');
 return{revenueId:revenue.id,receivableId:receivables[0].id,taxAccountId:rates[0].deductionComponents[0].accountId,taxRateId:l.taxRateId,gross,tax,net};
}
export async function invoiceLedger(read:BillyClient,org:string,s:any,c:any){
 const ts=await read.fetchAll('/transactions','transactions',{organizationId:org});const tx=ts.filter(t=>t.originatorReference==='invoice:'+s.invoice.id&&!t.isVoided&&!t.isVoid);if(tx.length!==1||tx[0].organizationId!==org)throw Error('Expected one native invoice transaction');
 const postings=await read.fetchAll('/postings','postings',{transactionId:tx[0].id,organizationId:org});
 const credit=s.invoice.type==='creditNote',expect=new Map([[c.receivableId+':'+(credit?'credit':'debit'),c.gross],[c.revenueId+':'+(credit?'debit':'credit'),c.net],[c.taxAccountId+':'+(credit?'debit':'credit'),c.tax]]),actual=new Map<string,number>();
 for(const p of postings){if(p.organizationId!==org||p.transactionId!==tx[0].id||p.entryDate!==s.invoice.entryDate||p.isVoided||p.currencyId!=='DKK'||p.exchangeRate!=null&&p.exchangeRate!==1||p.baseAmount!=null&&cent(p.baseAmount)!==cent(p.amount)||p.isBankMatched)throw Error('Unexpected native invoice posting');if(p.accountId===c.taxAccountId&&!p.salesTaxReturnId)throw Error('Missing native VAT period');if(p.taxRateId!=null&&p.taxRateId!==c.taxRateId)throw Error('Unexpected VAT code');const key=p.accountId+':'+p.side;actual.set(key,(actual.get(key)??0)+cent(p.amount));}
 if(canonical([...expect].sort())!==canonical([...actual].sort()))throw Error('Native invoice ledger differs from expected receivable/net/VAT amounts');if(c.creditSourceId){if(s.invoice.balance!==0||s.invoice.isPaid!==true)throw Error('Credit note has remaining balance');const {invoice:source}=await read.get('/invoices/'+c.creditSourceId);if(source?.id!==c.creditSourceId||source.organizationId!==org||source.balance!==0||source.isPaid!==true)throw Error('Original invoice was not fully offset by native credit');}
 return{transaction:tx[0],postings};
}
export function invoiceBookingHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string){return async(a:any)=>{try{
 z.string().uuid().parse(a.operationId);z.string().min(1).parse(a.expectedRevision);z.string().min(1).max(4000).parse(a.reasoning);const book=name==='book_test_invoice_draft';if(!invoiceBookingDescriptions[name])throw new NoWriteError('Unknown action');id.parse(book?a.id:a.invoiceId);
 const {organization}=await read.get('/organization');if(organization?.id!==org)throw new NoWriteError('Organization mismatch');
 const fingerprint=canonical({action:name,...a}),target=org+':invoice:'+(book?a.id:a.invoiceId),journalId=org+':'+a.operationId;
 const pending=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<any>();
 if(book&&pending?.state==='pending'){
 if(pending.fingerprint!==fingerprint||pending.target!==target)throw Error('Pending booking input mismatch');const saved=JSON.parse(pending.result??'null');if(saved?.stage!=='before_invoice_booking'||saved.before.revision!==a.expectedRevision)throw Error('No recoverable invoice evidence');
 const after=await invoiceSnapshot(read,org,a.id);if(after.invoice.state!=='approved')throw Error('Booking not proven approved; no automatic retry');unchanged(saved.before,after);const ledger=await invoiceLedger(read,org,after,saved.configuration);if((await invoiceSnapshot(read,org,a.id)).revision!==after.revision)throw Error('Invoice changed during recovery');
 const result={...after,...ledger,reasoning:a.reasoning,recovery:{nativeWrites:0}};const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,target).run();if(!r.success||r.meta.changes!==1)throw Error('Journal changed during recovery');return jsonResult({operationId:a.operationId,replayed:false,result});
 }
 return jsonResult(await journalRun(db,org,a.operationId,'invoice:'+(book?a.id:a.invoiceId),{action:name,...a},async()=>{
 let before:any,c:any,payload:any;
 try{
 before=await invoiceSnapshot(read,org,book?a.id:a.invoiceId);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_invoice again');c=await configuration(read,db,org,before);
 if(book){if(before.invoice.state!=='draft')throw new NoWriteError('Expected draft');
 if(before.invoice.type==='creditNote'){
 const source=await invoiceSnapshot(read,org,id.parse(before.invoice.creditedInvoiceId));await invoiceProvenance(db,org,source.invoice,'invoice');
 if(source.invoice.state!=='approved'||source.invoice.type!=='invoice'||source.invoice.isPaid!==false||cent(source.invoice.balance)!==c.gross||source.invoice.currencyId!=='DKK'||source.invoice.exchangeRate!==1||source.invoice.contactId!==before.invoice.contactId||source.invoice.sentState!=='unsent'||source.invoice.taxMode!==before.invoice.taxMode||source.invoiceLines.length!==1)throw new NoWriteError('Original invoice changed or was paid before credit booking');
 for(const key of ['productId','quantity','unitPrice','taxRateId'])if(source.invoiceLines[0][key]!==before.invoiceLines[0][key])throw new NoWriteError('Credit differs from original');
 const credits=await read.fetchAll('/invoices','invoices',{organizationId:org,creditedInvoiceId:source.invoice.id});if(credits.some(x=>x.creditedInvoiceId===source.invoice.id&&x.id!==before.invoice.id))throw new NoWriteError('Another credit note exists');
 if((await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'invoice:'+source.invoice.id})).length)throw new NoWriteError('Original invoice has payment allocations');
 c.creditSourceId=source.invoice.id;
 }
 assertBookingDateOpen(organization,before.invoice.entryDate);assertVatPeriodsOpen(await read.fetchAll('/salesTaxReturns','salesTaxReturns',{organizationId:org},1000),org,before.invoice.entryDate);}
 else{
 if(before.invoice.state!=='approved'||before.invoice.type!=='invoice'||cent(before.invoice.balance)!==c.gross||before.invoice.isPaid!==false)throw new NoWriteError('Expected fully unpaid approved original invoice');
 const credits=await read.fetchAll('/invoices','invoices',{organizationId:org,creditedInvoiceId:a.invoiceId});if(credits.some(i=>i.creditedInvoiceId===a.invoiceId))throw new NoWriteError('Existing credit note; inspect before another credit');
 const modifiers=await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'invoice:'+a.invoiceId});if(modifiers.length)throw new NoWriteError('Existing payment allocation');
 if(a.lines?.length!==1)throw new NoWriteError('Full original single line required');const supplied=a.lines[0],l=before.invoiceLines[0];for(const k of ['productId','quantity','unitPrice','taxRateId'])if(supplied[k]!==l[k])throw new NoWriteError('Credit must match full original line');if(supplied.accountId!==c.revenueId||supplied.amountBasis!==(before.invoice.taxMode==='incl'?'gross':'net'))throw new NoWriteError('Credit account/basis mismatch');z.iso.date().parse(a.entryDate);if(a.entryDate<before.invoice.entryDate)throw new NoWriteError('Credit date precedes original');assertBookingDateOpen(organization,a.entryDate);
 payload={organizationId:org,type:'creditNote',state:'draft',sentState:'unsent',invoiceNo:'TEST-'+a.operationId,creditedInvoiceId:a.invoiceId,contactId:before.invoice.contactId,entryDate:a.entryDate,currencyId:'DKK',exchangeRate:1,taxMode:before.invoice.taxMode,contactMessage:a.description,lines:[{productId:l.productId,quantity:l.quantity,unitPrice:l.unitPrice,description:supplied.description,priority:0}]};
 }
 if((await invoiceSnapshot(read,org,before.invoice.id)).revision!==before.revision)throw new NoWriteError('Invoice changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Invoice posting preflight failed; no write performed');}
 if(book){
 const {downloadUrl,...header}=before.invoice;const evidence={stage:'before_invoice_booking',before:{...before,invoice:header},configuration:c};const stored=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify(evidence),journalId).run();if(!stored.success||stored.meta.changes!==1)throw new NoWriteError('Cannot save recovery evidence; no native write');
 await write.put('/invoices/'+a.id,{invoice:{state:'approved'}});const after=await invoiceSnapshot(read,org,a.id);if(after.invoice.state!=='approved')throw Error('Invoice not approved');unchanged(before,after);const ledger=await invoiceLedger(read,org,after,c);return{...after,...ledger,reasoning:a.reasoning,sent:false,paymentPerformed:false};
 }
 let response:any;try{response=await write.post('/invoices',{invoice:payload});}catch(e){
 // A definite validation rejection may release the reservation only after proving no invoice was created and the original is unchanged.
 const message=e instanceof Error?e.message:'';if(!message.startsWith('Billy API POST /invoices failed with 400:'))throw e;
 const candidates=await read.fetchAll('/invoices','invoices',{organizationId:org,invoiceNo:payload.invoiceNo});const credits=await read.fetchAll('/invoices','invoices',{organizationId:org,creditedInvoiceId:a.invoiceId});
 if(candidates.some(x=>x.invoiceNo===payload.invoiceNo)||credits.some(x=>x.creditedInvoiceId===a.invoiceId)||(await invoiceSnapshot(read,org,a.invoiceId)).revision!==before.revision)throw e;
 throw new NoWriteError(message);
 }const invoiceId=id.parse(response.invoices?.[0]?.id);for(const fileId of new Set<string>(before.attachments.map((x:any)=>x.fileId)))await write.post('/attachments',{attachment:{organizationId:org,ownerReference:'invoice:'+invoiceId,fileId}});
 const after=await invoiceSnapshot(read,org,invoiceId);for(const [key,value] of Object.entries(payload))if(key!=='lines'&&after.invoice[key]!==value)throw Error('Credit readback mismatch: '+key);if(after.invoiceLines.length!==1||after.invoiceLines[0].taxRateId!==c.taxRateId||cent(after.invoice.grossAmount)!==c.gross||cent(after.invoice.amount)!==c.net||cent(after.invoice.tax)!==c.tax)throw Error('Credit line/totals mismatch');for(const [key,value]of Object.entries(payload.lines[0]))if(after.invoiceLines[0][key]!==value)throw Error('Credit line readback mismatch');if(canonical([...new Set(after.attachments.map((x:any)=>x.fileId))].sort())!==canonical([...new Set(before.attachments.map((x:any)=>x.fileId))].sort()))throw Error('Credit attachment mismatch');if((await invoiceSnapshot(read,org,a.invoiceId)).revision!==before.revision)throw Error('Original changed during credit proposal');
 return{...after,sourceInvoiceId:a.invoiceId,reasoning:a.reasoning,booked:false,sent:false};
 }));
 }catch(e){return errorResult(e);}};}
