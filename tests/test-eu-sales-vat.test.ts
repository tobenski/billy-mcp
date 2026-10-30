import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standardVatRates,verifyVatPostings} from '../src/test-vat.js';
function fixture(goods:boolean,patch:any={}){
 const rate={id:'vat',organizationId:'org',isActive:true,isPredefined:true,predefinedTag:goods?'s_dk_eu_goods_rubrik_b':'s_dk_eu_services',taxRateGroup:'eu',rate:0,isMissingStandardTaxRate:false,appliesToPurchases:false,appliesToSales:true,netAmountMetaFieldId:'rubrik',...patch.rate};
 const field={id:'rubrik',organizationId:'org',isPredefined:true,predefinedTag:goods?'dk_rubrik_b_goods':'dk_rubrik_b_services',...patch.field};
 return {async fetchAll(p:string){if(p==='/taxRates')return[rate];if(p==='/salesTaxMetaFields')return[field];if(p==='/taxRateDeductionComponents')return patch.components??[];throw Error(p);},async get(p:string){throw Error('Unexpected account read '+p);}} as any;
}
for(const goods of [true,false]){
 test(`EU sales ${goods?'goods':'services'} preserve exact gross and code in sale and reversal without tax legs`,async()=>{
  const rates=await standardVatRates(fixture(goods),'org',[{taxRateId:'vat'}]);
  for(const side of ['credit','debit']){
   const line={accountId:'sales',amount:999.95,side,currencyId:'DKK',taxRateId:'vat'};
   verifyVatPostings([line],[{...line,baseAmount:999.95,exchangeRate:1}],rates);
   for(const patch of [{amount:999.94},{taxRateId:null},{salesTaxReturnId:'unexpected'},{side:side==='credit'?'debit':'credit'}])assert.throws(()=>verifyVatPostings([line],[{...line,...patch}],rates));
   assert.throws(()=>verifyVatPostings([line],[line,{...line,accountId:'tax',amount:249.99,salesTaxReturnId:'return'}],rates));
  }
 });
 test(`EU sales ${goods?'goods':'services'} reject wrong Rubrik, applicability, rate and tax components`,async()=>{
  for(const patch of [
   ...['dk_rubrik_b_goods_none','dk_rubrik_c_all','dk_rubrik_a_goods',goods?'dk_rubrik_b_services':'dk_rubrik_b_goods'].map(predefinedTag=>({field:{predefinedTag}})),
   {field:{organizationId:'other'}},{field:{isPredefined:false}},
   {rate:{netAmountMetaFieldId:'missing'}},{rate:{appliesToPurchases:true}},{rate:{appliesToSales:false}},
   {rate:{rate:0.25}},{rate:{isActive:false}},{rate:{taxRateGroup:'world'}},{rate:{predefinedTag:'s_dk_non_eu_goods'}},
   {components:[{taxRateId:'vat',source:'tax',share:1,accountId:'tax'}]}
  ])await assert.rejects(standardVatRates(fixture(goods,patch),'org',[{taxRateId:'vat'}]));
 });
}
