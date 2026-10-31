import type {BillyClient} from './billy-client.js';
import {jsonResult,errorResult} from './tools/helpers.js';
import * as z from 'zod/v4';
export const historicalRateDescription='Read an exact-date official Danmarks Nationalbank reference rate from Statistics Denmark table DNVALD, not a Billy stored rate. EUR/USD/GBP/SEK/NOK. Value remains DKK per100 source units with native JSON-STAT evidence; no conversion or automatic accounting rate selection. Missing dates/observations return available=false, never latest/previous rate or zero. Public query sends only currency/date, no Billy credentials or accounting data.';
const api='https://api.statbank.dk/v1/';
async function query(fetcher:typeof fetch,resource:'tableinfo'|'data',payload:any){
 const r=await fetcher(api+resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Official rate source returned HTTP '+r.status);const reader=r.body?.getReader();if(!reader)throw Error('Missing official response');let text='',length=0;const decoder=new TextDecoder();
 try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>2000000){await reader.cancel();throw Error('Official response exceeds size limit');}text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 return JSON.parse(text);
}
export function historicalRateHandler(read:BillyClient,org:string,fetcher:typeof fetch=fetch){return async(a:any)=>{try{
 const currencyId=z.enum(['EUR','USD','GBP','SEK','NOK']).parse(a.currencyId),date=z.iso.date().parse(a.date);const code=date.slice(0,4)+'M'+date.slice(5,7)+'D'+date.slice(8,10);
 const {organization}=await read.get('/organization');if(organization?.id!==org)throw Error('Test organization mismatch');
 const info=await query(fetcher,'tableinfo',{table:'DNVALD',format:'JSON',lang:'en'});if(info.id!=='DNVALD'||!Array.isArray(info.variables))throw Error('Unexpected official rate metadata');
 const variable=(id:string)=>{const found=info.variables.filter((v:any)=>v.id===id);if(found.length!==1||!Array.isArray(found[0].values))throw Error('Missing/ambiguous rate dimension');return found[0];};
 const currency=variable('VALUTA').values.find((v:any)=>v.id===currencyId),type=variable('KURTYP').values.find((v:any)=>v.id==='KBH'),time=variable('Tid').values.find((v:any)=>v.id===code);
 if(!currency||!type||type.text!=='Exchange rates (DKK per 100 units of foreign currency)')throw Error('Official currency/unit mapping not verified');
 const source={publisher:'Danmarks Nationalbank',provider:'Statistics Denmark StatBank API',table:'DNVALD',url:'https://www.statistikbanken.dk/DNVALD',api,metadataUpdated:info.updated,currency,type};
 const base={currencyId,requestedDate:date,baseCurrencyId:'DKK',quoteUnit:'DKK_per_100_source_units',source,isBillyRate:false,automaticallyApplied:false,notes:['Official indicative reference rate; not proof of the actual transaction or Billy booking rate.','No currency conversion, previous-business-day selection or averaging is performed.']};
 if(!time)return jsonResult({...base,available:false,observationDate:null,value:null,reason:'date_not_published_in_source'});
 const request={table:'DNVALD',format:'JSONSTAT',lang:'en',valuePresentation:'Code',variables:[{code:'VALUTA',values:[currencyId]},{code:'KURTYP',values:['KBH']},{code:'Tid',values:[code]}]};
 const native=await query(fetcher,'data',request),d=native.dataset;if(d?.source!=='Danmarks Nationalbank'||d.extension?.px?.tableid!=='DNVALD')throw Error('Unexpected rate publisher/table');
 const expected:Record<string,string>={VALUTA:currencyId,KURTYP:'KBH',ContentsCode:'DNVALD',Tid:code};if(!Array.isArray(d.dimension?.id)||d.dimension.id.length!==4||new Set(d.dimension.id).size!==4||!Array.isArray(d.dimension.size)||d.dimension.size.length!==4||d.dimension.size.some((n:any)=>n!==1))throw Error('Unexpected rate dimension size');
 for(const name of d.dimension.id){const index=d.dimension[name]?.category?.index;if(!expected[name]||!index||Object.keys(index).length!==1||index[expected[name]]!==0)throw Error('Rate date/currency/type mismatch');}
 if(!Array.isArray(d.value)||d.value.length!==1)throw Error('Expected exactly one native observation');const value=d.value[0];if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0))throw Error('Invalid native rate');
 return jsonResult({...base,available:value!==null,observationDate:date,value,reason:value===null?'source_observation_missing':null,native,request});
 }catch(e){return errorResult(e);}};}
