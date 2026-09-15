import { Hono } from "hono";
import {
  ClaimTicketBodySchema,
  CreateTicketBodySchema,
  ResumeTicketBodySchema,
} from "./schemas.js";
import {
  IdempotencyBindingError,
  IdempotencyConflictError,
  ResumeConflictError,
  ResumeForbiddenError,
  TicketExpiredError,
  TicketNotClaimedError,
  TicketNotFoundError,
  WaitTicketService,
} from "./tickets.js";

export function createApp(service = new WaitTicketService()) {
  const app = new Hono();

  app.post("/v1/tickets", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = CreateTicketBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await service.create(
        parsed.data,
        c.req.header("Idempotency-Key") ?? undefined,
      );
      return c.json(result);
    } catch (err) {
      return mapError(c, err);
    }
  });

  app.post("/v1/tickets/:ticket_id/claim", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = ClaimTicketBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await service.claim(c.req.param("ticket_id"), parsed.data);
      return c.json(result.body, result.status);
    } catch (err) {
      return mapError(c, err);
    }
  });

  app.post("/v1/tickets/:ticket_id/resume", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = ResumeTicketBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const result = await service.resume(c.req.param("ticket_id"), parsed.data);
      return c.json(result);
    } catch (err) {
      return mapError(c, err);
    }
  });

  return Object.assign(app, { service });
}

function mapError(
  c: { json: (body: unknown, status: 400 | 403 | 404 | 409 | 410) => Response },
  err: unknown,
): Response {
  if (err instanceof IdempotencyBindingError) {
    return c.json({ error: "idempotency_key_binding_mismatch" }, 400);
  }
  if (err instanceof IdempotencyConflictError) {
    return c.json({ error: "idempotency_key_conflict" }, 409);
  }
  if (err instanceof TicketNotFoundError) {
    return c.json({ error: "ticket_not_found" }, 404);
  }
  if (err instanceof TicketExpiredError) {
    return c.json({ error: "ticket_expired" }, 410);
  }
  if (err instanceof ResumeForbiddenError) {
    return c.json({ error: "resume_forbidden" }, 403);
  }
  if (err instanceof TicketNotClaimedError) {
    return c.json({ error: "ticket_not_claimed" }, 409);
  }
  if (err instanceof ResumeConflictError) {
    return c.json({ error: "resume_conflict" }, 409);
  }
  throw err;
}

export type WaitTicketApp = ReturnType<typeof createApp>;
