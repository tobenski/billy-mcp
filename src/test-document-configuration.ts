import type {BillyClient} from './billy-client.js';
import {canonical} from './test-vat-management.js';
// One invocation only. These handlers never mutate configuration resources.
// Documents, attachments, allocations, transactions, postings and period locks
// always go back to Billy; revision/final-state checks must never use this cache.
const singles=/^\/(organization|contacts\/[A-Za-z0-9_-]+|products\/[A-Za-z0-9_-]+|accounts\/[A-Za-z0-9_-]+|salesTaxRulesets\/[A-Za-z0-9_-]+|countryGroups\/[A-Za-z0-9_-]+)$/;
const collections=new Set(['/accounts','/taxRates','/taxRateDeductionComponents','/salesTaxRules','/salesTaxMetaFields']);
export function documentConfigurationRead(read:BillyClient):BillyClient{
 const cache=new Map<string,Promise<any>>();
 const memo=async(key:string,run:()=>Promise<any>)=>{let value=cache.get(key);if(!value){if(cache.size>=64)throw Error('Document configuration request bound exceeded');value=run();cache.set(key,value);}return structuredClone(await value);};
 return new Proxy(read,{get(target,property){
 if(property==='get')return(path:string,...args:any[])=>singles.test(path)?memo('get:'+canonical([path,args]),()=>target.get(path,...args)):target.get(path,...args);
 if(property==='fetchAll')return(path:string,resource:string,...args:any[])=>collections.has(path)?memo('all:'+canonical([path,resource,args]),()=>target.fetchAll(path,resource,...args)):target.fetchAll(path,resource,...args);
 const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
}

// A previously posted credit is rechecked for its financial content and ledger.
// Its attachments cannot change the remaining creditable amount. Avoid fetching
// them twice per prior credit while retaining fresh header/line reads on both
// sides of ledger verification. This snapshot is never exposed as a user revision.
export async function priorCreditFinancialSnapshot(read:BillyClient,org:string,kind:'invoice'|'bill',id:string){
 const response=await read.get('/'+kind+'s/'+id),header=response[kind];if(header?.id!==id||header.organizationId!==org)throw Error('Unexpected prior credit ownership');
 const lines=await read.fetchAll('/'+kind+'Lines',kind+'Lines',{[kind+'Id']:id});if(lines.some(l=>l[kind+'Id']!==id))throw Error('Unexpected prior credit line ownership');lines.sort((a,b)=>(a.priority??0)-(b.priority??0)||a.id.localeCompare(b.id));
 const {downloadUrl,...stable}=header;const value={[kind]:stable,[kind+'Lines']:lines,attachments:[]};return{...value,revision:canonical(value)} as any;
}
