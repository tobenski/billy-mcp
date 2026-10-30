import type {BillyClient} from './billy-client.js';
import {NoWriteError} from './test-drafts.js';
import * as z from 'zod/v4';
const validId=(id:any)=>z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(id);
export const euSalesTags=new Set(['s_dk_eu_goods_rubrik_b','s_dk_eu_services']);
export const euPurchaseTags=new Set(['p_dk_eu_goods_full','p_dk_eu_services_full']);
export const reverseChargeTags=new Set([...euPurchaseTags,'p_dk_non_eu_services_full','p_dk_reverse_full']);
export const importGoodsTag='p_dk_non_eu_goods_full';
export async function standardVatRates(read:BillyClient,orgId:string,lines:any[]){
 const taxIds=new Set<string>(lines.map(l=>l.taxRateId).filter(Boolean));
 const taxRates:any[]=[];if(!taxIds.size)return taxRates;
 const rates=await read.fetchAll('/taxRates','taxRates',{organizationId:orgId});
 let metaFields:any[]|undefined;const accounts=new Map<string,any>();
 for(const taxId of taxIds){
 const rate=rates.find((r:any)=>r.id===taxId);
 const euSale=euSalesTags.has(rate?.predefinedTag),eu=euSale||euPurchaseTags.has(rate?.predefinedTag),reverse=reverseChargeTags.has(rate?.predefinedTag),importGoods=rate?.predefinedTag===importGoodsTag;
 const zero=reverse||importGoods||euSale;const group=eu?'eu':rate?.predefinedTag?.startsWith('p_dk_non_eu_')?'world':'local';
 if(!rate||rate.organizationId!==orgId||rate.isActive!==true||rate.isPredefined!==true||rate.rate!==(zero?0:0.25)||rate.taxRateGroup!==group||(!zero&&!['p_dk_25','s_dk_25'].includes(rate.predefinedTag))||rate.isMissingStandardTaxRate!==false)throw new NoWriteError('Only supported purchase VAT, EU sales and standard Danish VAT codes are supported');
 const purchase=!euSale&&(zero||rate.predefinedTag==='p_dk_25');
 if(rate.appliesToPurchases!==purchase||rate.appliesToSales!==!purchase)throw new NoWriteError('Unexpected VAT applicability');
 if(eu){
 validId(rate.netAmountMetaFieldId);
 metaFields??=await read.fetchAll('/salesTaxMetaFields','salesTaxMetaFields',{organizationId:orgId});
 const field=metaFields.find(f=>f.id===rate.netAmountMetaFieldId);
 const expected=euSale?(rate.predefinedTag==='s_dk_eu_goods_rubrik_b'?'dk_rubrik_b_goods':'dk_rubrik_b_services'):(rate.predefinedTag==='p_dk_eu_goods_full'?'dk_rubrik_a_goods':'dk_rubrik_a_services');
 if(field?.organizationId!==orgId||field.isPredefined!==true||field.predefinedTag!==expected)throw new NoWriteError('EU VAT requires correct native Rubrik A/B mapping');
 }
 if(zero&&!eu&&rate.netAmountMetaFieldId!=null)throw new NoWriteError('Non-EU/domestic reverse-charge purchases must not map to Rubrik A');
 const components=await read.fetchAll('/taxRateDeductionComponents','taxRateDeductionComponents',{taxRateId:taxId});
 if(reverse){
 if(components.length!==2||components.some((c:any)=>c.taxRateId!==taxId||c.source!=='netAmount')||components.filter((c:any)=>c.share===0.25).length!==1||components.filter((c:any)=>c.share===-0.25).length!==1||components[0].accountId===components[1].accountId)throw new NoWriteError('Reverse-charge purchases require full +25%/-25% netAmount components');
 }else if(euSale){if(components.length!==0)throw new NoWriteError('EU sales require zero VAT deduction components');}
 else if(importGoods){if(components.length!==0)throw new NoWriteError('Non-EU goods invoice must not calculate import VAT; use separate import specification');}
 else if(components.length!==1||components[0].taxRateId!==taxId||components[0].source!=='tax'||components[0].share!==1)throw new NoWriteError('Only full standard VAT deduction components supported');
 for(const component of components){
 validId(component.accountId);
 if(!accounts.has(component.accountId))accounts.set(component.accountId,(await read.get('/accounts/'+component.accountId)).account);
 const account=accounts.get(component.accountId);
 if(account?.organizationId!==orgId||account.isArchived||account.currencyId&&account.currencyId!=='DKK')throw new NoWriteError('Invalid VAT account');
 if(reverse){const role=component.share>0?'purchaseTax':rate.predefinedTag==='p_dk_eu_goods_full'?'euTaxGoods':rate.predefinedTag==='p_dk_reverse_full'?'salesTax':'euTaxServices';if(account.systemRole!==role||account.isBankAccount!==false)throw new NoWriteError('Unexpected reverse-charge VAT account role');}
 }
 taxRates.push({...rate,deductionComponents:components});
 }
 return taxRates;
}

// Validation only: amounts sent to Billy remain gross and unchanged.
export function verifyVatPostings(lines:any[],postings:any[],rates:any[]){
 const cents=(n:any)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1000000||Math.abs(n*100-Math.round(n*100))>1e-7)throw new Error('Invalid native posting amount');return Math.round(n*100);};
 const expected:any[]=[];
 for(const line of lines){
 const gross=cents(line.amount);
 if(!line.taxRateId){expected.push(line);continue;}
 const rate=rates.find(r=>r.id===line.taxRateId);if(!rate)throw new Error('Missing verified VAT configuration');
 if(rate.predefinedTag===importGoodsTag||euSalesTags.has(rate.predefinedTag)){expected.push({...line});continue;}
 if(reverseChargeTags.has(rate.predefinedTag)){
 expected.push({...line});
 for(const c of rate.deductionComponents)expected.push({...line,accountId:c.accountId,amount:Math.round(gross/4)/100,side:c.share>0?line.side:line.side==='debit'?'credit':'debit',salesTaxReturnId:'expected'});
 continue;
 }
 const tax=Math.round(gross/5);
 expected.push({...line,amount:(gross-tax)/100},{...line,accountId:rate.deductionComponents[0].accountId,amount:tax/100,salesTaxReturnId:'expected'});
 }
 const totals=(rows:any[])=>{const result=new Map<string,number>();for(const p of rows){if(p.currencyId!=='DKK'||!['debit','credit'].includes(p.side)||typeof p.accountId!=='string')throw new Error('Invalid native posting currency/side/account');const n=cents(p.amount);if(p.baseAmount!=null&&cents(p.baseAmount)!==n||p.exchangeRate!=null&&p.exchangeRate!==1)throw new Error('Unexpected posting conversion');if(n){if(p.salesTaxReturnId!=null)validId(p.salesTaxReturnId);const k=p.accountId+':'+p.side+':'+(p.taxRateId??'')+':'+(p.salesTaxReturnId?'taxreturn':'none');result.set(k,(result.get(k)??0)+n);}}return JSON.stringify([...result].sort(([a],[b])=>a.localeCompare(b)));};
 for(const rate of rates.filter(r=>reverseChargeTags.has(r.predefinedTag))){const periods=new Set(postings.filter(p=>p.taxRateId===rate.id&&p.amount!==0&&rate.deductionComponents.some((c:any)=>c.accountId===p.accountId)).map(p=>p.salesTaxReturnId));if(periods.size>1)throw new Error('Reverse-charge VAT components refer to different tax periods');}
 if(totals(expected)!==totals(postings))throw new Error('Native VAT/net postings differ from expected supported VAT components');
}
