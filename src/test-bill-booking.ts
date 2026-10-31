import {sourceCurrencies} from './test-currency.js';
import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import {billSnapshot,billProvenance} from './test-bill-drafts.js';
import {standardVatRates} from './test-vat.js';
import {assertBookingDateOpen,assertVatPeriodsOpen} from './test-period-guard.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const cent=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>1e-7)throw Error('Invalid native amount');return Math.round(n*100);};
export const billBookingDescriptions:Record<string,string>={
 book_test_bill_draft:'Book a journal-proven DKK/EUR/USD/GBP/SEK/NOK test bill with explicit preserved DKK-per-source rate or full linked credit note with up to 20 ordinary 25% purchase-VAT lines (multiline currently DKK). Verifies native header totals, fiscal/VAT locks, supplier/account/tax code, payable/tax postings and original evidence. No delivery or bank payment. Exact pending-operation replay may finish the journal only after proving the existing booking; never repeats the native write.',
 create_test_bill_credit_note_draft:'Create one full linked source-currency credit-note draft against a journal-proven approved bill with up to 20 ordinary purchase-VAT lines (multiline currently DKK) and no prior credits/payments. Supplied lines must match the complete original amounts/accounts/tax/basis. Keeps the original unchanged; book separately. No delivery or payment.',
};
function lineIdentity(lines:any[],description=false){return canonical(lines.map(l=>canonical({accountId:l.accountId,amount:l.amount,taxRateId:l.taxRateId,...(description?{description:l.description}:{})})).sort());}
function stableHeader(i:any){const {state,approvedTime,balance,isPaid,...rest}=i;return rest;}
function unchanged(before:any,after:any){if(canonical(stableHeader(before.bill))!==canonical(stableHeader(after.bill))||canonical(before.billLines)!==canonical(after.billLines)||canonical(before.attachments)!==canonical(after.attachments))throw Error('Bill content changed during booking');}
async function configuration(read:BillyClient,db:JournalDB,org:string,s:any){
 const i=s.bill;if(!sourceCurrencies.includes(i.currencyId)||typeof i.exchangeRate!=='number'||!Number.isFinite(i.exchangeRate)||i.exchangeRate<=0||i.currencyId==='DKK'&&i.exchangeRate!==1||!['bill','creditNote'].includes(i.type)||(s.billLines.length<1||s.billLines.length>20||s.billLines.length>1&&i.currencyId!=='DKK')||s.attachments.length>3||i.accountingBasis!=null&&i.accountingBasis!=='accrual'||i.taxMode!=='incl'||i.paymentAccountId||i.paymentDate||i.isBare===true)throw new NoWriteError('Booking supports unpaid supported-currency gross bill/credit lines; multiple lines require DKK without cash payment');
 await billProvenance(db,org,i);const l=s.billLines[0];if(s.billLines.some((l:any)=>l.productId!=null||l.quantity!=null&&l.quantity!==1))throw new NoWriteError('Unsupported bill product/quantity');
 const {contact}=await read.get('/contacts/'+id.parse(i.contactId));if(contact?.id!==i.contactId||contact.organizationId!==org||contact.isArchived||contact.isSupplier!==true||!contact.contactNo?.startsWith('mcp-test:'))throw new NoWriteError('Expected active test supplier');
 const rates=await standardVatRates(read,org,s.billLines.map((l:any)=>({...l,currencyId:'DKK',side:'debit'})));if(rates.length!==1||rates[0].predefinedTag!=='p_dk_25')throw new NoWriteError('Booking requires ordinary Danish 25% purchase VAT');
 const accounts=await read.fetchAll('/accounts','accounts',{organizationId:org});if(accounts.some(a=>a.organizationId!==org))throw new NoWriteError('Account organization mismatch');
 const payables=accounts.filter(a=>a.systemRole==='accountsPayable'&&!a.isArchived&&a.currencyId==='DKK'&&!a.isBankAccount);const expenses=s.billLines.map((l:any)=>accounts.find(a=>a.id===l.accountId));if(payables.length!==1||expenses.some((expense:any)=>!expense||expense.isArchived||expense.isBankAccount||expense.natureId!=='expense'||expense.currencyId!=='DKK'))throw new NoWriteError('Invalid payable/expense configuration');
 const components=s.billLines.map((l:any)=>{const gross=cent(l.amount),tax=Math.round(gross/5),net=gross-tax;if(gross<=0||l.tax!=null&&cent(l.tax)!==tax)throw new NoWriteError('Invalid positive gross bill line or native tax');return{expenseId:l.accountId,gross,net,tax};});
 const gross=components.reduce((n:number,l:any)=>n+l.gross,0),net=components.reduce((n:number,l:any)=>n+l.net,0),tax=components.reduce((n:number,l:any)=>n+l.tax,0);
 if(cent(i.grossAmount)!==gross||cent(i.amount)!==net||cent(i.tax)!==tax)throw new NoWriteError('Native bill totals differ from explicit lines');
 return{expenseId:l.accountId,expenses:components.map((l:any)=>({accountId:l.expenseId,amount:Math.round(l.net*i.exchangeRate)})),payableId:payables[0].id,taxAccountId:rates[0].deductionComponents[0].accountId,taxRateId:l.taxRateId,sourceGross:gross,sourceNet:net,sourceTax:tax,gross:Math.round(net*i.exchangeRate)+Math.round(tax*i.exchangeRate),net:Math.round(net*i.exchangeRate),tax:Math.round(tax*i.exchangeRate)};
}
export async function billLedger(read:BillyClient,org:string,s:any,c:any){
 const ts=await read.fetchAll('/transactions','transactions',{organizationId:org});const tx=ts.filter(t=>t.originatorReference==='bill:'+s.bill.id&&!t.isVoided&&!t.isVoid);if(tx.length!==1||tx[0].organizationId!==org)throw Error('Expected one native bill transaction');
 const postings=await read.fetchAll('/postings','postings',{transactionId:tx[0].id,organizationId:org});
 const credit=s.bill.type==='creditNote',expect=new Map([[c.payableId+':'+(credit?'debit':'credit'),c.gross],[c.taxAccountId+':'+(credit?'credit':'debit'),c.tax]]),actual=new Map<string,number>();
 for(const e of c.expenses??[{accountId:c.expenseId,amount:c.net}]){const key=e.accountId+':'+(credit?'credit':'debit');expect.set(key,(expect.get(key)??0)+e.amount);}
 for(const p of postings){if(p.organizationId!==org||p.transactionId!==tx[0].id||p.entryDate!==s.bill.entryDate||p.isVoided||p.currencyId!=='DKK'||p.exchangeRate!=null&&p.exchangeRate!==1||p.baseAmount!=null&&cent(p.baseAmount)!==cent(p.amount)||p.isBankMatched)throw Error('Unexpected native bill posting');if(p.accountId===c.taxAccountId&&!p.salesTaxReturnId)throw Error('Missing native VAT period');if(p.taxRateId!=null&&p.taxRateId!==c.taxRateId)throw Error('Unexpected VAT code');const key=p.accountId+':'+p.side;actual.set(key,(actual.get(key)??0)+cent(p.amount));}
 if(canonical([...expect].sort())!==canonical([...actual].sort()))throw Error('Native bill ledger differs from expected payable/net/VAT amounts');if(c.creditSourceId){if(s.bill.balance!==0||s.bill.isPaid!==true)throw Error('Credit note has remaining balance');const {bill:source}=await read.get('/bills/'+c.creditSourceId);if(source?.id!==c.creditSourceId||source.organizationId!==org||source.balance!==0||source.isPaid!==true)throw Error('Original bill was not fully offset by native credit');}
 return{transaction:tx[0],postings};
}
export function billBookingHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string){return async(a:any)=>{try{
 z.string().uuid().parse(a.operationId);z.string().min(1).parse(a.expectedRevision);z.string().min(1).max(4000).parse(a.reasoning);const book=name==='book_test_bill_draft';if(!billBookingDescriptions[name])throw new NoWriteError('Unknown action');id.parse(book?a.id:a.billId);
 const {organization}=await read.get('/organization');if(organization?.id!==org||organization.baseCurrencyId!=='DKK')throw new NoWriteError('Organization mismatch');
 const fingerprint=canonical({action:name,...a}),target=org+':bill:'+(book?a.id:a.billId),journalId=org+':'+a.operationId;
 const pending=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<any>();
 if(book&&pending?.state==='pending'){
 if(pending.fingerprint!==fingerprint||pending.target!==target)throw Error('Pending booking input mismatch');const saved=JSON.parse(pending.result??'null');if(saved?.stage!=='before_bill_booking'||saved.before.revision!==a.expectedRevision)throw Error('No recoverable bill evidence');
 const after=await billSnapshot(read,org,a.id);if(after.bill.state!=='approved')throw Error('Booking not proven approved; no automatic retry');unchanged(saved.before,after);const ledger=await billLedger(read,org,after,saved.configuration);if((await billSnapshot(read,org,a.id)).revision!==after.revision)throw Error('Bill changed during recovery');
 const result={...after,...ledger,reasoning:a.reasoning,recovery:{nativeWrites:0}};const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,target).run();if(!r.success||r.meta.changes!==1)throw Error('Journal changed during recovery');return jsonResult({operationId:a.operationId,replayed:false,result});
 }
 return jsonResult(await journalRun(db,org,a.operationId,'bill:'+(book?a.id:a.billId),{action:name,...a},async()=>{
 let before:any,c:any,payload:any;
 try{
 before=await billSnapshot(read,org,book?a.id:a.billId);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_bill again');c=await configuration(read,db,org,before);
 if(book){if(before.bill.state!=='draft'||before.bill.isPaid!==false||cent(before.bill.balance)!==c.sourceGross)throw new NoWriteError('Expected draft');
 if(before.bill.type==='creditNote'){
 const source=await billSnapshot(read,org,id.parse(before.bill.creditedBillId));await billProvenance(db,org,source.bill);
 if(source.bill.state!=='approved'||source.bill.type!=='bill'||source.bill.isPaid!==false||cent(source.bill.balance)!==c.sourceGross||source.bill.currencyId!==before.bill.currencyId||source.bill.exchangeRate!==before.bill.exchangeRate||source.bill.contactId!==before.bill.contactId||source.bill.paymentAccountId||source.bill.paymentDate||source.bill.taxMode!==before.bill.taxMode||source.billLines.length!==before.billLines.length)throw new NoWriteError('Original bill changed or was paid before credit booking');
 if(lineIdentity(source.billLines)!==lineIdentity(before.billLines))throw new NoWriteError('Credit differs from original');
 const credits=await read.fetchAll('/bills','bills',{organizationId:org,creditedBillId:source.bill.id});if(credits.some(x=>x.creditedBillId===source.bill.id&&x.id!==before.bill.id))throw new NoWriteError('Another credit note exists');
 if((await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'bill:'+source.bill.id})).some(x=>x.isVoided!==true))throw new NoWriteError('Original bill has payment allocations');
 c.creditSourceId=source.bill.id;
 }
 assertBookingDateOpen(organization,before.bill.entryDate);assertVatPeriodsOpen(await read.fetchAll('/salesTaxReturns','salesTaxReturns',{organizationId:org},1000),org,before.bill.entryDate);}
 else{
 if(before.bill.state!=='approved'||before.bill.type!=='bill'||cent(before.bill.balance)!==c.sourceGross||before.bill.isPaid!==false)throw new NoWriteError('Expected fully unpaid approved original bill');
 const credits=await read.fetchAll('/bills','bills',{organizationId:org,creditedBillId:a.billId});if(credits.some(i=>i.creditedBillId===a.billId))throw new NoWriteError('Existing credit note; inspect before another credit');
 const modifiers=await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'bill:'+a.billId});if(modifiers.some(x=>x.isVoided!==true))throw new NoWriteError('Existing payment allocation');
 if(a.lines?.length!==before.billLines.length)throw new NoWriteError('All original lines required');
 const proposed=a.lines.map((supplied:any)=>{if(supplied.productId!==undefined||supplied.quantity!==1||supplied.amountBasis!=='gross')throw new NoWriteError('Credit must match full original gross lines');z.string().min(1).max(500).parse(supplied.description);return{accountId:supplied.accountId,amount:supplied.unitPrice,taxRateId:supplied.taxRateId,description:supplied.description};});
 if(lineIdentity(proposed)!==lineIdentity(before.billLines))throw new NoWriteError('Credit must match full original gross lines');z.iso.date().parse(a.entryDate);if(a.entryDate<before.bill.entryDate)throw new NoWriteError('Credit date precedes original');assertBookingDateOpen(organization,a.entryDate);
 payload={organizationId:org,type:'creditNote',state:'draft',voucherNo:'TEST-'+a.operationId,creditedBillId:a.billId,contactId:before.bill.contactId,entryDate:a.entryDate,currencyId:before.bill.currencyId,exchangeRate:before.bill.exchangeRate,taxMode:'incl',lines:proposed};
 }
 if((await billSnapshot(read,org,before.bill.id)).revision!==before.revision)throw new NoWriteError('Bill changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Bill posting preflight failed; no write performed');}
 if(book){
 const header=before.bill;const evidence={stage:'before_bill_booking',before:{...before,bill:header},configuration:c};const stored=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify(evidence),journalId).run();if(!stored.success||stored.meta.changes!==1)throw new NoWriteError('Cannot save recovery evidence; no native write');
 await write.put('/bills/'+a.id,{bill:{state:'approved',exchangeRate:before.bill.exchangeRate}});const after=await billSnapshot(read,org,a.id);if(after.bill.state!=='approved')throw Error('Bill not approved');unchanged(before,after);const ledger=await billLedger(read,org,after,c);return{...after,...ledger,reasoning:a.reasoning,paymentPerformed:false};
 }
 const response=await write.post('/bills',{bill:payload});const billId=id.parse(response.bills?.[0]?.id);for(const fileId of new Set<string>(before.attachments.map((x:any)=>x.fileId)))await write.post('/attachments',{attachment:{organizationId:org,ownerReference:'bill:'+billId,fileId}});
 const after=await billSnapshot(read,org,billId);for(const [key,value] of Object.entries(payload))if(key!=='lines'&&after.bill[key]!==value)throw Error('Credit readback mismatch: '+key);if(lineIdentity(after.billLines)!==lineIdentity(payload.lines)||cent(after.bill.grossAmount)!==c.sourceGross||cent(after.bill.amount)!==c.sourceNet||cent(after.bill.tax)!==c.sourceTax)throw Error('Credit line/totals mismatch');if(lineIdentity(after.billLines,true)!==lineIdentity(payload.lines,true))throw Error('Credit line readback mismatch');if(canonical([...new Set(after.attachments.map((x:any)=>x.fileId))].sort())!==canonical([...new Set(before.attachments.map((x:any)=>x.fileId))].sort()))throw Error('Credit attachment mismatch');if((await billSnapshot(read,org,a.billId)).revision!==before.revision)throw Error('Original changed during credit proposal');
 return{...after,sourceBillId:a.billId,reasoning:a.reasoning,booked:false};
 }));
 }catch(e){return errorResult(e);}};}
