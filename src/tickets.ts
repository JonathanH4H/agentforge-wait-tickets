import { CLAIM_TOKEN_HINT } from "./constants.js";
import { newId } from "./ids.js";
import { createClaimMeter, createCreateMeter } from "./meter.js";
import { KeyedMutex } from "./mutex.js";
import {
  ClaimTicketResponseSchema,
  CreateTicketResponseSchema,
  ResumeTicketResponseSchema,
  type ClaimTicketBody,
  type ClaimTicketResponse,
  type CreateTicketBody,
  type CreateTicketResponse,
  type ResumeTicketBody,
  type ResumeTicketResponse,
} from "./schemas.js";
import {
  claimFingerprint,
  createFingerprint,
  InMemoryTicketStore,
  resumeFingerprint,
  toCreateResponse,
  type StoredTicket,
} from "./store.js";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency_key_conflict");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyBindingError extends Error {
  constructor() {
    super("idempotency_key_binding_mismatch");
    this.name = "IdempotencyBindingError";
  }
}

export class TicketNotFoundError extends Error {
  constructor() {
    super("ticket_not_found");
    this.name = "TicketNotFoundError";
  }
}

export class TicketExpiredError extends Error {
  constructor() {
    super("ticket_expired");
    this.name = "TicketExpiredError";
  }
}

export class ResumeForbiddenError extends Error {
  constructor() {
    super("resume_forbidden");
    this.name = "ResumeForbiddenError";
  }
}

export class TicketNotClaimedError extends Error {
  constructor() {
    super("ticket_not_claimed");
    this.name = "TicketNotClaimedError";
  }
}

export class ResumeConflictError extends Error {
  constructor() {
    super("resume_conflict");
    this.name = "ResumeConflictError";
  }
}

export type Clock = { now: () => number };

export type ClaimResult = {
  status: 200 | 409;
  body: ClaimTicketResponse;
};

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function bindIdempotencyKey(
  bodyKey: string | undefined,
  headerKey: string | undefined,
): string | undefined {
  const body = bodyKey?.trim() || undefined;
  const header = headerKey?.trim() || undefined;
  if (body && header && body !== header) {
    throw new IdempotencyBindingError();
  }
  return body ?? header;
}

export class WaitTicketService {
  readonly locks = new KeyedMutex();

  constructor(
    readonly store = new InMemoryTicketStore(),
    readonly clock: Clock = { now: () => Date.now() },
  ) {}

  get billCount(): number {
    return this.store.billCount;
  }

