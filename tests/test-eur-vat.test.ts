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
test('EUR VAT rejects wrong rounding order, conversion, missing period and unsupported codes',async()=>{for(const bad of ['rounding','currency','period','rate']){const f=fixture('p_dk_25','debit');if(bad==='rounding'){f.postings[0].amount=748.60;f.postings[0].baseAmount=748.60;f.postings[1].amount=187.19;f.postings[1].baseAmount=187.19;}if(bad==='currency')f.postings[1].currencyId='EUR';if(bad==='period')delete (f.postings[1] as any).salesTaxReturnId;if(bad==='rate')f.postings[1].exchangeRate=7.5;if(bad==='tag')f.rate.predefinedTag='p_dk_eu_goods_full';await assert.rejects(posted({fetchAll:async()=>f.postings} as any,'org',f.snapshot,f.transaction,[f.rate]));}});
test('foreign standard-rate preflight rejects unknown custom code',async()=>{const read:any={fetchAll:async()=>[{id:'vat',predefinedTag:'custom'}]};await assert.rejects(standardVatRates(read,'org',[{currencyId:'USD',taxRateId:'vat'}]));});

import {assertBookingDateOpen} from '../src/test-period-guard.js';
test('fiscal lock is inclusive and prevents booking; unknown lock date fails closed',()=>{assert.doesNotThrow(()=>assertBookingDateOpen({fiscalLockingDate:'2026-09-30'},'2026-10-01'));for(const org of [{fiscalLockingDate:'2026-10-01'},{fiscalLockingDate:'2026-12-31'},{fiscalLockingDate:'invalid'},{isLocked:true}])assert.throws(()=>assertBookingDateOpen(org,'2026-10-01'));});

test('settled VAT periods refuse inclusive dates; unrelated open periods are allowed',async()=>{const {assertVatPeriodsOpen}=await import('../src/test-period-guard.js');const period={organizationId:'org',startDate:'2026-07-01',endDate:'2026-09-30',isSettled:true};for(const date of ['2026-07-01','2026-09-30'])assert.throws(()=>assertVatPeriodsOpen([period],'org',date),/settled/);assert.doesNotThrow(()=>assertVatPeriodsOpen([period],'org','2026-10-01'));assert.doesNotThrow(()=>assertVatPeriodsOpen([{...period,isSettled:false}],'org','2026-09-30'));assert.throws(()=>assertVatPeriodsOpen([{...period,organizationId:'other'}],'org','2026-10-01'));});
