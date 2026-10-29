import { cap } from './tools/helpers.js';

type Query = Record<string, string | number | boolean | undefined>;

/** Explicit configuration keeps Worker credentials scoped to one request. */
export interface BillyClientConfig {
  accessToken: string;
  baseUrl?: string;
  locale?: string;
  organizationId?: string;
  readOnly?: boolean;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export class BillyClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly locale?: string;
  private organizationId?: string;
  private readonly readOnly: boolean;
  private readonly signal?: AbortSignal;
  private readonly requestTimeoutMs?: number;

  constructor(config?: BillyClientConfig) {
    const options = config ?? {
      accessToken: process.env.BILLY_ACCESS_TOKEN ?? '',
      baseUrl: process.env.BILLY_BASE_URL,
      locale: process.env.BILLY_LOCALE,
      organizationId: process.env.BILLY_ORGANIZATION_ID
    };
    const token = options.accessToken?.trim();
    if (!token) {
      throw new Error(
        'Missing Billy access token. Set the BILLY_ACCESS_TOKEN environment variable ' +
          '(create one at mit.billy.dk -> Settings -> Access tokens).'
      );
    }
    this.accessToken = token;
    this.baseUrl = (options.baseUrl ?? 'https://api.billysbilling.com/v2').replace(/\/$/, '');
    this.locale = options.locale;
    this.organizationId = options.organizationId?.trim() || undefined;
    this.readOnly = options.readOnly ?? false;
    this.signal = options.signal;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  private requestSignal(): AbortSignal | undefined {
    if (this.requestTimeoutMs === undefined) return this.signal;
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    return this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
  }

  async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: { body?: unknown; query?: Query } = {}
  ): Promise<T> {
    if (this.readOnly && method !== 'GET') {
      throw new Error('This Billy client is read-only: only GET requests are allowed.');
    }
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (this.readOnly && (url.origin !== new URL(this.baseUrl).origin || !url.pathname.startsWith('/v2/'))) {
      throw new Error('Read-only requests must stay within the Billy v2 API.');
    }
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      'X-Access-Token': this.accessToken,
      'Content-Type': 'application/json'
    };
    if (this.locale) headers['Accept-Language'] = this.locale;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: this.requestSignal(),
        // A remote redirect must never receive the Billy credential.
        ...(this.readOnly ? { redirect: 'manual' as const } : {})
      });
    } catch (err: any) {
      throw new Error(
        `Billy API ${method} ${path} network error: ${err.message}${err.cause ? ' (' + String(err.cause) + ')' : ''}`
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Billy API ${method} ${path} failed with ${res.status}: ${cap(text, 500)}`);
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Billy API ${method} ${path} returned non-JSON response`);
    }
  }

  get<T = any>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T = any>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  put<T = any>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }

  del<T = any>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Uploads raw binary content (Billy file upload: POST /files with X-Filename +
   * file Content-Type headers and the raw bytes as body — not documented on the
   * main API page but verified against Billy's api-docs upload recipe).
   */
  async postBinary<T = any>(
    path: string,
    bytes: Uint8Array,
    opts: { fileName: string; contentType: string; organizationId?: string }
  ): Promise<T> {
    if (this.readOnly) {
      throw new Error('This Billy client is read-only: file uploads are disabled.');
    }
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    const headers: Record<string, string> = {
      'X-Access-Token': this.accessToken,
      'Content-Type': opts.contentType,
      'X-Filename': opts.fileName,
      ...(opts.organizationId ? { 'x-organizationid': opts.organizationId } : {})
    };
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST', headers, body: bytes as unknown as BodyInit, signal: this.requestSignal()
      });
    } catch (err: any) {
      const cause = err?.cause ? ` (${String(err.cause)})` : '';
      throw new Error(`Billy API POST ${path} network error: ${err?.message ?? String(err)}${cause}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Billy API POST ${path} failed with ${res.status}: ${cap(text, 500)}`);
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new Error(`Billy API POST ${path} returned non-JSON response`);
    }
  }

  /**
   * Fetches ALL pages of a list endpoint and returns the concatenated records
   * under `resourceKey`. Use for client-side aggregation (e.g. balances).
   * `maxRecords` is a hard safety cap (default 20000).
   */
  async fetchAll<T = any>(
    path: string,
    resourceKey: string,
    query: Query = {},
    maxRecords = 20000
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    for (;;) {
      const res = await this.get(path, { ...query, page, pageSize: 1000 });
      const records: T[] = res?.[resourceKey] ?? [];
      all.push(...records);
      if (all.length > maxRecords) {
        throw new Error(
          `fetchAll ${path}: exceeded ${maxRecords} records; narrow the query (date range, accountId, ...).`
        );
      }
      const paging = res?.meta?.paging;
      if (!paging || paging.page >= paging.pageCount || records.length === 0) break;
      page += 1;
    }
    return all;
  }

  /** Returns the configured organization id, or resolves this company token via /organization. */
  async getOrganizationId(): Promise<string> {
    if (this.organizationId) return this.organizationId;
    // Company access tokens can read their own organization, but cannot list
    // the user's organizations. Keep the resolved id on this client only.
    const res = await this.get<{ organization?: { id?: unknown } }>('/organization');
    const id = res?.organization?.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Could not resolve organization: /organization did not return a valid organization id.');
    }
    this.organizationId = id.trim();
    return this.organizationId;
  }
}
