import { describe, expect, it } from "vitest";
import {
  ClaimTicketResponseSchema,
  CreateTicketResponseSchema,
  ResumeTicketResponseSchema,
} from "../src/schemas.js";
import { createApp } from "../src/http.js";
import { createBody } from "./helpers.js";

async function postJson(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("HTTP /v1/tickets", () => {
  it("creates a ticket", async () => {
    const app = createApp();
    const res = await postJson(app, "/v1/tickets", createBody());
    expect(res.status).toBe(200);
    const json = CreateTicketResponseSchema.parse(await res.json());
    expect(json.ticket_id.startsWith("tkt_")).toBe(true);
    expect(json.claim_token_hint).toBe("present_on_claim_only");
    expect(app.service.billCount).toBe(1);
  });

  it("honors Idempotency-Key header with the same binding as the body key", async () => {
    const app = createApp();
    const body = createBody({ idempotency_key: "ik_create_hdr" });
    const a = CreateTicketResponseSchema.parse(
      await (
        await postJson(app, "/v1/tickets", body, {
          "Idempotency-Key": "ik_create_hdr",
        })
      ).json(),
    );
    const b = CreateTicketResponseSchema.parse(
      await (
        await postJson(app, "/v1/tickets", { ...body, idempotency_key: undefined }, {
          "Idempotency-Key": "ik_create_hdr",
        })
      ).json(),
    );
    expect(b.ticket_id).toBe(a.ticket_id);
    expect(b.meter.meter_ref).toBe(a.meter.meter_ref);
    expect(app.service.billCount).toBe(1);
  });

  it("rejects mismatched body and header idempotency keys", async () => {
    const app = createApp();
    const res = await postJson(
      app,
      "/v1/tickets",
      createBody({ idempotency_key: "ik_create_a" }),
      { "Idempotency-Key": "ik_create_b" },
    );
    expect(res.status).toBe(400);
    expect(app.service.billCount).toBe(0);
  });

  it("claim acquired then second claimer lost+409", async () => {
    const app = createApp();
    const created = CreateTicketResponseSchema.parse(
      await (await postJson(app, "/v1/tickets", createBody({ idempotency_key: "ik_c_http" }))).json(),
    );

    const acquiredRes = await postJson(app, `/v1/tickets/${created.ticket_id}/claim`, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_http_a",
    });
    expect(acquiredRes.status).toBe(200);
    const acquired = ClaimTicketResponseSchema.parse(await acquiredRes.json());
    expect(acquired.claim_status).toBe("acquired");

    const lostRes = await postJson(app, `/v1/tickets/${created.ticket_id}/claim`, {
      claimer_id: "worker_b",
      idempotency_key: "ik_claim_http_b",
    });
    expect(lostRes.status).toBe(409);
    const lost = ClaimTicketResponseSchema.parse(await lostRes.json());
    expect(lost.claim_status).toBe("lost");
    expect(lost.meter.billable).toBe(false);
    expect(app.service.billCount).toBe(2);
  });

  it("resume is free", async () => {
    const app = createApp();
    const created = CreateTicketResponseSchema.parse(
      await (await postJson(app, "/v1/tickets", createBody({ idempotency_key: "ik_c_res" }))).json(),
    );
    const acquired = ClaimTicketResponseSchema.parse(
      await (
        await postJson(app, `/v1/tickets/${created.ticket_id}/claim`, {
          claimer_id: "worker_a",
          idempotency_key: "ik_claim_res",
        })
      ).json(),
    );
    const billed = app.service.billCount;
    const res = await postJson(app, `/v1/tickets/${created.ticket_id}/resume`, {
      claim_id: acquired.claim_id,
      answer: { done: true },
      idempotency_key: "ik_resume_http",
    });
    expect(res.status).toBe(200);
    const json = ResumeTicketResponseSchema.parse(await res.json());
    expect(json.state).toBe("resumed");
    expect(json.answer).toEqual({ done: true });
    expect(json.meter.billable).toBe(false);
    expect(app.service.billCount).toBe(billed);
  });

  it("schema failures are free", async () => {
    const app = createApp();
    const res = await postJson(app, "/v1/tickets", { purpose: "nope" });
    expect(res.status).toBe(400);
    expect(app.service.billCount).toBe(0);
  });
});
