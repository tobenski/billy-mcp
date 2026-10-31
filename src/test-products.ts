import type {BillyClient} from './billy-client.js';
import {journalRun,NoWriteError,type JournalDB} from './test-drafts.js';
import {canonical} from './test-vat-management.js';
import {sha256} from './test-files.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const productDescriptions:Record<string,string>={
 create_test_product:'Create a TEST product with explicit DKK revenue account and existing organization-owned sales-tax ruleset. Persistent operation identity and duplicate-name check. No default prices, invoices, messages or bookkeeping. Locally tested; live acceptance pending discovery refresh.',
 update_test_product:'Change supplied name/description/account/ruleset on a journal-proven active test product with fresh get_product revision. Preserves all native prices and unrelated fields. Locally tested; live acceptance pending.',
 archive_test_product:'Archive or restore a journal-proven test product with fresh get_product revision; no deletion, price changes or ledger writes. Locally tested; live acceptance pending.',
};
export async function productSnapshot(read:BillyClient,org:string,productId:string){
 id.parse(productId);const {organization}=await read.get('/organization');if(organization?.id!==org)throw new NoWriteError('Organization mismatch');
 const {product}=await read.get('/products/'+productId);if(product?.id!==productId||product.organizationId!==org)throw new NoWriteError('Unexpected product ownership');
 const prices=await read.fetchAll('/productPrices','productPrices',{productId});if(prices.some(p=>p.productId!==productId))throw new NoWriteError('Unexpected price ownership');
 const value={product,productPrices:[...prices].sort((a,b)=>a.id.localeCompare(b.id))};return{...value,revision:await sha256(new TextEncoder().encode(canonical(value)))};
}
export function productHandler(read:BillyClient,write:BillyClient,db:JournalDB,org:string,name:string){return async(a:any)=>{try{
 const create=name==='create_test_product',archive=name==='archive_test_product';if(!productDescriptions[name])throw new NoWriteError('Unknown product action');z.string().uuid().parse(a.operationId);z.string().min(1).max(4000).parse(a.reasoning);
 if(!create){id.parse(a.id);z.string().min(1).parse(a.expectedRevision);}if(archive)z.boolean().parse(a.isArchived);
 const patch:any={};for(const k of ['name','description','accountId','salesTaxRulesetId'])if(a[k]!==undefined)patch[k]=a[k];
 if(patch.name!==undefined)z.string().regex(/^TEST /).max(100).parse(patch.name);if(patch.description!==undefined)z.string().max(4000).nullable().parse(patch.description);
 if(!archive&&!Object.keys(patch).length)throw new NoWriteError('Supply product fields');
 const {organization}=await read.get('/organization');if(organization?.id!==org)throw new NoWriteError('Organization mismatch');
 return jsonResult(await journalRun(db,org,a.operationId,'products',{action:name,...a},async()=>{
 let before:any,payload:any;
 try{
 if(!create){before=await productSnapshot(read,org,a.id);if(before.revision!==a.expectedRevision)throw new NoWriteError('STALE_REVISION: read get_product again');
 const marker=/^mcp-test:([a-f0-9-]{36})$/.exec(before.product.productNo??'')?.[1];if(!marker)throw new NoWriteError('Expected test product');
 const row=await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(org+':'+marker).first<{fingerprint:string;state:string;result:string}>();
 if(row?.state!=='complete'||JSON.parse(row.fingerprint).action!=='create_test_product'||JSON.parse(row.result).product?.id!==a.id)throw new NoWriteError('Missing product provenance');
 if(!archive&&before.product.isArchived)throw new NoWriteError('Restore archived product first');}
 payload=archive?{isArchived:a.isArchived}:create?{organizationId:org,productNo:'mcp-test:'+a.operationId,isArchived:false,...patch}:patch;
 if(archive){if(before.product.isArchived===a.isArchived)throw new NoWriteError('Product already has requested state');}
 else{
 const candidate={...before?.product,...payload};z.string().regex(/^TEST /).max(100).parse(candidate.name);
 const {account}=await read.get('/accounts/'+id.parse(candidate.accountId));if(account?.id!==candidate.accountId||account.organizationId!==org||account.isArchived||account.isBankAccount||account.currencyId!=='DKK'||account.natureId!=='revenue')throw new NoWriteError('Expected active DKK revenue account');
 const {salesTaxRuleset}=await read.get('/salesTaxRulesets/'+id.parse(candidate.salesTaxRulesetId));if(salesTaxRuleset?.id!==candidate.salesTaxRulesetId||salesTaxRuleset.organizationId!==org)throw new NoWriteError('Unexpected tax ruleset');
 const products=await read.fetchAll('/products','products',{organizationId:org});for(const p of products){if(p.organizationId!==org)throw new NoWriteError('Unexpected product organization');if(p.id!==a.id&&p.name?.normalize('NFKC').trim().toLowerCase()===candidate.name.normalize('NFKC').trim().toLowerCase())throw new NoWriteError('Duplicate product name; reuse existing product');}
 }
 if(before&&(await productSnapshot(read,org,a.id)).revision!==before.revision)throw new NoWriteError('Product changed during preflight');
 }catch(e){if(e instanceof NoWriteError)throw e;throw new NoWriteError('Product preflight failed; no write performed');}
 let productId=a.id;if(create){const r=await write.post('/products',{product:payload});productId=id.parse(r.products?.[0]?.id);}else await write.put('/products/'+a.id,{product:payload});
 const after=await productSnapshot(read,org,productId);
 for(const [k,v] of Object.entries(payload))if(!(v===null&&(after.product[k]===null||after.product[k]===''))&&after.product[k]!==v)throw Error('Product readback mismatch: '+k);
 if(before){const omit=(p:any)=>Object.fromEntries(Object.entries(p).filter(([k])=>![...Object.keys(payload),'updatedTime'].includes(k)));if(canonical(omit(before.product))!==canonical(omit(after.product))||canonical(before.productPrices)!==canonical(after.productPrices))throw Error('Unrelated product fields/prices changed');}
 else if(after.productPrices.length)throw Error('Unexpected automatically created product prices');
 return{...after,reasoning:a.reasoning,ledgerChanges:false};
 }));
 }catch(e){return errorResult(e);}};}
