import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { compactResponse, DEFAULT_PAGE_SIZE, errorResult, jsonResult, pagingShape, verbosityShape } from './helpers.js';
import { confirmWrite, writeMode } from '../write-guard.js';

/** Billy /files only accepts these types — anything else returns a generic 422. */
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif'
};

const FILE_FIELDS = { files: ['id', 'fileName', 'fileSize', 'fileType', 'isPdf', 'isImage', 'downloadUrl'] };
const READ_FILE_FIELDS = [...FILE_FIELDS.files, 'createdTime'];
const ATTACHMENT_FIELDS = ['id', 'ownerReference', 'fileId', 'priority', 'createdTime'];

type RecordData = Record<string, unknown>;
type AttachmentFileError = {
  code: 'ATTACHMENT_FILE_ID_INVALID' | 'FILE_METADATA_MISSING';
  fileId: string | null;
  attachmentIds: string[];
  message: string;
};

function isRecord(value: unknown): value is RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectFields(record: RecordData, fields: string[]): RecordData {
  return Object.fromEntries(fields.filter(field => record[field] !== undefined).map(field => [field, record[field]]));
}

/** Pagination describes attachment records, never the number of distinct files. */
function nextAttachmentPage(data: RecordData): { hasMore: boolean | null; nextPage: number | null } {
  const paging = isRecord(data.meta) && isRecord(data.meta.paging) ? data.meta.paging : undefined;
  const page = paging?.page;
  const pageCount = paging?.pageCount;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 ||
      typeof pageCount !== 'number' || !Number.isInteger(pageCount) || pageCount < 0) {
    return { hasMore: null, nextPage: null };
  }
  const hasMore = page < pageCount;
  return { hasMore, nextPage: hasMore ? page + 1 : null };
}

function attachmentFiles(attachments: RecordData[], sideloaded: unknown): {
  files: RecordData[];
  fileErrors: AttachmentFileError[];
} {
  const references = new Map<string, Set<string>>();
  const fileErrors: AttachmentFileError[] = [];
  for (const attachment of attachments) {
    const attachmentIds = typeof attachment.id === 'string' && attachment.id ? [attachment.id] : [];
    const fileId = attachment.fileId;
    if (typeof fileId !== 'string' || !fileId.trim() || fileId !== fileId.trim()) {
      fileErrors.push({
        code: 'ATTACHMENT_FILE_ID_INVALID', fileId: null, attachmentIds,
        message: 'The attachment did not contain a valid fileId; its file metadata could not be matched.'
      });
      continue;
    }
    const ids = references.get(fileId) ?? new Set<string>();
    attachmentIds.forEach(id => ids.add(id));
    references.set(fileId, ids);
  }

  const available = new Map<string, RecordData>();
  if (Array.isArray(sideloaded)) {
    for (const file of sideloaded) {
      if (isRecord(file) && typeof file.id === 'string' && references.has(file.id) && !available.has(file.id)) {
        available.set(file.id, file);
      }
    }
  }

  const files: RecordData[] = [];
  for (const [fileId, attachmentIds] of references) {
    const file = available.get(fileId);
    if (file) files.push(file);
    else fileErrors.push({
      code: 'FILE_METADATA_MISSING', fileId, attachmentIds: [...attachmentIds],
      message: 'Billy returned the attachment but did not include metadata for its referenced file.'
    });
  }
  return { files, fileErrors };
}

