import type {BillyClient} from './billy-client.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
export const euSalesDescription='Read the native Billy salesWithoutVat customer/VAT-number report for explicit inclusive dates. Native records and fields are preserved; no MCP totals or reconstruction from Rubrik B. Endpoint has no verified pagination: page omitted or1 only, maximum366 days. Native empty report live-verified. Report eligibility follows Billy invoice/contact/product configuration; an empty result is not proof of no EU sales. No authority submission.';
export function euSalesHandler(read:BillyClient,org:string){return async(a:any)=>{try{
 const from=z.iso.date().parse(a.from),to=z.iso.date().parse(a.to);if(from>to||Date.parse(to)-Date.parse(from)>365*86400000)throw Error('Use an ordered date range of at most366 inclusive days');if(a.page!==undefined&&a.page!==1)throw Error('Native EU-sales pagination is not verified; only page1 is supported');
 const {organization}=await read.get('/organization');if(organization?.id!==org||organization.countryId!=='DK'||organization.baseCurrencyId!=='DKK')throw Error('Expected Danish DKK test organization');
 const path='/organizations/'+org+'/salesWithoutVat',query={fromDate:from,toDate:to};const native=await read.get(path,query);
 if(native.meta?.success!==true||!Array.isArray(native.result))throw Error('Native EU-sales report missing; cannot substitute an empty result');
 if(native.result.length>10000||JSON.stringify(native).length>500000)throw Error('Native report too large; narrow date range');
 for(const row of native.result){if(!row||typeof row!=='object'||Array.isArray(row)||row.organizationId!=null&&row.organizationId!==org)throw Error('Unexpected native EU-sales row');for(const field of ['minDate','maxDate'])if(row[field]!=null){z.iso.date().parse(row[field]);if(row[field]<from||row[field]>to)throw Error('Native report row outside requested period');}}
 return jsonResult({organizationId:org,period:{from,to},source:{path,query},native,authoritySubmission:false,coverage:'native_invoice_based_EU_sales_list',notes:['All native fields and totals are preserved without MCP aggregation.','Billy eligibility depends on invoice, customer country/VAT number and product/account configuration.','Daybook Rubrik B totals are not a substitute for this invoice-based list.','Empty data is a native report result, not a completeness assurance.']});
 }catch(e){return errorResult(e);}};}
