import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyVatPostings} from '../src/test-vat.js';
const rates=[{id:'vat',deductionComponents:[{accountId:'vatAccount'}]}];
const line=(amount:number,accountId='expense',side='debit')=>({amount,accountId,side,currencyId:'DKK'});
test('gross VAT split checks both rounding directions and reversed sides',()=>{
 for(const side of ['debit','credit'])for(const [gross,net,tax] of [[125,100,25],[125.01,100.01,25],[125.03,100.02,25.01],[0.01,0.01,0]]){
 const lines=[{...line(gross,'expense',side),taxRateId:'vat'}];const postings=[{...line(net,'expense',side),taxRateId:'vat'},{...line(tax,'vatAccount',side),taxRateId:'vat',salesTaxReturnId:'return'}];verifyVatPostings(lines,postings,rates);
 assert.throws(()=>verifyVatPostings(lines,[postings[0],{...postings[1],amount:tax+0.01}],rates));
 }
});
test('VAT checks preserve account and direction, mixed untaxed lines and split postings',()=>{
 const ls=[{...line(125),taxRateId:'vat'},line(10,'other')];const ps=[{...line(60),taxRateId:'vat'},{...line(40),taxRateId:'vat'},{...line(25,'vatAccount'),taxRateId:'vat',salesTaxReturnId:'return'},line(10,'other')];verifyVatPostings(ls,ps,rates);
 for(const changed of [[...ps,line(1,'unexpected')],ps.map(p=>({...p,side:'credit'})),ps.map(p=>({...p,currencyId:'EUR'}))])assert.throws(()=>verifyVatPostings(ls,changed,rates));
});

test('correct monetary amounts do not hide missing tax codes or VAT return linkage',()=>{
 const ls=[{...line(125),taxRateId:'vat'}];const ps=[{...line(100),taxRateId:'vat'},{...line(25,'vatAccount'),taxRateId:'vat',salesTaxReturnId:'return'}];verifyVatPostings(ls,ps,rates);
 assert.throws(()=>verifyVatPostings(ls,ps.map(p=>({...p,taxRateId:null})),rates));
 assert.throws(()=>verifyVatPostings(ls,ps.map(p=>({...p,salesTaxReturnId:null})),rates));
 assert.throws(()=>verifyVatPostings(ls,ps.map(p=>({...p,exchangeRate:1.1})),rates));
});
