import {canonical} from './test-vat-management.js';
// Bills round account/VAT groups independently, then balance the remainder on
// one deduction component. This differs from daybook gross-line rounding.
export function verifyBillVat(lines:any[],postings:any[],rates:any[],payableId:string,gross:number,credit:boolean){
 const groups=new Map<string,any>();
 const add=(accountId:string,taxRateId:string|null,amount:number,vat:boolean)=>{const key=canonical([accountId,taxRateId,vat]);const row=groups.get(key)??{accountId,taxRateId,vat,raw:0};row.raw+=amount;groups.set(key,row);};
 for(const l of lines){const rate=rates.find(r=>r.id===l.taxRateId);if(l.taxRateId&&!rate)throw Error('Missing verified purchase VAT');const value=Math.round(l.amount*100),fullTax=rate?.rate===0.25?Math.round(value/5):0;let deducted=0;
 for(const c of rate?.deductionComponents??[]){const amount=(c.source==='tax'?fullTax:value-fullTax)*c.share;deducted+=amount;add(c.accountId,l.taxRateId,amount,true);}
 add(l.accountId,l.taxRateId??null,value-deducted,false);
 }
 const rows=[...groups.values()].map(r=>({...r,amount:Math.round(Math.abs(r.raw)),side:r.raw<0?'credit':'debit'}));
 rows.push({accountId:payableId,taxRateId:null,vat:false,raw:-gross,amount:gross,side:'credit'});
 const residual=rows.reduce((n,r)=>n+r.amount*(r.side==='debit'?1:-1),0);
 // Exact grouping arithmetic bounds the only permitted adjustment. No arbitrary
 // per-posting tolerance and no correction to expenses, control or output VAT.
 if(Math.abs(residual)>Math.ceil(rows.length/2))throw Error('Unexplained native bill rounding difference');
 const shape=(rs:any[])=>{const totals=new Map<string,number>();for(const r of rs){if(!['debit','credit'].includes(r.side)||!Number.isSafeInteger(r.amount)||r.amount<0)throw Error('Invalid bill VAT amount');if(!r.amount)continue;const side=credit?(r.side==='debit'?'credit':'debit'):r.side;const key=canonical([r.accountId,r.taxRateId??null,side,r.vat]);totals.set(key,(totals.get(key)??0)+r.amount);}return canonical([...totals].sort());};
 const native=postings.map(p=>{if(!['debit','credit'].includes(p.side)||typeof p.amount!=='number'||!Number.isFinite(p.amount)||Math.abs(p.amount*100-Math.round(p.amount*100))>1e-7)throw Error('Invalid native bill posting cents');return{accountId:p.accountId,taxRateId:p.taxRateId??null,side:credit?(p.side==='debit'?'credit':'debit'):p.side,amount:Math.round(p.amount*100),vat:!!p.salesTaxReturnId};});
 const actual=shape(native),periods=new Set(postings.filter(p=>p.salesTaxReturnId).map(p=>p.salesTaxReturnId));if(periods.size>1)throw Error('Bill VAT postings use different periods');
 if(!residual){if(shape(rows)!==actual)throw Error('Native bill VAT groups differ');return{roundingCorrectionCents:0};}
 for(let index=0;index<rows.length;index++){const r=rows[index];if(!r.vat||r.side!=='debit'||r.amount-residual<0)continue;const corrected=rows.map((x,i)=>i===index?{...x,amount:x.amount-residual}:x);if(shape(corrected)===actual)return{roundingCorrectionCents:-residual,accountId:r.accountId,taxRateId:r.taxRateId};}
 throw Error('Native bill VAT groups or exact balancing adjustment differ');
}
