#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  WAIT_CLAIM_TOOL,
  WAIT_CREATE_TOOL,
  WAIT_RESUME_TOOL,
} from "./constants.js";
import {
  ClaimTicketResponseSchema,
  CreateTicketResponseSchema,
  ResumeTicketResponseSchema,
  WaitClaimToolInputSchema,
  WaitCreateToolInputSchema,
  WaitResumeToolInputSchema,
} from "./schemas.js";
import {
  IdempotencyConflictError,
  ResumeConflictError,
  ResumeForbiddenError,
  TicketExpiredError,
  TicketNotClaimedError,
  TicketNotFoundError,
  WaitTicketService,
} from "./tickets.js";

function toolError(error: string, extra: Record<string, unknown> = {}) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error, ...extra }),
      },
    ],
  };
}

function toolOk(result: unknown) {
  const text = JSON.stringify(result);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: result as Record<string, unknown>,
  };
}

export function createMcpServer(service = new WaitTicketService()) {
  const server = new McpServer({
    name: "wait-tickets",
    version: "0.1.0",
  });

  server.registerTool(
    WAIT_CREATE_TOOL,
    {
      title: "Create wait ticket",
      description:
        "Create a durable async wait ticket. Same JSON in/out as POST /v1/tickets. Exactly-once claim is a later step; this is not exactly-once delivery to external systems.",
      inputSchema: WaitCreateToolInputSchema,
    },
    async (args) => {
      const parsed = WaitCreateToolInputSchema.safeParse(args);
      if (!parsed.success) {
        return toolError("invalid_request", {
          details: parsed.error.flatten(),
        });
      }
      try {
        const result = CreateTicketResponseSchema.parse(
          await service.create(parsed.data),
        );
        return toolOk(result);
      } catch (err) {
        return mapToolError(err);
      }
    },
  );

  server.registerTool(
    WAIT_CLAIM_TOOL,
    {
      title: "Claim wait ticket",
      description:
        "Exactly-once claim of a wait ticket. Same JSON out as POST /v1/tickets/{ticket_id}/claim. Concurrent claimers: one acquired, others lost.",
      inputSchema: WaitClaimToolInputSchema,
    },
    async (args) => {
      const parsed = WaitClaimToolInputSchema.safeParse(args);
      if (!parsed.success) {
        return toolError("invalid_request", {
          details: parsed.error.flatten(),
        });
      }
      try {
        const result = await service.claim(parsed.data.ticket_id, {
          claimer_id: parsed.data.claimer_id,
          idempotency_key: parsed.data.idempotency_key,
        });
        const body = ClaimTicketResponseSchema.parse(result.body);
        return toolOk(body);
      } catch (err) {
        return mapToolError(err);
      }
    },
  );

  server.registerTool(
    WAIT_RESUME_TOOL,
    {
      title: "Resume wait ticket",
      description:
        "Resume a claimed wait ticket with an answer. Free (not billed). Same JSON out as POST /v1/tickets/{ticket_id}/resume. Owner claim_id only.",
      inputSchema: WaitResumeToolInputSchema,
    },
    async (args) => {
      const parsed = WaitResumeToolInputSchema.safeParse(args);
      if (!parsed.success) {
        return toolError("invalid_request", {
          details: parsed.error.flatten(),
        });
      }
      try {
        const result = ResumeTicketResponseSchema.parse(
          await service.resume(parsed.data.ticket_id, {
            claim_id: parsed.data.claim_id,
            answer: parsed.data.answer,
            idempotency_key: parsed.data.idempotency_key,
          }),
        );
        return toolOk(result);
      } catch (err) {
        return mapToolError(err);
      }
    },
  );

  return { server, service };
}

function mapToolError(err: unknown) {
  if (err instanceof IdempotencyConflictError) {
    return toolError("idempotency_key_conflict");
  }
  if (err instanceof TicketNotFoundError) {
    return toolError("ticket_not_found");
  }
  if (err instanceof TicketExpiredError) {
    return toolError("ticket_expired");
  }
  if (err instanceof ResumeForbiddenError) {
    return toolError("resume_forbidden");
  }
  if (err instanceof TicketNotClaimedError) {
    return toolError("ticket_not_claimed");
  }
  if (err instanceof ResumeConflictError) {
    return toolError("resume_conflict");
  }
  throw err;
}

async function main() {
  const { server } = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("mcp.ts") || process.argv[1].endsWith("mcp.js"));

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
