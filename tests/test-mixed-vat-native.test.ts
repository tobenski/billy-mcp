import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyVatPostings} from '../src/test-vat.js';
// Native Billy outputs captured from synthetic live transactions 64-67, 2026-10-30.
// Identifiers are replaced with stable aliases; amounts, codes and sides are unchanged.
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/mixed-vat-native.json',import.meta.url),'utf8'));
for(const f of fixtures)test('native mixed VAT regression: '+f.name,()=>{
 verifyVatPostings(f.lines,f.postings,f.rates);
 const reverse=(rows:any[])=>rows.map(p=>({...p,side:p.side==='debit'?'credit':'debit'}));
 verifyVatPostings(reverse(f.lines),reverse(f.postings),f.rates);
 assert.throws(()=>verifyVatPostings(f.lines,f.postings.slice(1),f.rates));
 assert.throws(()=>verifyVatPostings(f.lines,f.postings.map((p:any,i:number)=>i===0?{...p,amount:p.amount+0.01}:p),f.rates));
 assert.throws(()=>verifyVatPostings(f.lines,f.postings.map((p:any)=>({...p,taxRateId:null})),f.rates));
 const index=f.postings.findIndex((p:any)=>p.salesTaxReturnId);
 assert.ok(index>=0);
 assert.throws(()=>verifyVatPostings(f.lines,f.postings.map((p:any,i:number)=>i===index?{...p,salesTaxReturnId:null}:p),f.rates));
});
