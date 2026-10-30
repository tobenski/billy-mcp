import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standardVatRates,verifyVatPostings} from '../src/test-vat.js';
function fixture(kind='goods',patch:any={}){
 const rate={id:'eu',organizationId:'org',isActive:true,isPredefined:true,predefinedTag:`p_dk_eu_${kind}_full`,taxRateGroup:'eu',rate:0,isMissingStandardTaxRate:false,appliesToPurchases:true,appliesToSales:false,netAmountMetaFieldId:'rubrik',...patch.rate};
 const components=[{taxRateId:'eu',source:'netAmount',share:0.25,accountId:'input'},{taxRateId:'eu',source:'netAmount',share:-0.25,accountId:'output'}].map(c=>({...c,...patch.component}));
 const read:any={async fetchAll(p:string){if(p==='/taxRates')return[rate];if(p==='/salesTaxMetaFields')return[{id:'rubrik',organizationId:'org',isPredefined:true,predefinedTag:`dk_rubrik_a_${kind}`,...patch.meta}];if(p==='/taxRateDeductionComponents')return components;throw Error(p);},async get(p:string){return{account:{organizationId:'org',isArchived:false,currencyId:'DKK',isBankAccount:false,systemRole:p.endsWith('/input')?'purchaseTax':kind==='goods'?'euTaxGoods':'euTaxServices',...patch.account}};}};
 return {read,rate,components};
}
test('EU goods and services require native full deduction, account roles and correct Rubrik A',async()=>{
 for(const kind of ['goods','services']){const f=fixture(kind);const rates=await standardVatRates(f.read,'org',[{taxRateId:'eu'}]);assert.equal(rates.length,1);assert.equal(rates[0].deductionComponents[1].share,-0.25);}
 for(const patch of [{rate:{rate:0.25}},{rate:{predefinedTag:'p_dk_non_eu_services_full'}},{rate:{isActive:false}},{rate:{organizationId:'other'}},{component:{share:0.125}},{component:{accountId:'same'}},{component:{source:'tax'}},{meta:{predefinedTag:'dk_rubrik_a_services'}},{meta:{organizationId:'other'}},{account:{systemRole:'salesTax'}},{account:{isBankAccount:true}}])await assert.rejects(standardVatRates(fixture('goods',patch).read,'org',[{taxRateId:'eu'}]));
});
test('EU two tax legs round independently and reverse exactly, with unmodified invoice amount',async()=>{
 for(const kind of ['goods','services'])for(const side of ['debit','credit'])for(const [gross,tax] of [[240,60],[999.95,249.99],[100.02,25.01],[0.01,0]]){
 const f=fixture(kind),rates=await standardVatRates(f.read,'org',[{taxRateId:'eu'}]);
 const line={accountId:'cost',amount:gross,side,currencyId:'DKK',taxRateId:'eu'};
 const postings=[line,{...line,accountId:'input',amount:tax,salesTaxReturnId:'return'},{...line,accountId:'output',amount:tax,side:side==='debit'?'credit':'debit',salesTaxReturnId:'return'}];verifyVatPostings([line],postings,rates);
 if(tax){assert.throws(()=>verifyVatPostings([line],postings.map((p,i)=>i===2?{...p,salesTaxReturnId:'different'}:p),rates));assert.throws(()=>verifyVatPostings([line],postings.slice(0,2),rates));assert.throws(()=>verifyVatPostings([line],postings.map(p=>({...p,side})),rates));assert.throws(()=>verifyVatPostings([line],postings.map(p=>({...p,salesTaxReturnId:null})),rates));}
 assert.throws(()=>verifyVatPostings([line],[...postings,{...line,accountId:'wrong',amount:0.01}],rates));
 }
});
