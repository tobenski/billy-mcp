import {sourceCurrencies} from './test-currency.js';
import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {invoiceSnapshot,invoiceProvenance} from './test-invoice-drafts.js';
import {billSnapshot,billProvenance} from './test-bill-drafts.js';
import {canonical} from './test-vat-management.js';
import {sha256} from './test-files.js';
import {assertBookingDateOpen} from './test-period-guard.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
// Deliberately limited to the existing synthetic offline fixture. Never the linked account5711.
export const TEST_PAYMENT_ACCOUNT_ID='LBWs6wsVTPuyorip6I1PXA';
const cents=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>1e-7)throw Error('Invalid native amount');return Math.round(n*100);};
const hash=async(v:any)=>sha256(new TextEncoder().encode(canonical(v)));
const snapshot=(read:BillyClient,org:string,kind:string,recordId:string):Promise<any>=>kind==='invoice'?invoiceSnapshot(read,org,recordId):billSnapshot(read,org,recordId);
const cleanDocument=(s:any,kind:string)=>{const {balance,isPaid,downloadUrl,...header}=s[kind];return{header,lines:s[kind+'Lines'],attachments:s.attachments};};
async function provenance(db:JournalDB,org:string,kind:string,record:any){if(kind==='invoice')await invoiceProvenance(db,org,record,'invoice');else await billProvenance(db,org,record);}
export async function offlineAccount(read:BillyClient,org:string,accountId:string){if(accountId!==TEST_PAYMENT_ACCOUNT_ID)throw new NoWriteError('Only the explicit offline test account is allowed');const {account:a}=await read.get('/accounts/'+accountId);if(a?.id!==accountId||a.organizationId!==org||a.isArchived||a.isPaymentEnabled!==true||a.currencyId!=='DKK'||a.bankAccountNo||a.bankIban||a.bankRoutingNo||a.externalId)throw new NoWriteError('Offline account configuration changed');return a;}
async function allocations(read:BillyClient,subjectReference:string){return(await read.fetchAll('/balanceModifiers','balanceModifiers',{subjectReference})).filter(x=>x.subjectReference===subjectReference);}
export const paymentDescriptions:Record<string,string>={
 create_test_fx_adjustment_draft:'Native-FX duplicate prevention only: verify explicit DKK source/payment bases and the native FX ledger for a journal-proven foreign payment. Returns draftCreated=false when Billy already posted the difference or the payment was fully voided. Never creates a second FX posting. Standalone/manual FX drafts remain unsupported.',
 record_test_invoice_payment:'Record one full source-currency payment with explicit DKK baseAmount for a journal-proven test invoice on the fixed offline test account5710. Verifies allocation, document balance and native cash/receivable ledger. No bank transfer. DKK/EUR/USD/GBP/SEK/NOK source supported; native FX posting verified against original booked DKK control amount. Partial/fee payments unsupported; uncertain outcomes stay locked.',
 record_test_bill_payment:'Record one full source-currency payment with explicit DKK baseAmount for a journal-proven test bill on the fixed offline test account5710. Verifies allocation, document balance and native cash/payable ledger. No bank transfer. DKK/EUR/USD/GBP/SEK/NOK source supported; native FX posting verified against original booked DKK control amount. Partial/fee payments unsupported; uncertain outcomes stay locked.',
 get_test_document_payment:'Read one native payment, its single invoice/bill allocation, document, transactions and postings with revision. Preserves native records. No bank action.',
 void_test_document_payment:'Void only a journal-proven synthetic payment on offline account5710. Requires current payment/document/ledger revision, no bank matching and an open fiscal date. Verifies restoration of the original document balance and inactive payment postings. No bank transfer cancellation.',
};
export async function paymentSnapshot(read:BillyClient,org:string,paymentId:string){
 id.parse(paymentId);const {organization}=await read.get('/organization');if(organization?.id!==org)throw Error('Organization mismatch');
 const {bankPayment:p}=await read.get('/bankPayments/'+paymentId);if(p?.id!==paymentId||p.organizationId!==org)throw Error('Payment ownership mismatch');
 const mods=(await read.fetchAll('/balanceModifiers','balanceModifiers',{modifierReference:'bankPayment:'+paymentId})).filter(x=>x.modifierReference==='bankPayment:'+paymentId).sort((a,b)=>a.id.localeCompare(b.id));
 if(mods.length!==1)throw Error('Expected exactly one native document allocation');const match=/^(invoice|bill):([A-Za-z0-9_-]{1,100})$/.exec(mods[0].subjectReference);if(!match)throw Error('Unsupported payment subject');
 const [_,kind,recordId]=match,document=await snapshot(read,org,kind,recordId);if(document[kind].contactId!==p.contactId)throw Error('Payment/document contact mismatch');
 const transactions=(await read.fetchAll('/transactions','transactions',{organizationId:org})).filter(x=>x.originatorReference==='bankPayment:'+paymentId).sort((a,b)=>a.id.localeCompare(b.id));
 if(transactions.length!==(p.isVoided?2:1)||transactions.some(t=>t.organizationId!==org))throw Error('Unexpected native payment transaction count');
 const postings:any[]=[];for(const t of transactions){const ps=await read.fetchAll('/postings','postings',{organizationId:org,transactionId:t.id});if(ps.some(p=>p.transactionId!==t.id))throw Error('Wrong payment posting transaction');postings.push(...ps);}postings.sort((a,b)=>a.id.localeCompare(b.id));
 if(postings.some(p=>p.organizationId!==org||!transactions.some(t=>t.id===p.transactionId)))throw Error('Unexpected payment posting ownership');
 const value={bankPayment:p,balanceModifiers:mods,subjectType:kind,subjectId:recordId,document,transactions,postings};
 return{...value,revision:await hash({...value,document:{...document,[kind]:Object.fromEntries(Object.entries(document[kind]).filter(([k])=>k!=='downloadUrl'))}})};
}
export function verifyPaymentTransactions(transactions:any[],postings:any[],entryDate:string,amount:number,cashId:string,controlId:string,side:string,voided:boolean,fx?:{controlAmount:number;accountId:string|null}){
 const originals=transactions.filter((t:any)=>t.isVoid===false&&t.isVoided===voided),reversals=transactions.filter((t:any)=>t.isVoid===true&&t.isVoided===false);if(originals.length!==1||reversals.length!==(voided?1:0)||transactions.length!==(voided?2:1))throw Error('Unexpected payment transaction state');
 for(const t of transactions){const actual=new Map<string,number>();for(const x of postings.filter((p:any)=>p.transactionId===t.id)){if(x.isVoided!==voided||x.isBankMatched||x.entryDate!==entryDate||x.currencyId!=='DKK'||x.baseAmount!=null&&cents(x.baseAmount)!==cents(x.amount)||x.exchangeRate!=null&&x.exchangeRate!==1||x.taxRateId!=null||x.salesTaxReturnId!=null)throw Error('Unexpected payment posting');const key=x.accountId+':'+x.side;actual.set(key,(actual.get(key)??0)+cents(x.amount));}
 const cashSide=t.isVoid?(side==='debit'?'credit':'debit'):side;const expected=new Map([[cashId+':'+cashSide,amount],[controlId+':'+(cashSide==='debit'?'credit':'debit'),fx?.controlAmount??amount]]);const delta=amount-(fx?.controlAmount??amount);if(delta){if(!fx?.accountId)throw Error('Missing FX account');expected.set(fx.accountId+':'+(delta>0?(cashSide==='debit'?'credit':'debit'):cashSide),Math.abs(delta));}if(canonical([...actual].sort())!==canonical([...expected].sort()))throw Error('Payment ledger differs from expected cash/control amounts');}
}
function verifyLedger(s:any,amount:number,cashId:string,controlId:string,voided=false,e:any={}){
 const p=s.bankPayment;if(p.isVoided!==voided||p.cashAccountId!==cashId||p.subjectCurrencyId!==(e.currencyId??'DKK')||typeof p.cashExchangeRate!=='number'||Math.abs(p.cashExchangeRate-(e.cashRate??1))>0.00005||cents(p.cashAmount)!==amount||p.feeAmount!=null&&p.feeAmount!==0)throw Error('Unexpected payment header');
 const side=s.subjectType==='invoice'?'debit':'credit';if(p.cashSide!==side)throw Error('Unexpected cash side');
 verifyPaymentTransactions(s.transactions,s.postings,p.entryDate,amount,cashId,controlId,side,voided,{controlAmount:e.controlBaseAmount??amount,accountId:e.fxAccountId??null});
 const m=s.balanceModifiers[0];if(m.isVoided!==voided||cents(Math.abs(m.amount))!==(e.sourceAmount??amount)||cents(Math.abs(m.realizedCurrencyDifference??0))!==Math.abs(amount-(e.controlBaseAmount??amount)))throw Error('Unexpected payment allocation');
}
function completedPayment(after:any,e:any,reasoning:string){
 verifyLedger(after,e.amount,e.accountId,e.controlId,e.undo,e);
 const k=after.subjectType;if(k!==e.kind||after.subjectId!==e.subjectId||canonical(cleanDocument(after.document,k))!==canonical(cleanDocument(e.beforeDocument,k)))throw Error('Payment document changed');
 if(after.document[k].balance!==(e.undo?e.beforeDocument[k].balance:0)||after.document[k].isPaid!==!e.undo)throw Error('Payment balance mismatch');
 return{...after,beforeDocument:e.beforeDocument,controlAccountId:e.controlId,currencyId:e.currencyId??'DKK',sourceAmount:e.sourceAmount??e.amount,controlBaseAmount:e.controlBaseAmount??e.amount,fxAccountId:e.fxAccountId??null,cashRate:e.cashRate??1,bankTransfer:false,voided:e.undo,reasoning};
}
export function paymentHandler(read:BillyClient,write:BillyClient|undefined,db:JournalDB|undefined,org:string,name:string){return async(a:any)=>{let nativeFailure:Error|undefined;try{
 if(name==='get_test_document_payment')return jsonResult(await paymentSnapshot(read,org,a.paymentId));
 if(name==='create_test_fx_adjustment_draft')return await fxAdjustmentGuard(read,db,org,a);
 if(!write||!db)throw new NoWriteError('Test writes disabled');z.string().uuid().parse(a.operationId);z.string().min(1).parse(a.expectedRevision);z.string().min(1).max(4000).parse(a.reasoning);
 const undo=name==='void_test_document_payment',kind=name==='record_test_invoice_payment'?'invoice':'bill';if(!paymentDescriptions[name])throw new NoWriteError('Unknown action');id.parse(undo?a.paymentId:a.id);
 const {organization}=await read.get('/organization');if(organization?.id!==org||organization.baseCurrencyId!=='DKK')throw new NoWriteError('Organization mismatch');
 const journalId=org+':'+a.operationId,target=org+':'+(undo?'payment:'+a.paymentId:kind+':'+a.id),fingerprint=canonical({action:name,...a});
 const prior=await db.prepare('SELECT fingerprint, state, result, target FROM operations WHERE id = ?').bind(journalId).first<any>();
 if(prior?.state==='pending'){
 if(prior.fingerprint!==fingerprint||prior.target!==target)throw Error('Pending payment input mismatch');const e=JSON.parse(prior.result??'null');if(e?.stage!=='before_document_payment')throw Error('Missing preserved payment evidence');
 let paymentId=a.paymentId;if(!undo){const payments=await read.fetchAll('/bankPayments','bankPayments',{organizationId:org});const candidates=payments.filter(p=>!e.priorPaymentIds.includes(p.id)&&p.organizationId===org&&p.cashAccountId===e.accountId&&p.entryDate===e.entryDate&&p.contactId===e.beforeDocument[e.kind].contactId&&p.cashSide===(e.kind==='invoice'?'debit':'credit')&&cents(p.cashAmount)===e.amount);if(candidates.length!==1)throw Error('Payment creation is not uniquely proved; no native retry');paymentId=candidates[0].id;}
 const after=await paymentSnapshot(read,org,paymentId),result=completedPayment(after,e,a.reasoning);if((await paymentSnapshot(read,org,paymentId)).revision!==after.revision)throw Error('Payment changed during recovery');
 const done=await db.prepare("UPDATE operations SET state = 'complete', result = ? WHERE id = ? AND state = 'pending' AND fingerprint = ? AND target = ?").bind(JSON.stringify({...result,recovery:{nativeWrites:0}}),journalId,fingerprint,target).run();if(!done.success||done.meta.changes!==1)throw Error('Journal changed during recovery');return jsonResult({operationId:a.operationId,replayed:false,result:{...result,recovery:{nativeWrites:0}}});
 }
 return jsonResult(await journalRun(db,org,a.operationId,undo?'payment:'+a.paymentId:kind+':'+a.id,{action:name,...a},async()=>{
 let before:any,account:any,controlId:string,amount:number,payload:any,saved:any,priorPaymentIds:string[]=[],currencyId='DKK',sourceAmount=0,controlBaseAmount=0,fxAccountId:string|null=null,cashRate=1;
 try{
 if(undo){before=await paymentSnapshot(read,org,a.paymentId);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_test_document_payment');
 const row=await db.prepare("SELECT fingerprint, state, result FROM operations WHERE state = 'complete' AND json_extract(fingerprint, '$.action') IN ('record_test_invoice_payment','record_test_bill_payment') AND json_extract(result, '$.bankPayment.id') = ?").bind(a.paymentId).first<any>();if(!row||!['record_test_invoice_payment','record_test_bill_payment'].includes(JSON.parse(row.fingerprint).action))throw new NoWriteError('Missing payment creation provenance');saved=JSON.parse(row.result);if(!saved.beforeDocument||!saved.controlAccountId||saved.bankPayment.organizationId!==org)throw new NoWriteError('Missing payment recovery evidence');
 amount=cents(saved.bankPayment.cashAmount);controlId=saved.controlAccountId;account=await offlineAccount(read,org,before.bankPayment.cashAccountId);currencyId=saved.currencyId??'DKK';sourceAmount=saved.sourceAmount??amount;controlBaseAmount=saved.controlBaseAmount??amount;fxAccountId=saved.fxAccountId??null;cashRate=saved.cashRate??1;verifyLedger(before,amount,account.id,controlId,false,{currencyId,sourceAmount,controlBaseAmount,fxAccountId,cashRate});
 const k=before.subjectType;if(before.document[k].balance!==0||before.document[k].isPaid!==true||canonical(cleanDocument(before.document,k))!==canonical(cleanDocument(saved.beforeDocument,k)))throw new NoWriteError('Paid document changed');await provenance(db,org,k,before.document[k]);
 const all=await allocations(read,k+':'+before.subjectId);if(all.some(x=>!x.isVoided&&x.modifierReference!=='bankPayment:'+a.paymentId))throw new NoWriteError('Other allocation exists');assertBookingDateOpen(organization,before.bankPayment.entryDate);
 if((await paymentSnapshot(read,org,a.paymentId)).revision!==before.revision)throw new NoWriteError('Payment changed during preflight');
 }else{
 before=await snapshot(read,org,kind,a.id);const doc=before[kind];if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read document');await provenance(db,org,kind,doc);
 if(doc.state!=='approved'||doc.type!==kind||!sourceCurrencies.includes(doc.currencyId)||typeof doc.exchangeRate!=='number'||!Number.isFinite(doc.exchangeRate)||doc.exchangeRate<=0||doc.currencyId==='DKK'&&doc.exchangeRate!==1||doc.isPaid!==false||cents(doc.balance)!==cents(doc.grossAmount)||doc.creditedInvoiceId||doc.creditedBillId)throw new NoWriteError('Expected fully unpaid approved supported-currency test document');
 sourceAmount=cents(a.amount);amount=cents(a.baseAmount);currencyId=doc.currencyId;if(amount<=0||sourceAmount<=0||a.currencyId!==currencyId||currencyId==='DKK'&&amount!==sourceAmount||sourceAmount!==cents(doc.balance))throw new NoWriteError('Full exact source amount and DKK base payment required');cashRate=Math.round(amount/sourceAmount*1e6)/1e6;if(!Number.isFinite(cashRate)||cashRate<=0||Math.round(amount/cashRate)!==sourceAmount)throw new NoWriteError('Six-decimal native payment rate cannot preserve exact source cents');
 z.iso.date().parse(a.entryDate);if(a.entryDate<doc.entryDate)throw new NoWriteError('Payment precedes document');assertBookingDateOpen(organization,a.entryDate);account=await offlineAccount(read,org,a.accountId);
 if((await allocations(read,kind+':'+a.id)).some(x=>!x.isVoided))throw new NoWriteError('Existing payment allocation');const credits=await read.fetchAll('/'+kind+'s',kind+'s',{organizationId:org,[kind==='invoice'?'creditedInvoiceId':'creditedBillId']:a.id});if(credits.some(x=>x[kind==='invoice'?'creditedInvoiceId':'creditedBillId']===a.id))throw new NoWriteError('Existing credit note');
 const accounts=await read.fetchAll('/accounts','accounts',{organizationId:org});const controls=accounts.filter(x=>x.organizationId===org&&x.systemRole===(kind==='invoice'?'accountsReceivable':'accountsPayable')&&!x.isArchived&&x.currencyId==='DKK');if(controls.length!==1)throw new NoWriteError('Ambiguous control account');controlId=controls[0].id;controlBaseAmount=amount;
 if(currencyId!=='DKK'){
 const row=await db.prepare("SELECT fingerprint, state, result FROM operations WHERE state='complete' AND json_extract(fingerprint,'$.action')=? AND json_extract(result,?)=?").bind('book_test_'+kind+'_draft','$.'+kind+'.id',a.id).first<any>();if(!row)throw new NoWriteError('Foreign document needs verified booking journal');const savedBook=JSON.parse(row.result),t=savedBook.transaction;if(!t||t.organizationId!==org)throw new NoWriteError('Missing native booking evidence');const native=await read.fetchAll('/postings','postings',{organizationId:org,transactionId:t.id});const controls=native.filter(p=>p.accountId===controlId);if(controls.length!==1||controls[0].organizationId!==org||controls[0].currencyId!=='DKK'||controls[0].side!==(kind==='invoice'?'debit':'credit')||controls[0].isVoided||controls[0].isBankMatched||canonical(controls[0])!==canonical(savedBook.postings.find((p:any)=>p.id===controls[0].id)))throw new NoWriteError('Original foreign control posting changed');controlBaseAmount=cents(controls[0].amount);
 const fx=accounts.filter(x=>x.organizationId===org&&x.systemRole==='realizedCurrencyDifference'&&!x.isArchived&&x.currencyId==='DKK');if(fx.length!==1)throw new NoWriteError('Ambiguous native FX account');fxAccountId=fx[0].id;
 }
 priorPaymentIds=(await read.fetchAll('/bankPayments','bankPayments',{organizationId:org})).map(p=>p.id);
 payload={organizationId:org,entryDate:a.entryDate,cashAmount:a.baseAmount,cashSide:kind==='invoice'?'debit':'credit',cashAccountId:account.id,cashExchangeRate:cashRate,associations:[{subjectReference:kind+':'+a.id}]};
 if((await snapshot(read,org,kind,a.id)).revision!==before.revision)throw new NoWriteError('Document changed during preflight');
 }
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Payment preflight failed; no write performed');}
 const e={stage:'before_document_payment',undo,kind:undo?before.subjectType:kind,subjectId:undo?before.subjectId:a.id,beforeDocument:undo?saved.beforeDocument:before,accountId:account.id,controlId:controlId!,amount:amount!,currencyId,sourceAmount,controlBaseAmount,fxAccountId,cashRate,entryDate:undo?before.bankPayment.entryDate:a.entryDate,priorPaymentIds};
 // Signed download URLs are irrelevant to recovery and are not retained as evidence.
 if(e.kind==='invoice'){const {downloadUrl,...header}=e.beforeDocument.invoice;e.beforeDocument={...e.beforeDocument,invoice:header};}
 const stored=await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify(e),journalId).run();if(!stored.success||stored.meta.changes!==1)throw new NoWriteError('Cannot preserve payment evidence; no write');
 let paymentId=a.paymentId;
 if(undo)await write.put('/bankPayments/'+paymentId,{bankPayment:{isVoided:true}});
 else{let response:any;try{response=await write.post('/bankPayments',{bankPayment:payload});}catch(err){if(err instanceof Error)nativeFailure=err;const message=err instanceof Error?err.message:'';if(/^Billy API POST \/bankPayments failed with (400|422):/.test(message)&&(await snapshot(read,org,kind,a.id)).revision===before.revision&&canonical((await read.fetchAll('/bankPayments','bankPayments',{organizationId:org})).map(p=>p.id).sort())===canonical([...priorPaymentIds].sort())&&!(await allocations(read,kind+':'+a.id)).some(x=>!x.isVoided))throw new NoWriteError(message);const status=/^Billy API POST \/bankPayments failed with ([1-5][0-9]{2}):/.exec(message);const diagnostic={kind:status?'billy_http':message.includes('network error:')?'billy_network':'verification_or_internal',method:'POST',resource:'bankPayments',...(status?{httpStatus:Number(status[1])}:{}),outcome:'undetermined',safeToRetry:false};try{await db.prepare("UPDATE operations SET result = ? WHERE id = ? AND state = 'pending'").bind(JSON.stringify({...e,diagnostic}),journalId).run();}catch{/* Preserve lock even when diagnostics cannot be saved. */}throw err;}paymentId=id.parse(response.bankPayments?.[0]?.id);}
 const after=await paymentSnapshot(read,org,paymentId);return completedPayment(after,e,a.reasoning);
 }));
 }catch(e){return errorResult(nativeFailure??e);}};}

