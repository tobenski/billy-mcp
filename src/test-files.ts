import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Buffer } from 'node:buffer';
import type { BillyClient } from './billy-client.js';
import { journalRun, NoWriteError, type JournalDB } from './test-drafts.js';
import { errorResult, jsonResult } from './tools/helpers.js';

const MAX_BYTES = 2 * 1024 * 1024;
const uuid = z.string().uuid();
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const mime = z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);
export async function sha256(bytes: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).toString('hex');
}
export function decodeFile(base64: string, fileName: string, contentType: string): Uint8Array {
  if (!base64 || base64.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid canonical base64');
  if (base64.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error('Maximum file size is 2 MiB');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== base64) throw new Error('Invalid file size or encoding');
  const hex = bytes.subarray(0,8).toString('hex');
  const formats: Record<string, [RegExp, boolean]> = {
    'application/pdf': [/\.pdf$/i, bytes.subarray(0,5).toString() === '%PDF-'],
    'image/png': [/\.png$/i, hex === '89504e470d0a1a0a'],
    'image/jpeg': [/\.jpe?g$/i, hex.startsWith('ffd8ff')],
    'image/gif': [/\.gif$/i, ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())],
  };
  const format = formats[contentType];
  if (!format || !format[0].test(fileName) || !format[1]) throw new Error('Filename, content type and file signature must match');
  return bytes;
}
export async function downloadBytes(rawUrl: string): Promise<Uint8Array> {
  const url = new URL(rawUrl);
  // URLs come only from Billy file metadata, never directly from MCP callers.
  // Do not follow redirects or forward the Billy API token to download hosts.
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !(url.hostname === 'download.billy.dk' || url.hostname.endsWith('.billysbilling.com'))) throw new Error('Unapproved Billy download host');
  const response = await fetch(url, { method:'GET', redirect:'manual', signal:AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error('File download failed; redirects are not followed');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw new Error('Downloaded file is too large'); }
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {
    for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>MAX_BYTES) throw new Error('Downloaded file is too large');chunks.push(value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export function registerTestFileTools(server:McpServer, read:BillyClient, write:BillyClient, db:JournalDB, orgId:string) {
  async function identity() { const r=await read.get('/organization');if(r.organization?.id!==orgId)throw new Error('Test organization mismatch'); }
  async function uploaded(key:string) {
    const row=await db.prepare('SELECT fingerprint, state, result FROM operations WHERE id = ?').bind(orgId+':'+key).first<{fingerprint:string;state:string;result:string|null}>();
    if(row?.state!=='complete'||!row.result)throw new NoWriteError('Upload operation is missing or uncertain. Inspect it before continuing.');
    const input=JSON.parse(row.fingerprint),result=JSON.parse(row.result);
    if(input.action!=='upload_file'||!id.safeParse(result.fileId).success||typeof result.sha256!=='string')throw new NoWriteError('Operation is not a completed file upload');
    return result as {fileId:string;fileName:string;contentType:string;sha256:string;sizeBytes:number};
  }
  const wrap=(fn:(args:any)=>Promise<unknown>)=>async(args:any)=>{try{return jsonResult(await fn(args));}catch(e){return errorResult(e);}};
  server.registerTool('upload_test_file',{
    description:'Upload PDF/PNG/JPEG/GIF bytes (canonical base64, max 2 MiB) to the locked test organization. Files may remain permanently in Billy. No OCR or automatic attachment. Reuse exactly the same operation UUID/input after a lost response. Returns file ID, byte count and SHA-256; does not return file content.',
    inputSchema:z.object({operationId:uuid,fileName:z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_. -]*$/),contentType:mime,base64:z.string().max(Math.ceil(MAX_BYTES/3)*4)}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
  },wrap(async({operationId,fileName,contentType,base64})=>{
    await identity();const bytes=decodeFile(base64,fileName,contentType);const hash=await sha256(bytes);
    return journalRun(db,orgId,operationId,'upload:'+operationId,{action:'upload_file',fileName,contentType,sizeBytes:bytes.length,sha256:hash},async()=>{
      const result=await write.postBinary('/files',bytes,{fileName,contentType,organizationId:orgId});
      const file=result.files?.[0];if(!id.safeParse(file?.id).success)throw new Error('Missing uploaded file ID');
      return {fileId:file.id,fileName,contentType,sizeBytes:bytes.length,sha256:hash};
    });
  }));
  server.registerTool('attach_test_file_to_draft',{
    description:'Link a completed test upload to a test-tool-created draft. Supply the upload operation UUID, target draft ID and current description. Preserves existing attachments and returns a verified owner/file link. Repeated links to the same file are reused.',
    inputSchema:z.object({operationId:uuid,uploadOperationId:uuid,daybookTransactionId:id,expectedDescription:z.string()}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true},
  },wrap(async({operationId,uploadOperationId,daybookTransactionId,expectedDescription})=>{
    await identity();const file=await uploaded(uploadOperationId);const ownerReference='daybookTransaction:'+daybookTransactionId;
    return journalRun(db,orgId,operationId,daybookTransactionId,{action:'attach_file',uploadOperationId,daybookTransactionId,expectedDescription},async()=>{
      const {daybookTransaction:draft}=await read.get('/daybookTransactions/'+daybookTransactionId);
      if(draft?.organizationId!==orgId||draft.state!=='draft'||!draft.apiType?.startsWith('mcp-test:'))throw new NoWriteError('Only test-tool-created drafts may receive attachments');
      if((draft.description??'')!==expectedDescription)throw new NoWriteError('Draft description changed; read again');
      const existing=await read.fetchAll('/attachments','attachments',{organizationId:orgId,ownerReference});
      if(existing.some((a:any)=>a.ownerReference!==ownerReference))throw new NoWriteError('Unexpected attachment owner in response');
      const prior=existing.find((a:any)=>a.fileId===file.fileId);
      if(prior)return {alreadyLinked:true,attachment:prior,fileId:file.fileId};
      const response=await write.post('/attachments',{attachment:{organizationId:orgId,ownerReference,fileId:file.fileId}});
      const link=response.attachments?.find((a:any)=>a.fileId===file.fileId&&a.ownerReference===ownerReference);
      if(!id.safeParse(link?.id).success)throw new Error('Missing attachment ID');
      const checked=await read.get('/attachments/'+link.id);
      if(checked.attachment?.fileId!==file.fileId||checked.attachment?.ownerReference!==ownerReference||checked.attachment?.organizationId!==orgId)throw new Error('Attachment readback failed');
      return {alreadyLinked:false,attachment:checked.attachment,fileId:file.fileId};
    });
  }));
  server.registerTool('download_test_file',{
    description:'Download and hash-check bytes from a completed test upload. Default returns verification and metadata only. includeContent returns a base64 chunk (max 65536 bytes) at offset; follow nextOffset to reconstruct the file. API credentials are never sent to download hosts.',
    inputSchema:z.object({uploadOperationId:uuid,includeContent:z.boolean().default(false),offset:z.number().int().min(0).default(0),chunkSize:z.number().int().min(1).max(65536).default(65536)}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false},
  },wrap(async({uploadOperationId,includeContent,offset,chunkSize})=>{
    await identity();const source=await uploaded(uploadOperationId);
    const {file}=await read.get('/files/'+source.fileId);
    if(file?.id!==source.fileId||typeof file.downloadUrl!=='string')throw new Error('Invalid file metadata');
    const bytes=await downloadBytes(file.downloadUrl),hash=await sha256(bytes);
    if(hash!==source.sha256||bytes.length!==source.sizeBytes)throw new Error('Downloaded bytes differ from uploaded bytes');
    if(offset>bytes.length)throw new Error('Offset exceeds file size');
    const end=Math.min(offset+chunkSize,bytes.length);
    return {...source,verified:true,...(includeContent?{offset,base64:Buffer.from(bytes.subarray(offset,end)).toString('base64'),nextOffset:end<bytes.length?end:null}:{})};
  }));
}
