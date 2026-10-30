import {test} from 'node:test';
import assert from 'node:assert/strict';
import {posted,validate} from '../src/test-finalize.js';
import {standardVatRates} from '../src/test-vat.js';
function fixture(tag:string,side:string){
 const rate={id:'vat',predefinedTag:tag,deductionComponents:[{accountId:'tax',source:'tax',share:1}]};
 const opposite=side==='debit'?'credit':'debit';
 const lines=[{accountId:'net',amount:125.08,baseAmount:935.79,currencyId:'EUR',taxRateId:'vat',side,text:'EUR gross'},{accountId:'bank',amount:935.79,currencyId:'DKK',side:opposite,text:'DKK counterline'}];
 const snapshot={daybookTransaction:{id:'draft',state:'approved',apiType:'mcp-test:fixture',entryDate:'2026-10-30'},daybookTransactionLines:lines};
 const transaction={id:'tx',organizationId:'org',originatorReference:'daybookTransaction:draft'};
 const postings=[{...lines[0],currencyId:'DKK',amount:748.63,baseAmount:748.63},{...lines[0],currencyId:'DKK',accountId:'tax',amount:187.16,baseAmount:187.16,salesTaxReturnId:'period'},{...lines[1],baseAmount:935.79}].map((p,i)=>({...p,id:'p'+i,organizationId:'org',transactionId:'tx',entryDate:'2026-10-30',isVoided:false,exchangeRate:1}));
 return {rate,snapshot,transaction,postings};
}
test('EUR K/S booking verifies VAT from gross DKK cents on both original and reversal sides',async()=>{for(const tag of ['p_dk_25','s_dk_25'])for(const side of ['debit','credit']){const f=fixture(tag,side);validate(f.snapshot,'approved',true,true);await posted({fetchAll:async()=>f.postings} as any,'org',f.snapshot,f.transaction,[f.rate]);}});
test('EUR VAT rejects wrong rounding order, conversion, missing period and unsupported codes',async()=>{for(const bad of ['rounding','currency','period','rate','tag']){const f=fixture('p_dk_25','debit');if(bad==='rounding'){f.postings[0].amount=748.60;f.postings[0].baseAmount=748.60;f.postings[1].amount=187.19;f.postings[1].baseAmount=187.19;}if(bad==='currency')f.postings[1].currencyId='EUR';if(bad==='period')delete (f.postings[1] as any).salesTaxReturnId;if(bad==='rate')f.postings[1].exchangeRate=7.5;if(bad==='tag')f.rate.predefinedTag='p_dk_eu_goods_full';await assert.rejects(posted({fetchAll:async()=>f.postings} as any,'org',f.snapshot,f.transaction,[f.rate]));}});
test('EUR standard-rate preflight rejects KR and EU tags before fetching deduction components',async()=>{for(const predefinedTag of ['p_dk_representation_full','p_dk_eu_goods_full','s_dk_eu_services']){let calls=0;const read:any={fetchAll:async()=>{calls++;return[{id:'vat',predefinedTag}];}};await assert.rejects(standardVatRates(read,'org',[{currencyId:'EUR',taxRateId:'vat'}]),/only ordinary/);assert.equal(calls,1);}});