export async function fxAdjustmentGuard(read:BillyClient,db:JournalDB|undefined,org:string,a:any){try{
 if(!db)throw new NoWriteError('Test journal disabled');z.string().uuid().parse(a.operationId);id.parse(a.paymentId);id.parse(a.subjectId);id.parse(a.differenceAccountId);z.iso.date().parse(a.entryDate);z.string().min(1).max(4000).parse(a.reasoning);z.string().min(1).parse(a.description);
 const before=await paymentSnapshot(read,org,a.paymentId);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read payment again');
 if(before.subjectType!==a.subjectType||before.subjectId!==a.subjectId||before.bankPayment.entryDate!==a.entryDate)throw new NoWriteError('Payment subject/date mismatch');
 const row=await db.prepare("SELECT fingerprint, state, result FROM operations WHERE state = 'complete' AND json_extract(fingerprint, '$.action') IN ('record_test_invoice_payment','record_test_bill_payment') AND json_extract(result, '$.bankPayment.id') = ?").bind(a.paymentId).first<any>();
 if(!row||!['record_test_invoice_payment','record_test_bill_payment'].includes(JSON.parse(row.fingerprint).action))throw new NoWriteError('Missing verified payment provenance');
 const saved=JSON.parse(row.result);if(!saved.fxAccountId||saved.currencyId==='DKK'||saved.bankPayment.organizationId!==org||a.differenceAccountId!==saved.fxAccountId||cents(a.sourceBaseAmount)!==saved.controlBaseAmount||cents(a.paidBaseAmount)!==cents(saved.bankPayment.cashAmount))throw new NoWriteError('Explicit FX inputs differ from verified payment');
 await offlineAccount(read,org,before.bankPayment.cashAccountId);const {account:fx}=await read.get('/accounts/'+a.differenceAccountId);if(fx?.id!==saved.fxAccountId||fx.organizationId!==org||fx.systemRole!=='realizedCurrencyDifference'||fx.currencyId!=='DKK'||fx.isArchived)throw new NoWriteError('Native FX account changed');
 verifyLedger(before,cents(saved.bankPayment.cashAmount),saved.bankPayment.cashAccountId,saved.controlAccountId,before.bankPayment.isVoided,saved);
 if((await paymentSnapshot(read,org,a.paymentId)).revision!==before.revision)throw new NoWriteError('Payment changed during verification');
 return jsonResult(await journalRun(db,org,a.operationId,'fx-check:'+a.paymentId,{action:'create_test_fx_adjustment_draft',...a},async()=>({draftCreated:false,nativeWrites:0,reason:before.bankPayment.isVoided?'payment_and_native_fx_fully_voided':'difference_already_recorded_by_Billy',paymentId:a.paymentId,sourceBaseAmount:a.sourceBaseAmount,paidBaseAmount:a.paidBaseAmount,nativeEvidence:{bankPayment:before.bankPayment,balanceModifiers:before.balanceModifiers,transactions:before.transactions,postings:before.postings,revision:before.revision},reasoning:a.reasoning})));
 }catch(e){return errorResult(e);}}