export function registerAttachmentTools(server: McpServer, billy: BillyClient): void {
  server.registerTool(
    'list_files',
    {
      description: 'General file listing through Billy /files. Billy may refuse this endpoint with 403. Use list_attachments for file metadata referenced by attachment records; that is a narrower inventory.',
      inputSchema: z.object({ ...pagingShape, ...verbosityShape }),
      annotations: { readOnlyHint: true }
    },
    async ({ page, pageSize, verbose }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const data = await billy.get('/files', { organizationId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        return jsonResult(verbose ? data : compactResponse(data, FILE_FIELDS));
      } catch (e) {
        if (e instanceof Error && /^Billy API GET \/files failed with 403:/.test(e.message)) {
          return errorResult(new Error(e.message + ' General file listing was refused by Billy. ' +
            'Use list_attachments for files referenced by attachment records, including unhandled inbox attachments; ' +
            'that does not establish a complete inventory of every file.'));
        }
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'get_file',
    {
      description: 'Get metadata and a download URL for one existing Billy file ID. This does not download the document. Use fileId from list_attachments.',
      inputSchema: z.object({
        id: z.string().trim().min(1).max(512)
          .refine(id => id !== '.' && id !== '..' && !/[\\/?#\s]/.test(id), 'Provide one file ID, not a path or URL')
          .describe('Existing Billy file ID from an attachment'),
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, verbose }) => {
      try {
        const data = await billy.get<unknown>(`/files/${encodeURIComponent(id)}`);
        if (!isRecord(data) || !isRecord(data.file)) {
          throw new Error('Billy did not return a valid file metadata object.');
        }
        if (data.file.id !== id) {
          throw new Error('Billy returned file metadata for a different file ID.');
        }
        return jsonResult(verbose ? data : { file: selectFields(data.file, READ_FILE_FIELDS) });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_attachments',
    {
      description:
        'List one page of attachment records, including handled documents and unhandled inbox items. ' +
        'Owner and status filters are applied by Billy. File metadata is included by default and deduplicated within this page. ' +
        'Coverage and paging refer to attachment records, not all files; follow nextPage when hasMore is true. ' +
        'Missing file metadata is reported explicitly. No document content is downloaded.',
      inputSchema: z.object({
        ownerReference: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Owner reference like 'daybookTransaction:<id>', 'invoice:<id>', 'bill:<id>' (server-side filter)"),
        status: z.enum(['all', 'handled', 'unhandled']).default('all')
          .describe('all: all attachment records; handled: linked to a document; unhandled: inbox items without an owner'),
        includeFiles: z.boolean().default(true)
          .describe('Include related file metadata and download URLs for the returned attachment page; no document download'),
        ...pagingShape,
        ...verbosityShape
      }).refine(input => !(input.ownerReference && input.status === 'unhandled'), {
        message: 'ownerReference cannot be combined with unhandled inbox status', path: ['status']
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ ownerReference, status, includeFiles, page, pageSize, verbose }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const data = await billy.get<unknown>('/attachments', {
          organizationId, ownerReference,
          handled: status === 'handled' ? true : undefined,
          unhandled: status === 'unhandled' ? true : undefined,
          include: includeFiles ? 'attachment.file:sideload' : undefined,
          page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE
        });
        if (!isRecord(data) || !Array.isArray(data.attachments) || !data.attachments.every(isRecord)) {
          throw new Error('Billy did not return a valid attachments array.');
        }
        const attachments = data.attachments;
        if (ownerReference && attachments.some(attachment => attachment.ownerReference !== ownerReference)) {
          throw new Error('Billy returned attachments outside the requested ownerReference filter.');
        }
        if (status === 'handled' && attachments.some(attachment =>
          typeof attachment.ownerReference !== 'string' || !attachment.ownerReference.trim())) {
          throw new Error('Billy returned an unhandled attachment for the handled status filter.');
        }
        if (status === 'unhandled' && attachments.some(attachment =>
          attachment.ownerReference !== null && attachment.ownerReference !== undefined && attachment.ownerReference !== '')) {
          throw new Error('Billy returned a handled attachment for the unhandled status filter.');
        }

        const { files, fileErrors } = includeFiles
          ? attachmentFiles(attachments, data.files)
          : { files: [], fileErrors: [] };
        const body: RecordData = verbose ? { ...data, attachments } : {
          ...(isRecord(data.meta) && data.meta.paging !== undefined ? { meta: { paging: data.meta.paging } } : {}),
          attachments: attachments.map(attachment => selectFields(attachment, ATTACHMENT_FIELDS))
        };
        // Only metadata referenced by this returned attachment page belongs in its response.
        if (includeFiles) body.files = files.map(file => verbose ? file : selectFields(file, READ_FILE_FIELDS));
        else delete body.files;
        body.coverage = {
          source: 'attachments', scope: 'current_page', allFiles: false,
          returnedAttachments: attachments.length, returnedFiles: files.length,
          ...nextAttachmentPage(data),
          filesCompleteForPage: includeFiles ? fileErrors.length === 0 : null
        };
        body.fileErrors = fileErrors;
        body.partial = fileErrors.length > 0;
        return jsonResult(body);
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  if (writeMode === 'read-only') return;

  server.registerTool(
    'upload_file',
    {
      description:
        'Upload a local file (pdf/jpg/jpeg/png/gif ONLY — Billy rejects other types with a 422) to Billy and get its file ID. Files are append-only: they cannot be deleted or modified via the API afterwards. Use attach_file to link the uploaded file to a record.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to a local pdf/jpg/jpeg/png/gif file on the machine running this MCP server'),
        fileName: z.string().optional().describe('Override the file name sent to Billy (defaults to the basename of path)'),
        ...verbosityShape
      }),
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    async ({ path, fileName, verbose }, ctx) => {
      try {
        const ext = extname(path).toLowerCase();
        const contentType = MIME_BY_EXT[ext];
        if (!contentType) {
          return errorResult(
            new Error(`Unsupported file type '${ext || '(none)'}'. Billy /files only accepts: ${Object.keys(MIME_BY_EXT).join(', ')}`)
          );
        }
        const bytes = await readFile(path);
        const name = fileName ?? basename(path);
        const organizationId = await billy.getOrganizationId();

        const gate = await confirmWrite(ctx, {
          operation: `Upload file '${name}' (${(bytes.length / 1024).toFixed(1)} KB, ${contentType}) to Billy — files cannot be deleted via the API afterwards`,
          details: { path, fileName: name, contentType, fileSizeBytes: bytes.length }
        });
        if (!gate.ok) return gate.result;

        const res = await billy.postBinary('/files', bytes, { fileName: name, contentType, organizationId });
        return jsonResult(verbose ? res : compactResponse(res, FILE_FIELDS));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'attach_file',
    {
      description:
        "Attach an uploaded file to a Billy record (daybook transaction, invoice, or bill). Get the fileId from upload_file or list_files. Example: attach a receipt to journal entry #67 → ownerType 'daybookTransaction', ownerId '<transaction id>'.",
      inputSchema: z.object({
        fileId: z.string().describe('File ID (see upload_file / list_files)'),
        ownerType: z
          .enum(['daybookTransaction', 'invoice', 'bill'])
          .describe('Type of the record to attach the file to'),
        ownerId: z.string().describe('ID of the record to attach the file to'),
        priority: z.number().int().optional().describe('Sort priority among the attachments of the same owner'),
        ...verbosityShape
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ fileId, ownerType, ownerId, priority, verbose }, ctx) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const ownerReference = `${ownerType}:${ownerId}`;
        const gate = await confirmWrite(ctx, {
          operation: `Attach file ${fileId} to ${ownerReference}`,
          details: { fileId, ownerReference, priority }
        });
        if (!gate.ok) return gate.result;

        const res = await billy.post('/attachments', {
          attachment: { organizationId, ownerReference, fileId, priority }
        });
        return jsonResult(
          verbose ? res : compactResponse(res, { attachments: ['id', 'ownerReference', 'fileId', 'priority'] })
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
