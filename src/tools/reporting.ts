import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { BillyClient } from '../billy-client.js';
import { compactResponse, DEFAULT_PAGE_SIZE, errorResult, jsonResult, pagingShape, verbosityShape } from './helpers.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function registerReportingTools(server: McpServer, billy: BillyClient): void {
  server.registerTool(
    'get_account_balances',
    {
      description:
        'Account balances / trial balance computed from postings. Ask "what is the balance of account 5211" → accountNos: ["5211"]. Omit account filters for a full trial balance. Bound with minEntryDate/maxEntryDate for speed — the tool fetches and aggregates all matching postings server-side.',
      inputSchema: z.object({
        accountNos: z.array(z.string()).optional().describe("Account numbers to include, e.g. ['5211']"),
        accountIds: z.array(z.string()).optional().describe('Account IDs to include'),
        minEntryDate: z.string().optional().describe('Posting date >= this (YYYY-MM-DD) — strongly recommended'),
        maxEntryDate: z.string().optional().describe('Posting date <= this (YYYY-MM-DD)'),
        includeVoided: z.boolean().optional().describe('Include voided postings (default false)'),
        organizationId: z.string().optional().describe('Organization ID (auto-resolved when omitted)')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ accountNos, accountIds, minEntryDate, maxEntryDate, includeVoided, organizationId }) => {
      try {
        const orgId = organizationId ?? (await billy.getOrganizationId());

        const accounts = await billy.fetchAll<any>('/accounts', 'accounts', { organizationId: orgId });
        const byId = new Map<string, { accountNo?: string; name?: string }>();
        for (const a of accounts) byId.set(a.id, { accountNo: a.accountNo != null ? String(a.accountNo) : undefined, name: a.name });

        const wantedIds = new Set<string>(accountIds ?? []);
        if (accountNos?.length) {
          const wantedNos = new Set(accountNos.map(String));
          for (const a of accounts) {
            if (a.accountNo != null && wantedNos.has(String(a.accountNo))) wantedIds.add(a.id);
          }
          const foundNos = new Set([...wantedIds].map((id) => byId.get(id)?.accountNo).filter(Boolean));
          const missing = accountNos.filter((n) => !foundNos.has(String(n)));
          if (missing.length > 0 && wantedIds.size === 0) {
            return errorResult(new Error(`No accounts found for accountNos: ${missing.join(', ')}`));
          }
        }
        const filterByAccount = wantedIds.size > 0;

        // Only organizationId is a documented postings filter; date filters are sent
        // opportunistically but ALWAYS re-checked client-side (Billy silently ignores
        // unknown params). Single-account queries also narrow server-side via accountId.
        const query: Record<string, string | undefined> = { organizationId: orgId, minEntryDate, maxEntryDate };
        if (wantedIds.size === 1) query.accountId = [...wantedIds][0];
        const postings = await billy.fetchAll<any>('/postings', 'postings', query);

        const agg = new Map<string, { debit: number; credit: number; count: number }>();
        for (const p of postings) {
          if (!includeVoided && p.isVoided) continue;
          if (filterByAccount && !wantedIds.has(p.accountId)) continue;
          if (minEntryDate && p.entryDate < minEntryDate) continue;
          if (maxEntryDate && p.entryDate > maxEntryDate) continue;
          const b = agg.get(p.accountId) ?? { debit: 0, credit: 0, count: 0 };
          if (p.side === 'debit') b.debit += p.amount;
          else b.credit += p.amount;
          b.count += 1;
          agg.set(p.accountId, b);
        }

        const rows = [...agg.entries()]
          .map(([accountId, b]) => ({
            accountId,
            accountNo: byId.get(accountId)?.accountNo,
            name: byId.get(accountId)?.name,
            debitTotal: round2(b.debit),
            creditTotal: round2(b.credit),
            balance: round2(b.debit - b.credit),
            postingCount: b.count
          }))
          .sort((a, b) => String(a.accountNo ?? '').localeCompare(String(b.accountNo ?? ''), undefined, { numeric: true }));

        return jsonResult({
          appliedFilters: {
            serverSide: ['organizationId', ...(query.accountId ? ['accountId'] : [])],
            clientSide: [
              ...(filterByAccount ? ['accountIds/accountNos'] : []),
              ...(minEntryDate ? ['minEntryDate'] : []),
              ...(maxEntryDate ? ['maxEntryDate'] : []),
              ...(includeVoided ? [] : ['isVoided=false'])
            ]
          },
          accounts: rows,
          totals: {
            debit: round2(rows.reduce((s, r) => s + r.debitTotal, 0)),
            credit: round2(rows.reduce((s, r) => s + r.creditTotal, 0)),
            net: round2(rows.reduce((s, r) => s + r.balance, 0))
          }
        });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_postings',
    {
      description:
        'Read native ledger postings with Billy date, status and search filters. Returns source amounts without calculating balances. The optional legacy text substring filter applies within the returned page; use q for Billy search.',
      inputSchema: z.object({
        accountId: z.string().optional().describe('Filter by account ID (server-side)'),
        minEntryDate: z.string().optional().describe('Posting date >= this (Billy server filter)'),
        maxEntryDate: z.string().optional().describe('Posting date <= this (Billy server filter)'),
        entryDatePeriod: z.string().trim().min(1).optional().describe('Billy date period, for example month:2026-01'),
        isVoided: z.boolean().optional().describe('Billy filter by voided status'),
        isBankMatched: z.boolean().optional().describe('Billy filter by its recorded bank-match status'),
        isNotZero: z.boolean().optional().describe('Billy filter for nonzero postings'),
        q: z.string().trim().min(1).optional().describe('Billy search across posting text and originator name'),
        text: z.string().optional().describe('Substring match on posting text — searches LINE-LEVEL text (client-side, within page)'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ text, page, pageSize, verbose, ...filters }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const data = await billy.get('/postings', {
          organizationId,
          ...filters,
          page,
          pageSize: pageSize ?? DEFAULT_PAGE_SIZE
        });
        const clientSide: string[] = [];
        if (!Array.isArray(data.postings) || data.postings.some((p: any) => !p || typeof p !== 'object' || Array.isArray(p))) {
          throw new Error('Billy did not return a valid postings array.');
        }
        let postings: any[] = data.postings;
        if (postings.some(p =>
          (filters.accountId && p.accountId !== filters.accountId) ||
          (filters.minEntryDate && (typeof p.entryDate !== 'string' || p.entryDate < filters.minEntryDate)) ||
          (filters.maxEntryDate && (typeof p.entryDate !== 'string' || p.entryDate > filters.maxEntryDate)) ||
          (filters.isVoided !== undefined && p.isVoided !== filters.isVoided) ||
          (filters.isBankMatched !== undefined && p.isBankMatched !== filters.isBankMatched))) {
          throw new Error('Billy returned postings outside the requested account, date or status filter.');
        }
        if (text) {
          clientSide.push('text');
          const needle = text.toLowerCase();
          postings = postings.filter((p) => String(p.text ?? '').toLowerCase().includes(needle));
        }
        const shaped = verbose
          ? { ...data, postings }
          : compactResponse({ ...data, postings }, { postings: ['id', 'entryDate', 'text', 'accountId', 'amount', 'side', 'currencyId', 'isVoided', 'isBankMatched', 'transactionId', 'salesTaxReturnId'] });
        return jsonResult({
          appliedFilters: {
            serverSide: ['organizationId', ...Object.keys(filters).filter(key => filters[key as keyof typeof filters] !== undefined)],
            clientSide,
            ...(clientSide.length > 0
              ? { note: 'The legacy text substring filter applies within this page only; follow meta.paging or use the native q filter.' }
              : {})
          },
          ...(shaped as Record<string, unknown>)
        });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_transactions',
    {
      description:
        'List booked transactions. transactionNo/voucherNo filters are applied CLIENT-SIDE (Billy silently ignores them as query params) by scanning up to 5000 records — bound with dates when possible.',
      inputSchema: z.object({
        transactionNo: z.string().optional().describe('Exact transaction number (client-side scan)'),
        voucherNo: z.string().optional().describe('Exact voucher number (client-side scan)'),
        minEntryDate: z.string().optional().describe('Entry date >= this (client-side)'),
        maxEntryDate: z.string().optional().describe('Entry date <= this (client-side)'),
        isVoided: z.boolean().optional().describe('Filter by voided status (client-side)'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ transactionNo, voucherNo, minEntryDate, maxEntryDate, isVoided, page, pageSize, verbose }) => {
      try {
        const organizationId = await billy.getOrganizationId();
        const needsScan = transactionNo !== undefined || voucherNo !== undefined;
        let transactions: any[];
        let meta: unknown;
        if (needsScan) {
          transactions = await billy.fetchAll<any>('/transactions', 'transactions', { organizationId }, 5000);
        } else {
          const data = await billy.get('/transactions', { organizationId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
          transactions = data.transactions ?? [];
          meta = data.meta;
        }
        const clientSide: string[] = [];
        if (transactionNo !== undefined)
          (clientSide.push('transactionNo'), (transactions = transactions.filter((t) => String(t.transactionNo) === String(transactionNo))));
        if (voucherNo !== undefined)
          (clientSide.push('voucherNo'), (transactions = transactions.filter((t) => String(t.voucherNo ?? '') === String(voucherNo))));
        if (minEntryDate) (clientSide.push('minEntryDate'), (transactions = transactions.filter((t) => t.entryDate >= minEntryDate)));
        if (maxEntryDate) (clientSide.push('maxEntryDate'), (transactions = transactions.filter((t) => t.entryDate <= maxEntryDate)));
        if (isVoided !== undefined) (clientSide.push('isVoided'), (transactions = transactions.filter((t) => t.isVoided === isVoided)));

        const body: Record<string, unknown> = meta ? { meta, transactions } : { transactions };
        const shaped = verbose
          ? body
          : compactResponse(body, { transactions: ['id', 'transactionNo', 'entryDate', 'voucherNo', 'originatorName', 'isVoided'] });
        return jsonResult({
          appliedFilters: {
            serverSide: ['organizationId'],
            clientSide,
            ...(needsScan ? { note: 'scanned up to 5000 records client-side for transactionNo/voucherNo' } : {})
          },
          ...(shaped as Record<string, unknown>)
        });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_bank_lines',
    {
      description: 'Read one page of native bank lines for a required account. Billy applies date, reconciliation, receipt and amount filters. Source balances/statuses are returned unchanged; no reconciliation is performed. The legacy matched filter checks matchId only within this page.',
      inputSchema: z.object({
        accountId: z.string().trim().min(1).describe('Required bank account ID (server-side); use list_accounts to find it'),
        minEntryDate: z.string().optional().describe('Entry date >= this (Billy server filter)'),
        maxEntryDate: z.string().optional().describe('Entry date <= this (Billy server filter)'),
        entryDatePeriod: z.string().trim().min(1).optional().describe('Billy date period'),
        isReconciled: z.boolean().optional().describe('Billy recorded reconciliation status'),
        status: z.enum(['pending', 'booked']).optional().describe('Billy bank-line status (API defaults to booked)'),
        side: z.enum(['debit', 'credit']).optional(),
        receiptState: z.string().trim().min(1).optional().describe('Billy receipt state, for example missing_receipt'),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
        q: z.string().trim().min(1).optional().describe('Billy search on description or amount'),
        sortProperty: z.enum(['entryDate', 'amount']).optional(),
        sortDirection: z.enum(['ASC', 'DESC']).optional(),
        matched: z.boolean().optional().describe('true = only lines with a match, false = only unmatched (client-side)'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ accountId, matched, page, pageSize, verbose, ...filters }) => {
      try {
        const data = await billy.get('/bankLines', { accountId, ...filters, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        const clientSide: string[] = [];
        if (!Array.isArray(data.bankLines) || data.bankLines.some((line: any) => !line || typeof line !== 'object' || Array.isArray(line))) {
          throw new Error('Billy did not return a valid bankLines array.');
        }
        let bankLines: any[] = data.bankLines;
        if (bankLines.some(line => line.accountId !== accountId ||
          (filters.minEntryDate && (typeof line.entryDate !== 'string' || line.entryDate < filters.minEntryDate)) ||
          (filters.maxEntryDate && (typeof line.entryDate !== 'string' || line.entryDate > filters.maxEntryDate)))) {
          throw new Error('Billy returned bank lines outside the requested account or date filter.');
        }
        if (matched !== undefined) (clientSide.push('matched'), (bankLines = bankLines.filter((l) => Boolean(l.matchId) === matched)));
        const shaped = verbose
          ? { ...data, bankLines }
          : compactResponse({ ...data, bankLines }, { bankLines: ['id', 'accountId', 'entryDate', 'description', 'amount', 'balance', 'side', 'matchId', 'status', 'receiptState'] });
        return jsonResult({
          appliedFilters: { serverSide: ['accountId', ...Object.keys(filters).filter(key => filters[key as keyof typeof filters] !== undefined)], clientSide },
          ...(shaped as Record<string, unknown>)
        });
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_bank_line_matches',
    {
      description: 'List bank line matches (bank reconciliation groupings) for a required bank account ID. isApproved filter applied client-side within the page.',
      inputSchema: z.object({
        accountId: z.string().trim().min(1).describe('Required bank account ID (server-side); use list_accounts to find it'),
        isApproved: z.boolean().optional().describe('Filter by approval status (client-side, within page)'),
        ...pagingShape,
        ...verbosityShape
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ accountId, isApproved, page, pageSize, verbose }) => {
      try {
        const data = await billy.get('/bankLineMatches', { accountId, page, pageSize: pageSize ?? DEFAULT_PAGE_SIZE });
        const clientSide: string[] = [];
        let bankLineMatches: any[] = data.bankLineMatches ?? [];
        if (isApproved !== undefined)
          (clientSide.push('isApproved'), (bankLineMatches = bankLineMatches.filter((m) => m.isApproved === isApproved)));
        const shaped = verbose
          ? { ...data, bankLineMatches }
          : compactResponse(
              { ...data, bankLineMatches },
              { bankLineMatches: ['id', 'accountId', 'entryDate', 'amount', 'side', 'isApproved', 'differenceType'] }
            );
        return jsonResult({
          appliedFilters: { serverSide: [...(accountId ? ['accountId'] : [])], clientSide },
          ...(shaped as Record<string, unknown>)
        });
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
