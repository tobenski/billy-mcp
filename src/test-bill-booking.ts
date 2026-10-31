import {documentConfigurationRead,priorCreditFinancialSnapshot} from './test-document-configuration.js';
import {verifyBillVat} from './test-bill-vat.js';
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
 book_test_bill_draft:'Book a journal-proven DKK/EUR/USD/GBP/SEK/NOK test bill with explicit preserved DKK-per-source rate or linked credit note with up to 20 supported purchase-VAT lines; mixed codes supported in DKK, foreign lines require ordinary 25% VAT. Verifies native header totals, fiscal/VAT locks, supplier/account/tax code, payable/tax postings and original evidence. No delivery or bank payment. Exact pending-operation replay may finish the journal only after proving the existing booking; never repeats the native write.',
 create_test_bill_credit_note_draft:'Create partial or full linked DKK credit-note drafts (up to four sequential credits). Single-line foreign bills also allow sequential credits only when source-currency and converted DKK net/VAT/control budgets remain exact; multiline foreign bills require one full credit-note draft against a journal-proven approved bill with up to 20 supported purchase-VAT lines and no bank-payment allocations. DKK amounts must fit remaining verified account/VAT groups; all prior credits and allocations are reverified. Foreign partial credits preserve the original explicit rate; rounding differences are refused before creation. Keeps the original unchanged; book separately. Exact pending replay verifies the uniquely created draft against preserved request evidence and finishes the journal with zero native writes. No delivery or payment.',
};
function lineIdentity(lines:any[],description=false){return canonical(lines.map(l=>canonical({accountId:l.accountId,amount:l.amount,taxRateId:l.taxRateId,...(description?{description:l.description}:{})})).sort());}
function stableHeader(i:any){const {state,approvedTime,balance,isPaid,...rest}=i;return rest;}
function unchanged(before:any,after:any){if(canonical(stableHeader(before.bill))!==canonical(stableHeader(after.bill))||canonical(before.billLines)!==canonical(after.billLines)||canonical(before.attachments)!==canonical(after.attachments))throw Error('Bill content changed during booking');}
async function configuration(read:BillyClient,db:JournalDB,org:string,s:any){
 const i=s.bill;if(!sourceCurrencies.includes(i.currencyId)||typeof i.exchangeRate!=='number'||!Number.isFinite(i.exchangeRate)||i.exchangeRate<=0||i.currencyId==='DKK'&&i.exchangeRate!==1||!['bill','creditNote'].includes(i.type)||(s.billLines.length<1||s.billLines.length>20)||s.attachments.length>3||i.accountingBasis!=null&&i.accountingBasis!=='accrual'||i.taxMode!=='incl'||i.paymentAccountId||i.paymentDate||i.isBare===true)throw new NoWriteError('Booking supports unpaid supported-currency gross bill/credit lines without cash payment');
 await billProvenance(db,org,i);if(s.billLines.some((l:any)=>!l.taxRateId))throw new NoWriteError('Every bill line requires an explicit native purchase VAT code; use predefined KF for no deduction');const l=s.billLines[0];if(s.billLines.some((l:any)=>l.productId!=null||l.quantity!=null&&l.quantity!==1))throw new NoWriteError('Unsupported bill product/quantity');
 const {contact}=await read.get('/contacts/'+id.parse(i.contactId));if(contact?.id!==i.contactId||contact.organizationId!==org||contact.isArchived||contact.isSupplier!==true||!contact.contactNo?.startsWith('mcp-test:'))throw new NoWriteError('Expected active test supplier');
 const rates=await standardVatRates(read,org,s.billLines.map((l:any)=>({...l,currencyId:'DKK',side:'debit'})));if(rates.some(r=>!r.appliesToPurchases)||rates.length>8||i.currencyId!=='DKK'&&(rates.length!==1||rates[0].predefinedTag!=='p_dk_25'||s.billLines.some((l:any)=>!l.taxRateId)))throw new NoWriteError('Unsupported purchase VAT configuration; foreign bills require ordinary 25% VAT');
 const accounts=await read.fetchAll('/accounts','accounts',{organizationId:org});if(accounts.some(a=>a.organizationId!==org))throw new NoWriteError('Account organization mismatch');
 const payables=accounts.filter(a=>a.systemRole==='accountsPayable'&&!a.isArchived&&a.currencyId==='DKK'&&!a.isBankAccount);const expenses=s.billLines.map((l:any)=>accounts.find(a=>a.id===l.accountId));if(payables.length!==1||expenses.some((expense:any)=>!expense||expense.isArchived||expense.isBankAccount||expense.natureId!=='expense'||expense.currencyId!=='DKK'))throw new NoWriteError('Invalid payable/expense configuration');
 const components=s.billLines.map((l:any)=>{const gross=cent(l.amount),rate=rates.find(r=>r.id===l.taxRateId),tax=rate?.rate===0.25?Math.round(gross/5):0,net=gross-tax;if(gross<=0||l.tax!=null&&cent(l.tax)!==tax)throw new NoWriteError('Invalid positive gross bill line or native tax');return{...(i.currencyId==='DKK'?{vatRates:rates,vatLines:s.billLines.map((l:any)=>({accountId:l.accountId,taxRateId:l.taxRateId,amount:l.amount,currencyId:'DKK',side:'debit'}))}:{}),expenseId:l.accountId,gross,net,tax};});
 const gross=components.reduce((n:number,l:any)=>n+l.gross,0),net=components.reduce((n:number,l:any)=>n+l.net,0),tax=components.reduce((n:number,l:any)=>n+l.tax,0);
 if(cent(i.grossAmount)!==gross||cent(i.amount)!==net||cent(i.tax)!==tax)throw new NoWriteError('Native bill totals differ from explicit lines');
 const grouped=new Map<string,number>();for(const line of components)grouped.set(line.expenseId,(grouped.get(line.expenseId)??0)+line.net);const convertedExpenses=[...grouped].map(([accountId,net])=>({accountId,amount:Math.round(net*i.exchangeRate)}));const convertedNet=convertedExpenses.reduce((sum,line)=>sum+line.amount,0);
 return{...(i.currencyId==='DKK'?{vatRates:rates,vatLines:s.billLines.map((l:any)=>({accountId:l.accountId,taxRateId:l.taxRateId,amount:l.amount,currencyId:'DKK',side:'debit'}))}:{}),expenseId:l.accountId,expenses:convertedExpenses,payableId:payables[0].id,taxAccountId:rates[0]?.deductionComponents[0]?.accountId??null,taxRateId:l.taxRateId,sourceGross:gross,sourceNet:net,sourceTax:tax,gross:Math.round(gross*i.exchangeRate),net:convertedNet,tax:Math.round(gross*i.exchangeRate)-convertedNet};
}
export async function billLedger(read:BillyClient,org:string,s:any,c:any){
 const ts=await read.fetchAll('/transactions','transactions',{organizationId:org});const tx=ts.filter(t=>t.originatorReference==='bill:'+s.bill.id&&!t.isVoided&&!t.isVoid);if(tx.length!==1||tx[0].organizationId!==org)throw Error('Expected one native bill transaction');
 const postings=await read.fetchAll('/postings','postings',{transactionId:tx[0].id,organizationId:org});
 // Native foreign bill control is converted from gross; VAT absorbs the exact account-group rounding remainder.
 // Derive from preserved source evidence also for pending journals made by the earlier verifier.
 const convertedGross=Math.round(c.sourceGross*s.bill.exchangeRate),convertedNet=(c.expenses??[{amount:c.net}]).reduce((sum:number,e:any)=>sum+e.amount,0),convertedTax=convertedGross-convertedNet;if(convertedTax<0)throw Error('Invalid converted VAT remainder');
 const credit=s.bill.type==='creditNote',expect=new Map([[c.payableId+':'+(credit?'debit':'credit'),convertedGross],[c.taxAccountId+':'+(credit?'credit':'debit'),convertedTax]]),actual=new Map<string,number>();
 for(const e of c.expenses??[{accountId:c.expenseId,amount:c.net}]){const key=e.accountId+':'+(credit?'credit':'debit');expect.set(key,(expect.get(key)??0)+e.amount);}
 for(const p of postings){if(p.organizationId!==org||p.transactionId!==tx[0].id||p.entryDate!==s.bill.entryDate||p.isVoided||p.currencyId!=='DKK'||p.exchangeRate!=null&&p.exchangeRate!==1||p.baseAmount!=null&&cent(p.baseAmount)!==cent(p.amount)||p.isBankMatched)throw Error('Unexpected native bill posting');if(p.accountId===c.taxAccountId&&!p.salesTaxReturnId)throw Error('Missing native VAT period');if(p.taxRateId!=null&&!(c.vatRates?c.vatRates.some((r:any)=>r.id===p.taxRateId):p.taxRateId===c.taxRateId))throw Error('Unexpected VAT code');const key=p.accountId+':'+p.side;actual.set(key,(actual.get(key)??0)+cent(p.amount));}
 let vatVerification:any;if(c.vatLines)vatVerification=verifyBillVat(c.vatLines,postings,c.vatRates,c.payableId,c.sourceGross,credit);else if(canonical([...expect].sort())!==canonical([...actual].sort()))throw Error('Native bill ledger differs from expected payable/net/VAT amounts');if(c.creditSourceId){if(s.bill.balance!==0||s.bill.isPaid!==true)throw Error('Credit note has remaining balance');const {bill:source}=await read.get('/bills/'+c.creditSourceId);if(source?.id!==c.creditSourceId||source.organizationId!==org||cent(source.balance)!==(c.creditSourceRemaining??0)||source.isPaid!==((c.creditSourceRemaining??0)===0))throw Error('Original bill was not fully offset by native credit');}
 return{transaction:tx[0],postings,...(vatVerification?{vatVerification}:{})};
}
const creditKey=(l:any)=>canonical([l.accountId,l.taxRateId]);
type CreditRemaining=Map<string,number>&{foreign?:{rate:number;gross:number;net:number;tax:number;sourceNet:number;sourceTax:number}};
function consumeCredit(remaining:CreditRemaining,lines:any[]){
 const fx=remaining.foreign;if(fx&&lines.length!==1)throw new NoWriteError('Foreign partial credits require one line');
 for(const l of lines){const key=creditKey(l),amount=cent(l.amount);if(amount<=0||!remaining.has(key)||amount>remaining.get(key)!)throw new NoWriteError('Credit exceeds remaining amount for account/VAT group');
 if(fx){const converted=(gross:number)=>{const net=gross-Math.round(gross/5),baseGross=Math.round(gross*fx.rate),baseNet=Math.round(net*fx.rate);return{gross:baseGross,net:baseNet,tax:baseGross-baseNet,sourceNet:net,sourceTax:gross-net};};const proposed=converted(amount),rest=converted(remaining.get(key)!-amount);for(const k of ['gross','net','tax','sourceNet','sourceTax'] as const)if(proposed[k]+rest[k]!==fx[k])throw new NoWriteError('Partial credit rounding would not preserve the remaining original source and DKK ledger');for(const k of ['gross','net','tax','sourceNet','sourceTax'] as const)fx[k]-=proposed[k];}
 remaining.set(key,remaining.get(key)!-amount);
 }
}
async function remainingCredit(read:BillyClient,db:JournalDB,org:string,source:any,exclude?:string){
 const b=source.bill;if(!sourceCurrencies.includes(b.currencyId)||b.currencyId!=='DKK'&&source.billLines.length!==1||b.state!=='approved'||b.type!=='bill'||b.isPaid!==false||cent(b.balance)<=0)throw new NoWriteError('Partial credits require an unpaid supported source; foreign bills require one ordinary VAT line');
 const sourceConfig=await configuration(read,db,org,source);await billLedger(read,org,source,sourceConfig);
 const remaining:CreditRemaining=new Map<string,number>();if(b.currencyId!=='DKK'||source.billLines.length===1&&sourceConfig.vatRates?.length===1&&sourceConfig.vatRates[0].predefinedTag==='p_dk_25')remaining.foreign={rate:b.exchangeRate,gross:sourceConfig.gross,net:sourceConfig.net,tax:sourceConfig.tax,sourceNet:sourceConfig.sourceNet,sourceTax:sourceConfig.sourceTax};for(const l of source.billLines)remaining.set(creditKey(l),(remaining.get(creditKey(l))??0)+cent(l.amount));
 const credits=(await read.fetchAll('/bills','bills',{organizationId:org,creditedBillId:b.id})).filter(x=>x.creditedBillId===b.id&&x.id!==exclude);if(credits.length>=4)throw new NoWriteError('At most four linked credits per source');
 const known=new Map<string,number>();let credited=0;
 for(const candidate of credits){const cs=await priorCreditFinancialSnapshot(read,org,'bill',id.parse(candidate.id)),cb=cs.bill;await billProvenance(db,org,cb);if(cb.type!=='creditNote'||cb.state!=='approved'||cb.currencyId!==b.currencyId||cb.exchangeRate!==b.exchangeRate||cb.contactId!==b.contactId||cb.creditedBillId!==b.id||cb.balance!==0||cb.isPaid!==true)throw new NoWriteError('Earlier credit is unapproved or changed');const config=await configuration(read,db,org,cs);await billLedger(read,org,cs,config);consumeCredit(remaining,cs.billLines);const gross=cent(cb.grossAmount);credited+=gross;known.set('bill:'+cb.id,gross);if((await priorCreditFinancialSnapshot(read,org,'bill',cb.id)).revision!==cs.revision)throw new NoWriteError('Earlier credit changed during inspection');}
 const active=(await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'bill:'+b.id})).filter(m=>m.isVoided!==true);const seen=new Set<string>();for(const m of active){if(m.subjectReference!=='bill:'+b.id||m.isVoided!==false||!known.has(m.modifierReference)||seen.has(m.modifierReference)||m.amount!==-known.get(m.modifierReference)!/100||m.realizedCurrencyDifference!=null&&m.realizedCurrencyDifference!==0)throw new NoWriteError('Unproven payment or credit allocation');seen.add(m.modifierReference);}if(seen.size!==known.size||cent(b.grossAmount)-credited!==cent(b.balance))throw new NoWriteError('Native remaining bill balance is not explained by verified credits');
 return remaining;
}
export function billBookingHandler(reader:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string){return async(a:any)=>{try{const read=documentConfigurationRead(reader);
 z.string().uuid().parse(a.operationId);z.string().min(1).parse(a.expectedRevision);z.string().min(1).max(4000).parse(a.reasoning);const book=name==='book_test_bill_draft';if(!billBookingDescriptions[name])throw new NoWriteError('Unknown action');id.parse(book?a.id:a.billId);
 const {organization}=await read.get('/organization');if(organization?.id!==org||organization.baseCurrencyId!=='DKK')throw new NoWriteError('Organization mismatch');
 const fingerprint=canonical({action:name,...a}),target=org+':bill:'+(book?a.id:a.billId),journalId=org+':'+a.operationId;
 const pending=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<any>();
 if(!book&&pending?.state==='pending'){
 if(pending.fingerprint!==fingerprint||pending.target!==target)throw Error('Pending credit input mismatch');
 const saved=JSON.parse(pending.result??'null');if(saved?.stage!=='before_bill_credit_creation'||saved.before?.revision!==a.expectedRevision||!saved.payload||!saved.configuration)throw Error('No preserved credit creation evidence');
 const source=await billSnapshot(read,org,a.billId);if(source.revision!==a.expectedRevision)throw Error('Credit source changed; reservation retained');
 const candidates=(await read.fetchAll('/bills','bills',{organizationId:org,voucherNo:'TEST-'+a.operationId})).filter(b=>b.voucherNo==='TEST-'+a.operationId);if(candidates.length!==1)throw Error('Credit creation is not uniquely proved; no native retry');
 const after=await billSnapshot(read,org,id.parse(candidates[0].id)),b=after.bill,payload=saved.payload,c=saved.configuration;
 for(const [key,value] of Object.entries(payload))if(key!=='lines'&&b[key]!==value)throw Error('Existing credit header mismatch: '+key);
 if(b.paymentAccountId||b.paymentDate||b.isBare===true||b.accountingBasis!=null&&b.accountingBasis!=='accrual'||b.isPaid!==false||cent(b.balance)!==c.sourceGross||cent(b.grossAmount)!==c.sourceGross||cent(b.amount)!==c.sourceNet||cent(b.tax)!==c.sourceTax||lineIdentity(after.billLines,true)!==lineIdentity(payload.lines,true)||after.billLines.some((l:any)=>l.productId!=null||l.quantity!=null&&l.quantity!==1))throw Error('Existing credit lines or totals differ from preserved operation');
 await configuration(read,db,org,source);
 if(source.bill.currencyId==='DKK'||source.billLines.length===1){const remaining=await remainingCredit(read,db,org,source,b.id);consumeCredit(remaining,payload.lines);}
 else{const credits=await read.fetchAll('/bills','bills',{organizationId:org,creditedBillId:a.billId});if(credits.some(x=>x.creditedBillId===a.billId&&x.id!==b.id)||lineIdentity(source.billLines)!==lineIdentity(payload.lines)||cent(source.bill.balance)!==c.sourceGross||(await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'bill:'+a.billId})).some(x=>x.isVoided!==true))throw Error('Foreign credit source or allocations changed');}
 if(canonical([...new Set(after.attachments.map((x:any)=>x.fileId))].sort())!==canonical([...new Set(source.attachments.map((x:any)=>x.fileId))].sort()))throw Error('Existing credit attachments differ');
 if((await billSnapshot(read,org,a.billId)).revision!==source.revision||(await billSnapshot(read,org,b.id)).revision!==after.revision)throw Error('Credit/source changed during recovery');
 const result={...after,sourceBillId:a.billId,reasoning:a.reasoning,booked:false,recovery:{nativeWrites:0}};const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,target).run();if(!r.success||r.meta.changes!==1)throw Error('Journal changed during credit recovery');return jsonResult({operationId:a.operationId,replayed:false,result});
 }
 if(book&&pending?.state==='pending'){
 if(pending.fingerprint!==fingerprint||pending.target!==target)throw Error('Pending booking input mismatch');const saved=JSON.parse(pending.result??'null');if(saved?.stage!=='before_bill_booking'||saved.before.revision!==a.expectedRevision)throw Error('No recoverable bill evidence');
 const after=await billSnapshot(read,org,a.id);
 if(after.bill.state==='draft'&&saved.diagnostic?.kind==='billy_http'&&saved.diagnostic.method==='PUT'&&saved.diagnostic.resource==='bills'&&[400,422].includes(saved.diagnostic.httpStatus)){
 if(after.revision!==saved.before.revision)throw Error('Rejected booking document changed; reservation retained');
 const transactions=await read.fetchAll('/transactions','transactions',{organizationId:org});if(transactions.some(t=>t.originatorReference==='bill:'+a.id))throw Error('Native transaction exists; reservation retained');
 if((await billSnapshot(read,org,a.id)).revision!==after.revision)throw Error('Draft changed during rejection inspection');
 const result={...saved,disposition:'abandoned',nativeBookingOccurred:false,recovery:{nativeWrites:0},reason:'Native validation rejection; unchanged draft and absent transaction verified'};
 const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,target).run();if(!r.success||r.meta.changes!==1)throw Error('Journal changed during rejection inspection');return jsonResult({operationId:a.operationId,replayed:false,abandoned:true,result});
 }
 if(after.bill.state!=='approved')throw Error('Booking not proven approved; no automatic retry');unchanged(saved.before,after);const ledger=await billLedger(read,org,after,saved.configuration);if((await billSnapshot(read,org,a.id)).revision!==after.revision)throw Error('Bill changed during recovery');
 const result={...after,...ledger,reasoning:a.reasoning,recovery:{nativeWrites:0}};const r=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify(result),journalId,fingerprint,target).run();if(!r.success||r.meta.changes!==1)throw Error('Journal changed during recovery');return jsonResult({operationId:a.operationId,replayed:false,result});
 }
 return jsonResult(await journalRun(db,org,a.operationId,'bill:'+(book?a.id:a.billId),{action:name,...a},async()=>{
 let before:any,c:any,payload:any;
 try{
 before=await billSnapshot(read,org,book?a.id:a.billId);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_bill again');c=await configuration(read,db,org,before);
 if(book){if(before.bill.state!=='draft'||before.bill.isPaid!==false||cent(before.bill.balance)!==c.sourceGross)throw new NoWriteError('Expected draft');
 if(before.bill.type==='creditNote'){
 const source=await billSnapshot(read,org,id.parse(before.bill.creditedBillId));await billProvenance(db,org,source.bill);
 if(source.bill.currencyId!==before.bill.currencyId||source.bill.exchangeRate!==before.bill.exchangeRate)throw new NoWriteError('Credit/source currency or rate mismatch');
 if(source.bill.currencyId==='DKK'||source.billLines.length===1){
 if(source.bill.contactId!==before.bill.contactId||source.bill.taxMode!==before.bill.taxMode||source.bill.paymentAccountId||source.bill.paymentDate)throw new NoWriteError('Original bill configuration changed');
 const remaining=await remainingCredit(read,db,org,source,before.bill.id);consumeCredit(remaining,before.billLines);c.creditSourceRemaining=cent(source.bill.balance)-c.sourceGross;if(c.creditSourceRemaining<0)throw new NoWriteError('Credit exceeds source balance');
 }else{
if(source.bill.state!=='approved'||source.bill.type!=='bill'||source.bill.isPaid!==false||cent(source.bill.balance)!==c.sourceGross||source.bill.currencyId!==before.bill.currencyId||source.bill.exchangeRate!==before.bill.exchangeRate||source.bill.contactId!==before.bill.contactId||source.bill.paymentAccountId||source.bill.paymentDate||source.bill.taxMode!==before.bill.taxMode||source.billLines.length!==before.billLines.length)throw new NoWriteError('Original bill changed or was paid before credit booking');
 if(lineIdentity(source.billLines)!==lineIdentity(before.billLines))throw new NoWriteError('Credit differs from original');
 const credits=await read.fetchAll('/bills','bills',{organizationId:org,creditedBillId:source.bill.id});if(credits.some(x=>x.creditedBillId===source.bill.id&&x.id!==before.bill.id))throw new NoWriteError('Another credit note exists');
 if((await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'bill:'+source.bill.id})).some(x=>x.isVoided!==true))throw new NoWriteError('Original bill has payment allocations');
 }
 c.creditSourceId=source.bill.id;
 }
 assertBookingDateOpen(organization,before.bill.entryDate);assertVatPeriodsOpen(await read.fetchAll('/salesTaxReturns','salesTaxReturns',{organizationId:org},1000),org,before.bill.entryDate);}
 else{
 if(before.bill.state!=='approved'||before.bill.type!=='bill'||before.bill.isPaid!==false)throw new NoWriteError('Expected unpaid approved original bill');
 if(!Array.isArray(a.lines)||a.lines.length<1||a.lines.length>20)throw new NoWriteError('Supply one to twenty credit lines');
 const proposed=a.lines.map((supplied:any)=>{if(supplied.productId!==undefined||supplied.quantity!==1||supplied.amountBasis!=='gross')throw new NoWriteError('Credit requires gross lines and quantity one');z.string().min(1).max(500).parse(supplied.description);return{accountId:supplied.accountId,amount:supplied.unitPrice,taxRateId:supplied.taxRateId,description:supplied.description};});
 if(before.bill.currencyId==='DKK'||before.billLines.length===1){const remaining=await remainingCredit(read,db,org,before);consumeCredit(remaining,proposed);}
 else{if(cent(before.bill.balance)!==c.sourceGross||lineIdentity(proposed)!==lineIdentity(before.billLines))throw new NoWriteError('Foreign credits require complete original lines');const credits=await read.fetchAll('/bills','bills',{organizationId:org,creditedBillId:a.billId});if(credits.some(i=>i.creditedBillId===a.billId))throw new NoWriteError('Existing foreign credit');if((await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference:'bill:'+a.billId})).some(x=>x.isVoided!==true))throw new NoWriteError('Existing payment allocation');}
 c.sourceGross=proposed.reduce((n:number,l:any)=>n+cent(l.amount),0);c.sourceTax=proposed.reduce((n:number,l:any)=>n+((c.vatRates?.find((r:any)=>r.id===l.taxRateId)?.rate??0.25)===0.25?Math.round(cent(l.amount)/5):0),0);c.sourceNet=c.sourceGross-c.sourceTax;
 z.iso.date().parse(a.entryDate);if(a.entryDate<before.bill.entryDate)throw new NoWriteError('Credit date precedes original');assertBookingDateOpen(organization,a.entryDate);
 payload={organizationId:org,type:'creditNote',state:'draft',voucherNo:'TEST-'+a.operationId,creditedBillId:a.billId,contactId:before.bill.contactId,entryDate:a.entryDate,currencyId:before.bill.currencyId,exchangeRate:before.bill.exchangeRate,taxMode:'incl',lines:proposed};
 }
 if((await billSnapshot(read,org,before.bill.id)).revision!==before.revision)throw new NoWriteError('Bill changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Bill posting preflight failed; no write performed');}
 if(book){
 const header=before.bill;const evidence={stage:'before_bill_booking',before:{...before,bill:header},configuration:c};const stored=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify(evidence),journalId).run();if(!stored.success||stored.meta.changes!==1)throw new NoWriteError('Cannot save recovery evidence; no native write');
 await write.put('/bills/'+a.id,{bill:{state:'approved',exchangeRate:before.bill.exchangeRate}});const after=await billSnapshot(read,org,a.id);if(after.bill.state!=='approved')throw Error('Bill not approved');unchanged(before,after);const ledger=await billLedger(read,org,after,c);return{...after,...ledger,reasoning:a.reasoning,paymentPerformed:false};
 }
 const creditEvidence={stage:'before_bill_credit_creation',before,payload,configuration:c};const stored=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify(creditEvidence),journalId).run();if(!stored.success||stored.meta.changes!==1)throw new NoWriteError('Cannot save credit evidence; no native write');
 const response=await write.post('/bills',{bill:payload});const billId=id.parse(response.bills?.[0]?.id);for(const fileId of new Set<string>(before.attachments.map((x:any)=>x.fileId)))await write.post('/attachments',{attachment:{organizationId:org,ownerReference:'bill:'+billId,fileId}});
 const after=await billSnapshot(read,org,billId);for(const [key,value] of Object.entries(payload))if(key!=='lines'&&after.bill[key]!==value)throw Error('Credit readback mismatch: '+key);if(lineIdentity(after.billLines)!==lineIdentity(payload.lines)||cent(after.bill.grossAmount)!==c.sourceGross||cent(after.bill.amount)!==c.sourceNet||cent(after.bill.tax)!==c.sourceTax)throw Error('Credit line/totals mismatch');if(lineIdentity(after.billLines,true)!==lineIdentity(payload.lines,true))throw Error('Credit line readback mismatch');if(canonical([...new Set(after.attachments.map((x:any)=>x.fileId))].sort())!==canonical([...new Set(before.attachments.map((x:any)=>x.fileId))].sort()))throw Error('Credit attachment mismatch');if((await billSnapshot(read,org,a.billId)).revision!==before.revision)throw Error('Original changed during credit proposal');
 return{...after,sourceBillId:a.billId,reasoning:a.reasoning,booked:false};
 }));
 }catch(e){return errorResult(e);}};}
