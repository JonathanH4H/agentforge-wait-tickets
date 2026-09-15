import { describe, expect, it } from "vitest";
import {
  ClaimTicketResponseSchema,
  CreateTicketResponseSchema,
  ResumeTicketResponseSchema,
} from "../src/schemas.js";
import {
  ResumeForbiddenError,
  TicketExpiredError,
  WaitTicketService,
} from "../src/tickets.js";
import { createBody } from "./helpers.js";

describe("WaitTicketService", () => {
  it("creates a ticket with locked I/O and bills create", async () => {
    const svc = new WaitTicketService();
    const created = CreateTicketResponseSchema.parse(
      await svc.create(createBody({ idempotency_key: "ik_create_1" })),
    );
    expect(created.ticket_id.startsWith("tkt_")).toBe(true);
    expect(created.claim_token_hint).toBe("present_on_claim_only");
    expect(created.meter).toMatchObject({
      sku: "wait_ticket_create",
      usdc: null,
      price_pending: true,
      billable: true,
      unit: "wait_ticket_create",
      outcome: "created",
    });
    expect(created.meter.meter_ref.startsWith("mtr_")).toBe(true);
    expect(svc.billCount).toBe(1);
  });

  it("first claimer acquires with clm_* and bills claim", async () => {
    const svc = new WaitTicketService();
    const created = await svc.create(createBody({ idempotency_key: "ik_create_2" }));
    const claim = await svc.claim(created.ticket_id, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_a",
    });
    const body = ClaimTicketResponseSchema.parse(claim.body);
    expect(claim.status).toBe(200);
    expect(body.claim_status).toBe("acquired");
    expect(body.claim_id.startsWith("clm_")).toBe(true);
    expect(body.owner_id).toBe("worker_a");
    expect(body.exactly_once).toBe(true);
    expect(body.meter).toMatchObject({
      sku: "wait_ticket_claim",
      usdc: null,
      price_pending: true,
      billable: true,
      unit: "wait_ticket_claim",
      outcome: "acquired",
    });
    expect(svc.billCount).toBe(2);
  });

  it("second claimer is lost with no debit", async () => {
    const svc = new WaitTicketService();
    const created = await svc.create(createBody({ idempotency_key: "ik_create_3" }));
    await svc.claim(created.ticket_id, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_a",
    });
    const lost = await svc.claim(created.ticket_id, {
      claimer_id: "worker_b",
      idempotency_key: "ik_claim_b",
    });
    expect(lost.status).toBe(409);
    expect(lost.body.claim_status).toBe("lost");
    expect(lost.body.owner_id).toBe("worker_a");
    expect(lost.body.exactly_once).toBe(true);
    expect(lost.body.meter.billable).toBe(false);
    expect(lost.body.meter.outcome).toBe("lost");
    expect(svc.billCount).toBe(2);
  });

  it("idempotent create and claim replay the same ids/meter_ref with no second bill", async () => {
    const svc = new WaitTicketService();
    const key = "ik_create_replay";
    const a = await svc.create(createBody({ idempotency_key: key }));
    const b = await svc.create(createBody({ idempotency_key: key }));
    expect(b.ticket_id).toBe(a.ticket_id);
    expect(b.meter.meter_ref).toBe(a.meter.meter_ref);
    expect(svc.billCount).toBe(1);

    const c1 = await svc.claim(a.ticket_id, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_replay",
    });
    const c2 = await svc.claim(a.ticket_id, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_replay",
    });
    expect(c1.body.claim_status).toBe("acquired");
    expect(c2.body.claim_status).toBe("already_owned");
    expect(c2.body.claim_id).toBe(c1.body.claim_id);
    expect(c2.body.meter.meter_ref).toBe(c1.body.meter.meter_ref);
    expect(c2.body.meter.billable).toBe(false);
    expect(svc.billCount).toBe(2);
  });

  it("resume is free and idempotent with the same answer", async () => {
    const svc = new WaitTicketService();
    const created = await svc.create(createBody({ idempotency_key: "ik_create_res" }));
    const claim = await svc.claim(created.ticket_id, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_res",
    });
    const billedAfterClaim = svc.billCount;
    const answer = { ok: true, value: 7 };
    const resumed = ResumeTicketResponseSchema.parse(
      await svc.resume(created.ticket_id, {
        claim_id: claim.body.claim_id,
        answer,
        idempotency_key: "ik_resume_1",
      }),
    );
    expect(resumed.state).toBe("resumed");
    expect(resumed.answer).toEqual(answer);
    expect(resumed.meter).toEqual({ billable: false });
    expect(svc.billCount).toBe(billedAfterClaim);

    const replay = await svc.resume(created.ticket_id, {
      claim_id: claim.body.claim_id,
      answer,
      idempotency_key: "ik_resume_1",
    });
    expect(replay.answer).toEqual(answer);
    expect(replay.meter.billable).toBe(false);
    expect(svc.billCount).toBe(billedAfterClaim);
  });

  it("only the owner claim_id may resume", async () => {
    const svc = new WaitTicketService();
    const created = await svc.create(createBody({ idempotency_key: "ik_create_own" }));
    await svc.claim(created.ticket_id, {
      claimer_id: "worker_a",
      idempotency_key: "ik_claim_own",
    });
    await expect(
      svc.resume(created.ticket_id, {
        claim_id: "clm_not_the_owner",
        answer: { no: true },
        idempotency_key: "ik_resume_bad",
      }),
    ).rejects.toBeInstanceOf(ResumeForbiddenError);
    expect(svc.billCount).toBe(2);
  });

  it("expired tickets cannot be claimed", async () => {
    let now = 1_000_000;
    const svc = new WaitTicketService(undefined, { now: () => now });
    const created = await svc.create(
      createBody({ idempotency_key: "ik_create_ttl", ttl_s: 10 }),
    );
    now += 11_000;
    await expect(
      svc.claim(created.ticket_id, {
        claimer_id: "worker_a",
        idempotency_key: "ik_claim_ttl",
      }),
    ).rejects.toBeInstanceOf(TicketExpiredError);
  });
});
