import type { CreateTicketBody } from "../src/schemas.js";

export function createBody(
  overrides: Partial<CreateTicketBody> = {},
): CreateTicketBody {
  return {
    agent_id: "ag_test",
    purpose: "tool_wait",
    answer_schema: {},
    ttl_s: 86_400,
    idempotency_key: "ik_create_test",
    metadata: {},
    ...overrides,
  };
}
