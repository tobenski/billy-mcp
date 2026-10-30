import {test} from 'node:test';
import assert from 'node:assert/strict';
import {standardVatRates,verifyVatPostings} from '../src/test-vat.js';
function fixture(patch:any={}){
 const rate={id:'vat',organizationId:'org',isActive:true,isPredefined:true,predefinedTag:'p_dk_representation_full',taxRateGroup:'local',rate:0.25,isMissingStandardTaxRate:false,appliesToPurchases:true,appliesToSales:false,netAmountMetaFieldId:null,...patch.rate};
 const component={taxRateId:'vat',source:'tax',share:0.25,accountId:'input',...patch.component};
 return {async fetchAll(p:string){if(p==='/taxRates')return[rate];if(p==='/taxRateDeductionComponents')return patch.components??[component];throw Error(p);},async get(){return{account:{organizationId:'org',isArchived:false,currencyId:'DKK',isBankAccount:false,systemRole:'purchaseTax',...patch.account}};}} as any;
}
test('representation validates native quarter deduction and purchase tax account',async()=>{
 assert.equal((await standardVatRates(fixture(),'org',[{taxRateId:'vat'}]))[0].deductionComponents[0].share,0.25);
 for(const patch of [{rate:{rate:0.0625}},{rate:{isPredefined:false}},{rate:{isActive:false}},{rate:{organizationId:'other'}},{rate:{appliesToSales:true}},{rate:{appliesToPurchases:false}},{rate:{netAmountMetaFieldId:'rubrik'}},{rate:{taxRateGroup:'eu'}},{component:{share:1}},{component:{share:0.5}},{component:{source:'netAmount'}},{component:{taxRateId:'other'}},{components:[]},{account:{systemRole:'salesTax'}},{account:{isBankAccount:true}},{account:{organizationId:'other'}}])await assert.rejects(standardVatRates(fixture(patch),'org',[{taxRateId:'vat'}]));
});
test('representation leaves non-deductible VAT in expense with cent rounding and reversal',async()=>{
 const rates=await standardVatRates(fixture(),'org',[{taxRateId:'vat'}]);
 for(const side of ['debit','credit'])for(const [gross,expense,tax] of [[240,228,12],[999.95,949.95,50],[125.07,118.82,6.25],[125.08,118.82,6.26],[125.10,118.84,6.26],[0.01,0.01,0]]){
 const l={accountId:'restaurant',amount:gross,side,currencyId:'DKK',taxRateId:'vat'};
 const ps=[{...l,amount:expense},{...l,accountId:'input',amount:tax,salesTaxReturnId:'return'}];verifyVatPostings([l],ps,rates);
 for(const bad of [[{...ps[0],amount:expense-0.01},ps[1]],[ps[0],{...ps[1],amount:tax+0.01}],ps.map(p=>({...p,taxRateId:null})),[{...l,amount:gross/1.25},{...ps[1],amount:gross/5}]])assert.throws(()=>verifyVatPostings([l],bad,rates));
 }
});
