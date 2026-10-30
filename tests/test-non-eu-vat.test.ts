import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standardVatRates,verifyVatPostings} from '../src/test-vat.js';
function fixture(tag:string,patch:any={}){
 const goods=tag==='p_dk_non_eu_goods_full',domestic=tag==='p_dk_reverse_full';
 const rate={id:'vat',organizationId:'org',isActive:true,isPredefined:true,predefinedTag:tag,taxRateGroup:domestic?'local':'world',rate:0,isMissingStandardTaxRate:false,appliesToPurchases:true,appliesToSales:false,netAmountMetaFieldId:null,...patch.rate};
 const components=goods?[]:[{taxRateId:'vat',source:'netAmount',share:0.25,accountId:'input'},{taxRateId:'vat',source:'netAmount',share:-0.25,accountId:'output'}];
 const read:any={async fetchAll(p:string){if(p==='/taxRates')return[rate];if(p==='/taxRateDeductionComponents')return patch.components??components;throw Error(p);},async get(p:string){return{account:{organizationId:'org',isArchived:false,currencyId:'DKK',isBankAccount:false,systemRole:p.endsWith('/input')?'purchaseTax':domestic?'salesTax':'euTaxServices',...patch.account}};}};
 return read;
}
test('non-EU services and domestic reverse charge validate distinct account roles with no Rubrik A',async()=>{
 for(const tag of ['p_dk_non_eu_services_full','p_dk_reverse_full']){
 const rates=await standardVatRates(fixture(tag),'org',[{taxRateId:'vat'}]);assert.equal(rates.length,1);
 for(const side of ['debit','credit']){const line={accountId:'cost',amount:100.02,side,currencyId:'DKK',taxRateId:'vat'};const postings=[line,{...line,accountId:'input',amount:25.01,salesTaxReturnId:'return'},{...line,accountId:'output',amount:25.01,side:side==='debit'?'credit':'debit',salesTaxReturnId:'return'}];verifyVatPostings([line],postings,rates);assert.throws(()=>verifyVatPostings([line],postings.slice(0,2),rates));}
 for(const patch of [{rate:{netAmountMetaFieldId:'rubrik'}},{rate:{rate:0.25}},{rate:{isActive:false}},{account:{systemRole:'euTaxGoods'}},{components:[]}])await assert.rejects(standardVatRates(fixture(tag,patch),'org',[{taxRateId:'vat'}]));
 }
});
test('non-EU goods invoice creates no tax legs and rejects auto-calculated import VAT',async()=>{
 const tag='p_dk_non_eu_goods_full',rates=await standardVatRates(fixture(tag),'org',[{taxRateId:'vat'}]);
 const line={accountId:'cost',amount:240,side:'debit',currencyId:'DKK',taxRateId:'vat'};verifyVatPostings([line],[line],rates);
 assert.throws(()=>verifyVatPostings([line],[line,{...line,accountId:'input',amount:60,salesTaxReturnId:'return'},{...line,accountId:'output',amount:60,side:'credit',salesTaxReturnId:'return'}],rates));
 await assert.rejects(standardVatRates(fixture(tag,{components:[{taxRateId:'vat',source:'netAmount',share:0.25,accountId:'input'}]}),'org',[{taxRateId:'vat'}]));
 await assert.rejects(standardVatRates(fixture(tag,{rate:{netAmountMetaFieldId:'rubrik'}}),'org',[{taxRateId:'vat'}]));
});
