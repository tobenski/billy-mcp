import type {BillyClient} from './billy-client.js';
// Test-only transport: fixed host, two exact GET routes, no generic path or mutation.
export async function readBankIntegration(read:BillyClient,token:string,org:string,accountId?:string,signal?:AbortSignal){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(org)||!token)throw Error('Invalid integration configuration');
 const {organization}=await read.get('/organization');if(organization?.id!==org)throw Error('Test organization mismatch');
 if(accountId!==undefined){if(!/^[A-Za-z0-9_-]{1,100}$/.test(accountId))throw Error('Invalid account ID');const {account}=await read.get('/accounts/'+accountId);if(account?.organizationId!==org||account.id!==accountId||!account.isBankAccount)throw Error('Unexpected bank account');}
 const sources=[];
 for(const [kind,path,linkField] of [
 ['reconciliation','/reconciliation/organizations/'+org+'/bank-accounts','bookkeepingAccountId'],
 ['banking','/banking/'+org+'/accounts','externalAccountId'],
 ]){
  const fetchedAt=new Date().toISOString();
  try{
   const response=await fetch('https://api.billysbilling.com'+path,{method:'GET',headers:{'X-Access-Token':token,Accept:'application/json'},redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
   if(!response.ok){sources.push({kind,path,fetchedAt,available:false,httpStatus:response.status,reason:response.status===401||response.status===403?'api_token_access_denied':'upstream_unavailable'});continue;}
   const body=await response.text();if(body.length>1000000)throw Error('oversize');const native=JSON.parse(body);
   if(!Array.isArray(native.data)||native.data.some((x:any)=>!x||typeof x!=='object'||Array.isArray(x)||x.organizationId!==undefined&&x.organizationId!==org))throw Error('invalid schema or ownership');
   const records=accountId?native.data.filter((x:any)=>x[linkField]===accountId):native.data;
   sources.push({kind,path,fetchedAt,available:true,filter:accountId?{accountId,linkField}:null,native:{...native,data:records},recordCount:records.length,collectionPaginationVerified:false});
  }catch{sources.push({kind,path,fetchedAt,available:false,reason:'response_unverifiable_or_request_failed'});}
 }
 return{sources,mode:'read_only',normalization:'none',notes:['Empty data does not prove absence of a bank connection; collection completeness is not yet verified.','Raw provider balances retain their source units and currency. Reconciliation balance.value uses minor units in the public client; no conversion or sum is performed here.','fetchedAt is our read time, never the bank synchronization time.','No connection, refresh, consent, booking or reconciliation action is triggered.','Provider field semantics and a connected-bank positive result still require live verification.']};
}
