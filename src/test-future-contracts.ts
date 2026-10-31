import * as z from 'zod/v4';
// Reserved interfaces only. No client, credentials, journal or side effects.
const id=z.string().min(1).max(100), date=z.iso.date(), currency=z.string().regex(/^[A-Z]{3}$/);
const write={operationId:z.string().uuid(),reasoning:z.string().min(1).max(4000)};
const revision={expectedRevision:z.string().min(1)};
const money=z.number().positive().max(1_000_000);
const line=z.object({description:z.string().min(1),accountId:id,productId:id.optional(),quantity:z.number().positive(),unitPrice:money,taxRateId:id.nullable(),amountBasis:z.enum(['gross','net'])}).strict();
const document={contactId:id,entryDate:date,dueDate:date,currencyId:currency,exchangeRate:z.number().positive().optional(),description:z.string().min(1),lines:z.array(line).min(1).max(100),attachmentIds:z.array(id).max(5).optional()};
const def=(name:string,purpose:string,shape:z.ZodRawShape,mutation=false,destructive=false)=>({name,purpose,schema:z.object(shape).strict(),mutation,destructive});
export const futureTools=[
 ...(['invoice','bill'] as const).flatMap(kind=>[
  def(`create_test_${kind}_draft`,`Create a test ${kind} draft with explicit contact, currency, tax and lines. Native mapping/readback not yet implemented; never sends documents.`,{...write,...document},true),
  def(`update_test_${kind}_draft`,`Replace supplied fields of a test ${kind} draft, preserving unrelated data. Native revision and readback not yet implemented.`,{...write,...revision,id,...Object.fromEntries(Object.entries(document).map(([k,s])=>[k,s.optional()]))},true),
  def(`delete_test_${kind}_draft`,`Delete only a test-tool-created ${kind} draft after native revision and draft-state verification.`,{...write,...revision,id},true,true),
  def(`book_test_${kind}_draft`,`Book one test ${kind} draft with native posting verification. Does not send email/e-invoices or initiate payments.`,{...write,...revision,id},true,true),
 ]),
 def('create_test_credit_note_draft','Prepare a credit note against an explicit test invoice; verify remaining creditable amounts. No delivery.',{...write,...revision,invoiceId:id,entryDate:date,description:z.string(),lines:z.array(line).min(1).max(100)},true),
 ...(['invoice','bill'] as const).map(kind=>def(`record_test_${kind}_payment`,`Record an existing payment against a test ${kind}. Not a bank transfer. Native allocations, currencies and reversal semantics still require implementation.`,{...write,...revision,id,accountId:id,entryDate:date,amount:money,currencyId:currency,baseAmount:money},true,true)),
 def('record_test_vat_payment','Record an existing tax payment in Billy; no transfer or authority submission. Native payment fields and readback require validation.',{...write,...revision,returnId:id,accountId:id,entryDate:date},true,true),
 def('void_test_vat_payment','Void an existing synthetic test tax-payment record with native ledger verification. Never cancels a bank transfer.',{...write,...revision,paymentId:id},true,true),
 def('create_test_fx_adjustment_draft','Prepare explicit exchange-gain/loss draft for a test invoice/bill payment. No inferred rates or automatic booking.',{...write,...revision,subjectType:z.enum(['invoice','bill']),subjectId:id,paymentId:id,entryDate:date,sourceBaseAmount:money,paidBaseAmount:money,differenceAccountId:id,description:z.string()},true),
 def('reconcile_test_bank_allocations','Link explicit split allocations and optional fee/difference to one test bank line. Requires native allocation and reversal validation.',{...write,...revision,bankLineId:id,allocations:z.array(z.object({subjectReference:z.string().min(1),amount:money,side:z.enum(['debit','credit'])}).strict()).min(1).max(20),fee:z.object({amount:money,accountId:id}).strict().optional()},true),
 def('get_test_historical_exchange_rate','Read a documented native historical rate and source date. Native endpoint unverified; current rates must never masquerade as historical rates.',{currencyId:currency,date}),
 def('get_test_eu_sales_report','Read a native EU-sales list by customer/VAT ID. Native endpoint unverified; Rubrik B totals are not an EU-sales list. No MCP aggregation.',{from:date,to:date,...{page:z.number().int().positive().optional()}}),
 def('get_test_oss_configuration','Read verified native OSS configuration, country-specific accounts/tax rules and reporting scope. Native mapping unverified.',{}),
 def('get_test_oss_report','Read a native OSS report for an explicit period/country. Native endpoint unverified; no reconstructed MCP report or authority submission.',{from:date,to:date,countryCode:z.string().regex(/^[A-Z]{2}$/).optional()}),
 def('archive_test_contact','Archive/unarchive a test-marked contact with revision, ownership and native readback checks.',{...write,...revision,id,isArchived:z.boolean()},true),
];
