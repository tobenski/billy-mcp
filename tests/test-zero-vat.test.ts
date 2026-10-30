import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standardVatRates,verifyVatPostings} from '../src/test-vat.js';
const cases=[
 ['s_dk_non_eu_goods','world',false,'dk_rubrik_c_all'],
 ['s_dk_non_eu_services','world',false,'dk_rubrik_c_all'],
 ['s_dk_0','local',false,'dk_rubrik_c_all'],
 ['s_dk_vat_exempt','local',false,null],
 ['p_dk_no_deduction','local',true,null],
] as const;
function fixture(c:typeof cases[number],patch:any={}){
 const [tag,group,purchase,meta]=c;
 const rate={id:'vat',organizationId:'org',isActive:true,isPredefined:true,predefinedTag:tag,taxRateGroup:group,rate:0,isMissingStandardTaxRate:false,appliesToPurchases:purchase,appliesToSales:!purchase,netAmountMetaFieldId:meta?'rubrik':null,...patch.rate};
 return {async fetchAll(p:string){if(p==='/taxRates')return[rate];if(p==='/salesTaxMetaFields')return[{id:'rubrik',organizationId:'org',isPredefined:true,predefinedTag:meta,...patch.field}];if(p==='/taxRateDeductionComponents')return patch.components??[];throw Error(p);},async get(p:string){throw Error('Unexpected account read '+p);}} as any;
}
for(const c of cases){
 test(c[0]+' preserves full amount, tax code and no tax legs for booking and reversal',async()=>{
 const rates=await standardVatRates(fixture(c),'org',[{taxRateId:'vat'}]);
 for(const side of ['debit','credit'])for(const amount of [999.95,0.01]){
 const l={accountId:c[2]?'expense':'sales',amount,side,currencyId:'DKK',taxRateId:'vat'};verifyVatPostings([l],[l],rates);
 for(const patch of [{amount:amount+0.01},{taxRateId:null},{salesTaxReturnId:'return'},{currencyId:'EUR'},{side:side==='debit'?'credit':'debit'}])assert.throws(()=>verifyVatPostings([l],[{...l,...patch}],rates));
 assert.throws(()=>verifyVatPostings([l],[l,{...l,accountId:'tax',amount:1,salesTaxReturnId:'return'}],rates));
 }
 });
 test(c[0]+' rejects wrong configuration and enforces distinct turnover mapping',async()=>{
 for(const patch of [{rate:{rate:0.25}},{rate:{isActive:false}},{rate:{isPredefined:false}},{rate:{organizationId:'other'}},{rate:{predefinedTag:'unknown'}},{rate:{taxRateGroup:c[1]==='world'?'local':'world'}},{rate:{appliesToPurchases:!c[2]}},{rate:{appliesToSales:c[2]}},{components:[{taxRateId:'vat',source:'tax',share:1,accountId:'tax'}]},...(c[3]?[{rate:{netAmountMetaFieldId:null}},{rate:{netAmountMetaFieldId:'missing'}},{field:{organizationId:'other'}},{field:{isPredefined:false}},...['dk_rubrik_a_goods','dk_rubrik_b_goods','dk_rubrik_b_goods_none','dk_rubrik_b_services'].map(predefinedTag=>({field:{predefinedTag}}))]:[{rate:{netAmountMetaFieldId:'rubrik'}}])])await assert.rejects(standardVatRates(fixture(c,patch),'org',[{taxRateId:'vat'}]));
 });
}
