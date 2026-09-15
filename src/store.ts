import type {
  ClaimMeter,
  CreateMeter,
  CreateTicketResponse,
  Purpose,
} from "./schemas.js";

export type TicketState = "open" | "claimed" | "resumed" | "expired";

export type StoredTicket = {
  ticket_id: string;
  agent_id: string;
  purpose: Purpose;
  answer_schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ttl_s: number;
  expires_at: string;
  state: TicketState;
  owner_id: string | null;
  claim_id: string | null;
  create_meter: CreateMeter;
  claim_meter: ClaimMeter | null;
  answer: Record<string, unknown> | null;
  create_fingerprint: string;
  resume_fingerprint: string | null;
};

export type CreateIdempotencyRecord = {
  ticketId: string;
  fingerprint: string;
};

export type ClaimIdempotencyRecord = {
  claimerId: string;
  fingerprint: string;
};

export type ResumeIdempotencyRecord = {
  fingerprint: string;
};

export class InMemoryTicketStore {
  readonly tickets = new Map<string, StoredTicket>();
  readonly createIdempotency = new Map<string, CreateIdempotencyRecord>();
  readonly claimIdempotency = new Map<string, ClaimIdempotencyRecord>();
  readonly resumeIdempotency = new Map<string, ResumeIdempotencyRecord>();
  readonly billed = new Set<string>();
  billCount = 0;

  putCreate(
    ticket: StoredTicket,
    idempotencyKey: string | undefined,
    fingerprint: string,
  ): void {
    this.tickets.set(ticket.ticket_id, ticket);
    if (idempotencyKey) {
      this.createIdempotency.set(idempotencyKey, {
        ticketId: ticket.ticket_id,
        fingerprint,
      });
    }
  }

  get(ticketId: string): StoredTicket | undefined {
    return this.tickets.get(ticketId);
  }

  getCreateIdempotency(key: string): CreateIdempotencyRecord | undefined {
    return this.createIdempotency.get(key);
  }

  claimKey(ticketId: string, idempotencyKey: string): string {
    return `${ticketId}::${idempotencyKey}`;
  }

  resumeKey(ticketId: string, idempotencyKey: string): string {
    return `${ticketId}::${idempotencyKey}`;
  }

  getClaimIdempotency(
    ticketId: string,
    idempotencyKey: string,
  ): ClaimIdempotencyRecord | undefined {
    return this.claimIdempotency.get(this.claimKey(ticketId, idempotencyKey));
  }

  putClaimIdempotency(
    ticketId: string,
    idempotencyKey: string,
    record: ClaimIdempotencyRecord,
  ): void {
    this.claimIdempotency.set(this.claimKey(ticketId, idempotencyKey), record);
  }

  getResumeIdempotency(
    ticketId: string,
    idempotencyKey: string,
  ): ResumeIdempotencyRecord | undefined {
    return this.resumeIdempotency.get(this.resumeKey(ticketId, idempotencyKey));
  }

  putResumeIdempotency(
    ticketId: string,
    idempotencyKey: string,
    record: ResumeIdempotencyRecord,
  ): void {
    this.resumeIdempotency.set(this.resumeKey(ticketId, idempotencyKey), record);
  }

  /** Bill once per meter_ref. Replay / non-billable outcomes must not call this. */
  bill(meterRef: string): void {
    if (this.billed.has(meterRef)) return;
    this.billed.add(meterRef);
    this.billCount += 1;
  }
}

export function createFingerprint(input: {
  agent_id: string;
  purpose: string;
  answer_schema: Record<string, unknown>;
  ttl_s: number;
  metadata: Record<string, unknown>;
}): string {
  return JSON.stringify({
    agent_id: input.agent_id,
    purpose: input.purpose,
    answer_schema: input.answer_schema,
    ttl_s: input.ttl_s,
    metadata: input.metadata,
  });
}

export function claimFingerprint(claimerId: string): string {
  return JSON.stringify({ claimer_id: claimerId });
}

export function resumeFingerprint(claimId: string, answer: Record<string, unknown>): string {
  return JSON.stringify({ claim_id: claimId, answer });
}

export function toCreateResponse(ticket: StoredTicket): CreateTicketResponse {
  return {
    ticket_id: ticket.ticket_id,
    claim_token_hint: "present_on_claim_only",
    expires_at: ticket.expires_at,
    meter: ticket.create_meter,
  };
}
