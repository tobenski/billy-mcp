# billy-mcp — Billy (billy.dk) MCP Server for Claude & AI Assistants

## Cloudflare Workers read-only edition

This fork adds a separate `/mcp` Worker entry point protected by **Cloudflare
Access Managed OAuth** and a verified-email allowlist. It exposes 24 read-only
tools, enforces GET-only Billy requests, and excludes `execute_script`.
See the [Danish setup guide](docs/cloudflare-workers.md) for the branch,
deployment steps, required secrets, and ChatGPT connection checks.

The upstream local stdio implementation remains below. Its `execute_script`
tool is **not a secure sandbox**: review reproduced bypasses of its read-only
and dry-run controls, and work continuing after its timeout. Do not rely on
those controls when using the local script tool. This tool is not imported by
the hosted Worker. Live Billy and ChatGPT OAuth verification is still required
before using a deployment with real accounting data.

---

**Connect Claude, Cursor, VS Code, and any MCP-compatible AI assistant to [Billy](https://www.billy.dk/) — the Danish accounting platform (billysbilling).** Create invoices, book journal entries, check account balances, reconcile bank lines, and attach receipts — with built-in human-approval write protection so your AI never books anything without your sign-off.

[![npm version](https://img.shields.io/npm/v/billy-mcp)](https://www.npmjs.com/package/billy-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-Model_Context_Protocol-8A2BE2)](https://modelcontextprotocol.io)

> Billy accounting · Billy.dk API · Danish bookkeeping (bogføring/regnskab) · AI bookkeeping agent · Model Context Protocol server · Claude Desktop integration

## What can it do?

Ask your AI assistant things like:

- *"Create an invoice for Acme ApS: 10 consulting hours at 1.200 DKK, due in 14 days"*
- *"What's the balance of account 5211 this quarter?"* (trial balance from live postings)
- *"Book last month's payroll as a journal entry — draft it, I'll approve"*
- *"Void these 34 duplicate entries"* (one call, one approval, per-item results)
- *"Upload this receipt PDF and attach it to journal entry #67"*
- *"Which invoices are overdue and unpaid?"*

**40 tools** covering invoices, supplier bills, contacts, products, bank payments, manual journal entries (daybook transactions), postings, trial balance, bank reconciliation, file attachments, a sandboxed batch-scripting tool, and a raw API escape hatch for everything else.

## Quick start

### 1. Get a Billy access token

Log into [mit.billy.dk](https://mit.billy.dk/) → **Settings → Access tokens → Create access token**. Tokens are per-company and don't expire.

### 2. Add to your MCP client

**Claude Desktop** (`claude_desktop_config.json`) / **Cursor** / any JSON-config host:

```json
{
  "mcpServers": {
    "billy": {
      "command": "npx",
      "args": ["-y", "billy-mcp"],
      "env": {
        "BILLY_ACCESS_TOKEN": "<your token>"
      }
    }
  }
}
```

**Claude Code** (CLI):

```sh
claude mcp add billy -e BILLY_ACCESS_TOKEN=<your token> -- npx -y billy-mcp
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "billy": {
      "command": "npx",
      "args": ["-y", "billy-mcp"],
      "env": { "BILLY_ACCESS_TOKEN": "${input:billy-token}" }
    }
  }
}
```

That's it — no clone, no build. `npx` fetches the published package.

### From source (development)

```sh
git clone https://github.com/thourum/billy-mcp.git
cd billy-mcp
npm install
cp .env.example .env      # paste your token
npm run dev               # run over stdio
npm run inspector         # try tools in the MCP Inspector UI
```

## Write protection — safe for real financial data

Every write (create/update/approve/void/pay/upload) is gated by `BILLY_WRITE_MODE`:

| Mode | Behavior |
| --- | --- |
| `read-only` | Write tools are not registered at all; raw requests reject non-GET |
| `confirm` **(default)** | Each write pauses and shows **you** a native approval dialog (MCP elicitation) with the full payload — the AI cannot approve its own writes |
| `full` | Writes execute without approval |

Fail-closed: if your MCP host doesn't support elicitation dialogs, `confirm` mode **blocks writes** with instructions instead of executing them. Irreversible operations (approve invoice, void entry, bank payments) are additionally flagged `destructiveHint` so hosts can add their own guardrails. Declining, dismissing, or leaving the checkbox unticked = nothing is booked.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `BILLY_ACCESS_TOKEN` | yes | Billy API access token (sent as `X-Access-Token`) |
| `BILLY_WRITE_MODE` | no | `read-only`, `confirm` (default), or `full` |
| `BILLY_ORGANIZATION_ID` | no | Auto-resolved when the token maps to one company |
| `BILLY_BASE_URL` | no | Defaults to `https://api.billysbilling.com/v2` |
| `BILLY_LOCALE` | no | `en_US`, `da_DK`, `fr_FR`, `nl_NL`, `de_DE` |

## Tools

<details>
<summary><b>Full tool list (40)</b></summary>

**Organization & contacts** — `get_organization`, `list_contacts`, `get_contact`, `create_contact`, `update_contact`, `list_contact_persons`, `create_contact_person`

**Products** — `list_products`, `get_product`, `create_product`, `update_product`

**Invoices** — `list_invoices`, `get_invoice`, `create_invoice` (embedded lines, draft or approve-immediately), `approve_invoice`, `delete_invoice`

**Bills (expenses)** — `list_bills`, `get_bill`, `create_bill`

**Payments** — `create_bank_payment` (mark invoices/bills paid), `list_bank_payments`, `list_balance_modifiers`

**Journal entries (daybook)** — `create_daybook_transaction` (client-side debit/credit balance validation + idempotency-key safe retry), `void_daybook_transaction`, `batch_void_daybook_transactions` (N voids, one approval), `list_daybook_transactions`, `list_daybooks`

**Reporting & reconciliation** — `get_account_balances` (trial balance / per-account balance from postings), `list_postings`, `list_transactions`, `list_accounts`, `get_account`, `list_bank_lines`, `list_bank_line_matches`

**Files & attachments** — `upload_file` (pdf/jpg/png/gif), `attach_file` (link to invoice/bill/journal entry), `list_files`, `list_attachments`

**Power tools** — `execute_script` (sandboxed JS batch runner with server-enforced mutation log + `dry_run`), `billy_raw_request` (any Billy v2 endpoint)

</details>

### Built for LLM agents, not just humans

- **Compact responses by default** (~90% fewer tokens); pass `verbose: true` for full payloads
- **`appliedFilters` transparency**: Billy silently ignores unknown query params — every list tool reports which filters ran server-side vs client-side, so the agent never mistakes "filter ignored" for "no results"
- **Pre-flight validation**: imbalanced journal entries are rejected client-side with per-currency debit/credit totals before an approval is ever requested
- **Idempotent retries**: `idempotencyKey` on journal entries dedupes safely after timeouts
- **Batch with one approval**: `execute_script` runs loops (e.g. 34 voids) with a full audit log returned even when the script fails mid-run

## FAQ

**Is this an official Billy integration?** No — community project using Billy's public REST API v2.

**Does it work with Billy's free plan?** Yes, any account that can create access tokens at mit.billy.dk.

**Can the AI spend my money?** In default `confirm` mode, no write happens without you clicking approve in a dialog the model can't touch. Use `read-only` for pure analysis sessions.

**Which AI apps are supported?** Anything speaking Model Context Protocol over stdio: Claude Desktop, Claude Code, Cursor, Windsurf, VS Code (GitHub Copilot), Zed, and more.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm run inspector   # interactive tool testing
```

Stack: TypeScript, [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), Zod v4 schemas. Billy API reference mirrored in [`docs/billy-api.md`](docs/billy-api.md).

## License

[MIT](LICENSE)

---

*Keywords: Billy MCP server, billy.dk API, billysbilling integration, Danish accounting AI, bogføring automatisering, regnskab AI, Claude accounting, MCP accounting server, AI bookkeeping Denmark, fakturering API.*
