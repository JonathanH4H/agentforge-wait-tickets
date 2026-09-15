import { describe, expect, it } from "vitest";
import { ClaimTicketResponseSchema } from "../src/schemas.js";
import { createApp } from "../src/http.js";
import { WaitTicketService } from "../src/tickets.js";
import { createBody } from "./helpers.js";

const SOAK_N = 50;

describe("concurrent claim soak", () => {
  it("service: ≥50 parallel claimers yield exactly one acquired and zero double-acquire", async () => {
    const svc = new WaitTicketService();
    const created = await svc.create(createBody({ idempotency_key: "ik_create_soak" }));

    const results = await Promise.all(
      Array.from({ length: SOAK_N }, (_, i) =>
        svc.claim(created.ticket_id, {
          claimer_id: `worker_${i}`,
          idempotency_key: `ik_claim_soak_${i}`,
        }),
      ),
    );

    const bodies = results.map((r) => ClaimTicketResponseSchema.parse(r.body));
    const acquired = bodies.filter((b) => b.claim_status === "acquired");
    const lost = bodies.filter((b) => b.claim_status === "lost");
    expect(acquired).toHaveLength(1);
    expect(lost).toHaveLength(SOAK_N - 1);
    expect(new Set(acquired.map((b) => b.claim_id)).size).toBe(1);
    expect(lost.every((b) => b.claim_id === acquired[0]!.claim_id)).toBe(true);
    expect(lost.every((b) => b.meter.billable === false)).toBe(true);
    expect(svc.billCount).toBe(2);
  });

  it("HTTP: ≥50 parallel claimers yield exactly one 200 acquired and the rest 409 lost", async () => {
    const app = createApp();
    const createdRes = await app.request("/v1/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody({ idempotency_key: "ik_create_soak_http" })),
    });
    const created = (await createdRes.json()) as { ticket_id: string };

    const responses = await Promise.all(
      Array.from({ length: SOAK_N }, (_, i) =>
        app.request(`/v1/tickets/${created.ticket_id}/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimer_id: `worker_http_${i}`,
            idempotency_key: `ik_claim_soak_http_${i}`,
          }),
        }),
      ),
    );

    const parsed = await Promise.all(
      responses.map(async (res) => ({
        status: res.status,
        body: ClaimTicketResponseSchema.parse(await res.json()),
      })),
    );

    const acquired = parsed.filter((p) => p.body.claim_status === "acquired");
    const lost = parsed.filter((p) => p.body.claim_status === "lost");
    expect(acquired).toHaveLength(1);
    expect(acquired[0]!.status).toBe(200);
    expect(lost).toHaveLength(SOAK_N - 1);
    expect(lost.every((p) => p.status === 409)).toBe(true);
    expect(app.service.billCount).toBe(2);
  });
});
