# agentforge-wait-tickets

AgentForge **C4** durable async wait/resume tickets (exactly-once **claim**).

A wait ticket is a prepaid pause handle: create it, let one worker claim it, then resume with an answer. This slice is an in-memory MVP with a meter stub (`price_pending`). It is not a workflow engine.

## Honesty (read this first)

- Exactly-once applies to **claim** only. Concurrent claimers: one `acquired`, everyone else `lost`.
- This is **not** exactly-once delivery to external systems (webhooks, vendors, tools, humans).
- Resume is **free**. Replay of the same create/claim idempotency key does not debit again.
- Meter `usdc` is `null` with `price_pending: true`. Default list price when filled later: **$0.001** USDC / `wait_ticket_create`. Claim `acquired` is a separate billable unit (`wait_ticket_claim`).
- Store is **in-memory** with TTL. Process restart loses tickets.

Out of scope for this repo: C1 CAPTCHA, C2 memory-gate features, Shape 1 attest-core, human UI/inbox, workflow DAG, SNS/SQS fan-out.

## Run

```bash
npm install
npm test
npm run dev          # HTTP on :8787
# or
npm run build && npm start
```

MCP (stdio):

```bash
npm run mcp
```

Point an MCP client at `npx tsx src/mcp.ts` (or `node dist/mcp.js` after build). Tools: `wait_create`, `wait_claim`, `wait_resume`. Same JSON in/out as the HTTP API.

## Meter stub

Billable outcomes (one debit per `meter_ref`):

| Event | sku | billable |
| --- | --- | --- |
| create | `wait_ticket_create` | true |
| claim `acquired` | `wait_ticket_claim` | true |
| claim `already_owned` / `lost` | `wait_ticket_claim` | false (no debit) |
| resume | — | false |

## curl

Create:

```bash
curl -sS http://127.0.0.1:8787/v1/tickets \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: ik_create_demo' \
  -d '{
    "agent_id": "ag_demo",
    "purpose": "tool_wait",
    "answer_schema": {},
    "ttl_s": 86400,
    "idempotency_key": "ik_create_demo",
    "metadata": {}
  }'
```

Claim:

```bash
curl -sS http://127.0.0.1:8787/v1/tickets/tkt_YOUR_ID/claim \
  -H 'Content-Type: application/json' \
  -d '{"claimer_id":"worker_demo","idempotency_key":"ik_claim_demo"}'
```

Resume (owner `claim_id` only, free):

```bash
curl -sS http://127.0.0.1:8787/v1/tickets/tkt_YOUR_ID/resume \
  -H 'Content-Type: application/json' \
  -d '{"claim_id":"clm_YOUR_ID","answer":{"ok":true},"idempotency_key":"ik_resume_demo"}'
```

## Endpoints

| Method | Path | Bills |
| --- | --- | --- |
| POST | `/v1/tickets` | Yes, on create (`wait_ticket_create`) |
| POST | `/v1/tickets/{ticket_id}/claim` | Yes, only when `claim_status=acquired` |
| POST | `/v1/tickets/{ticket_id}/resume` | No |

`Idempotency-Key` header on create is bound to `idempotency_key` in the body: same value, or one of the two. Mismatch is HTTP 400.

Claim rules:

- First successful claimer → `acquired` + `claim_id` `clm_*`
- Same claimer / same idempotency replay → `already_owned` (same `claim_id` / `meter_ref`, no second bill)
- Different claimer while owned → `lost` + HTTP 409
- Concurrent race: exactly one `acquired`

`purpose`: `tool_wait` | `webhook` | `approval` | `vendor_job`.