  async create(
    req: CreateTicketBody,
    headerIdempotencyKey?: string,
  ): Promise<CreateTicketResponse> {
    const idempotencyKey = bindIdempotencyKey(
      req.idempotency_key,
      headerIdempotencyKey,
    );
    const fingerprint = createFingerprint({
      agent_id: req.agent_id,
      purpose: req.purpose,
      answer_schema: req.answer_schema,
      ttl_s: req.ttl_s,
      metadata: req.metadata,
    });

    const lockKey = idempotencyKey ? `create:${idempotencyKey}` : `create:${newId("tkt")}`;

    return this.locks.runExclusive(lockKey, () => {
      if (idempotencyKey) {
        const prior = this.store.getCreateIdempotency(idempotencyKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            throw new IdempotencyConflictError();
          }
          const existing = this.store.get(prior.ticketId);
          if (existing) {
            return CreateTicketResponseSchema.parse(toCreateResponse(existing));
          }
        }
      }

      const now = this.clock.now();
      const ticket: StoredTicket = {
        ticket_id: newId("tkt"),
        agent_id: req.agent_id,
        purpose: req.purpose,
        answer_schema: req.answer_schema,
        metadata: req.metadata,
        ttl_s: req.ttl_s,
        expires_at: toIso(now + req.ttl_s * 1000),
        state: "open",
        owner_id: null,
        claim_id: null,
        create_meter: createCreateMeter(),
        claim_meter: null,
        answer: null,
        create_fingerprint: fingerprint,
        resume_fingerprint: null,
      };

      this.store.putCreate(ticket, idempotencyKey, fingerprint);
      this.store.bill(ticket.create_meter.meter_ref);

      return CreateTicketResponseSchema.parse({
        ticket_id: ticket.ticket_id,
        claim_token_hint: CLAIM_TOKEN_HINT,
        expires_at: ticket.expires_at,
        meter: ticket.create_meter,
      });
    });
  }

  async claim(ticketId: string, req: ClaimTicketBody): Promise<ClaimResult> {
    const fingerprint = claimFingerprint(req.claimer_id);

    return this.locks.runExclusive(`claim:${ticketId}`, () => {
      const ticket = this.requireLiveTicket(ticketId);

      const prior = this.store.getClaimIdempotency(ticketId, req.idempotency_key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new IdempotencyConflictError();
        }
        return this.ownedReplay(ticket);
      }

      if (ticket.claim_id && ticket.owner_id === req.claimer_id) {
        this.store.putClaimIdempotency(ticketId, req.idempotency_key, {
          claimerId: req.claimer_id,
          fingerprint,
        });
        return this.ownedReplay(ticket);
      }

      if (ticket.claim_id && ticket.owner_id !== req.claimer_id) {
        const body = ClaimTicketResponseSchema.parse({
          ticket_id: ticket.ticket_id,
          claim_status: "lost",
          claim_id: ticket.claim_id,
          owner_id: ticket.owner_id,
          exactly_once: true,
          meter: createClaimMeter("lost", { billable: false }),
        });
        return { status: 409 as const, body };
      }

      const claimId = newId("clm");
      const meter = createClaimMeter("acquired", { billable: true });
      ticket.claim_id = claimId;
      ticket.owner_id = req.claimer_id;
      ticket.state = "claimed";
      ticket.claim_meter = meter;
      this.store.putClaimIdempotency(ticketId, req.idempotency_key, {
        claimerId: req.claimer_id,
        fingerprint,
      });
      this.store.bill(meter.meter_ref);

      const body = ClaimTicketResponseSchema.parse({
        ticket_id: ticket.ticket_id,
        claim_status: "acquired",
        claim_id: claimId,
        owner_id: req.claimer_id,
        exactly_once: true,
        meter,
      });
      return { status: 200 as const, body };
    });
  }

  async resume(
    ticketId: string,
    req: ResumeTicketBody,
  ): Promise<ResumeTicketResponse> {
    const fingerprint = resumeFingerprint(req.claim_id, req.answer);

    return this.locks.runExclusive(`claim:${ticketId}`, () => {
      const ticket = this.requireLiveTicket(ticketId, { allowResumed: true });

      const prior = this.store.getResumeIdempotency(ticketId, req.idempotency_key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new ResumeConflictError();
        }
        if (!ticket.answer) {
          throw new ResumeConflictError();
        }
        return this.resumeResponse(ticket);
      }

      if (!ticket.claim_id || !ticket.owner_id) {
        throw new TicketNotClaimedError();
      }
      if (req.claim_id !== ticket.claim_id) {
        throw new ResumeForbiddenError();
      }

      if (ticket.state === "resumed") {
        if (ticket.resume_fingerprint && ticket.resume_fingerprint !== fingerprint) {
          throw new ResumeConflictError();
        }
        this.store.putResumeIdempotency(ticketId, req.idempotency_key, {
          fingerprint,
        });
        return this.resumeResponse(ticket);
      }

      ticket.state = "resumed";
      ticket.answer = req.answer;
      ticket.resume_fingerprint = fingerprint;
      this.store.putResumeIdempotency(ticketId, req.idempotency_key, {
        fingerprint,
      });
      return this.resumeResponse(ticket);
    });
  }

  private ownedReplay(ticket: StoredTicket): ClaimResult {
    const body = ClaimTicketResponseSchema.parse({
      ticket_id: ticket.ticket_id,
      claim_status: "already_owned",
      claim_id: ticket.claim_id,
      owner_id: ticket.owner_id,
      exactly_once: true,
      meter: createClaimMeter("already_owned", {
        billable: false,
        meterRef: ticket.claim_meter?.meter_ref,
      }),
    });
    return { status: 200 as const, body };
  }

  private resumeResponse(ticket: StoredTicket): ResumeTicketResponse {
    return ResumeTicketResponseSchema.parse({
      ticket_id: ticket.ticket_id,
      state: "resumed",
      answer: ticket.answer ?? {},
      meter: { billable: false },
    });
  }

  private requireLiveTicket(
    ticketId: string,
    opts: { allowResumed?: boolean } = {},
  ): StoredTicket {
    const ticket = this.store.get(ticketId);
    if (!ticket) {
      throw new TicketNotFoundError();
    }
    if (opts.allowResumed && ticket.state === "resumed") {
      return ticket;
    }
    if (this.isExpired(ticket)) {
      ticket.state = "expired";
      throw new TicketExpiredError();
    }
    return ticket;
  }

  private isExpired(ticket: StoredTicket): boolean {
    return Date.parse(ticket.expires_at) <= this.clock.now();
  }
}
