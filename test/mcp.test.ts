import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import {
  WAIT_CLAIM_TOOL,
  WAIT_CREATE_TOOL,
  WAIT_RESUME_TOOL,
} from "../src/constants.js";
import {
  ClaimTicketResponseSchema,
  CreateTicketResponseSchema,
  ResumeTicketResponseSchema,
} from "../src/schemas.js";
import { createBody } from "./helpers.js";

async function connectClient(server: ReturnType<typeof createMcpServer>["server"]) {
  const client = new Client({ name: "wait-tickets-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("MCP wait tools", () => {
  it("registers wait_create, wait_claim, wait_resume with locked JSON I/O", async () => {
    const { server, service } = createMcpServer();
    const client = await connectClient(server);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([WAIT_CLAIM_TOOL, WAIT_CREATE_TOOL, WAIT_RESUME_TOOL].sort());

    const createdCall = await client.callTool({
      name: WAIT_CREATE_TOOL,
      arguments: createBody({ idempotency_key: "ik_create_mcp" }),
    });
    expect(createdCall.isError).toBeFalsy();
    const created = CreateTicketResponseSchema.parse(
      JSON.parse((createdCall.content as { type: string; text: string }[])[0]!.text),
    );

    const claimCall = await client.callTool({
      name: WAIT_CLAIM_TOOL,
      arguments: {
        ticket_id: created.ticket_id,
        claimer_id: "worker_mcp",
        idempotency_key: "ik_claim_mcp",
      },
    });
    expect(claimCall.isError).toBeFalsy();
    const claimed = ClaimTicketResponseSchema.parse(
      JSON.parse((claimCall.content as { type: string; text: string }[])[0]!.text),
    );
    expect(claimed.claim_status).toBe("acquired");

    const billed = service.billCount;
    const resumeCall = await client.callTool({
      name: WAIT_RESUME_TOOL,
      arguments: {
        ticket_id: created.ticket_id,
        claim_id: claimed.claim_id,
        answer: { from: "mcp" },
        idempotency_key: "ik_resume_mcp",
      },
    });
    expect(resumeCall.isError).toBeFalsy();
    const resumed = ResumeTicketResponseSchema.parse(
      JSON.parse((resumeCall.content as { type: string; text: string }[])[0]!.text),
    );
    expect(resumed.state).toBe("resumed");
    expect(resumed.meter.billable).toBe(false);
    expect(service.billCount).toBe(billed);
  });
});
