import type {BillyClient} from './billy-client.js';
import {NoWriteError} from './test-drafts.js';
// Deployment-only allowlist, bound to one request's client and organization.
// Never inferred from editable text, a caller-supplied flag or a forged apiType.
const scopes=new WeakMap<object,{org:string;ids:Set<string>}>();
export function configureManualCorrections<T extends BillyClient>(client:T,org:string,ids:string|undefined):T {
 const values=(ids??'').split(',').map(x=>x.trim()).filter(Boolean);
 if(values.length>100||values.some(x=>!/^[A-Za-z0-9_-]{1,100}$/.test(x)))throw Error('Invalid manual correction deployment scope');
 scopes.set(client,{org,ids:new Set(values)});return client;
}
export function manualCorrectionAllowed(client:BillyClient,org:string,header:any):boolean {
 const scope=scopes.get(client);
 return !!scope&&scope.org===org&&header.organizationId===org&&scope.ids.has(header.id)&&header.apiType==null;
}
export function expandManualDkkLines(snapshot:any){
 const lines:any[]=[];
 for(const l of snapshot.daybookTransactionLines){
  if(l.currencyId!=='DKK'||l.contraTaxRateId||l.paidInvoiceId||l.paidBillId||l.paidExternalInvoiceId)throw new NoWriteError('Manual corrections support DKK without contra VAT or linked payments');
  if(l.contraAccountId){
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(l.contraAccountId)||l.contraAccountId===l.accountId||!['debit','credit'].includes(l.side))throw new NoWriteError('Invalid manual contra account');
   lines.push({...l,contraAccountId:null});
   lines.push({...l,id:l.id+':contra',accountId:l.contraAccountId,contraAccountId:null,taxRateId:null,side:l.side==='debit'?'credit':'debit'});
  }else lines.push({...l});
 }
 // The original header and raw snapshot revision remain part of source evidence.
 return {...snapshot,daybookTransactionLines:lines};
}
