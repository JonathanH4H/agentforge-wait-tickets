import { z } from "zod";
import { CLAIM_TOKEN_HINT, DEFAULT_TTL_S } from "./constants.js";

export const PURPOSES = [
  "tool_wait",
  "webhook",
  "approval",
  "vendor_job",
] as const;

export const CLAIM_STATUSES = ["acquired", "already_owned", "lost"] as const;

export const PurposeSchema = z.enum(PURPOSES);
export const ClaimStatusSchema = z.enum(CLAIM_STATUSES);

export const JsonObjectSchema = z.record(z.unknown());

export const CreateTicketBodySchema = z.object({
  agent_id: z.string().min(1),
  purpose: PurposeSchema,
  answer_schema: JsonObjectSchema.default({}),
  ttl_s: z.number().int().positive().max(30 * 86_400).default(DEFAULT_TTL_S),
  idempotency_key: z.string().min(1).optional(),
  metadata: JsonObjectSchema.default({}),
});

export const ClaimTicketBodySchema = z.object({
  claimer_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export const ResumeTicketBodySchema = z.object({
  claim_id: z.string().regex(/^clm_/),
  answer: JsonObjectSchema,
  idempotency_key: z.string().min(1),
});

export const TicketIdSchema = z.string().regex(/^tkt_/);

export const Iso8601Schema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)) && value.includes("T"), {
    message: "expires_at must be ISO-8601",
  });

export const CreateMeterSchema = z.object({
  sku: z.literal("wait_ticket_create"),
  usdc: z.number().nullable(),
  price_pending: z.boolean(),
  meter_ref: z.string().regex(/^mtr_/),
  billable: z.boolean(),
  unit: z.literal("wait_ticket_create"),
  outcome: z.literal("created"),
});

export const ClaimMeterSchema = z.object({
  sku: z.literal("wait_ticket_claim"),
  usdc: z.number().nullable(),
  price_pending: z.boolean(),
  meter_ref: z.string().regex(/^mtr_/),
  billable: z.boolean(),
  unit: z.literal("wait_ticket_claim"),
  outcome: ClaimStatusSchema,
});

export const ResumeMeterSchema = z.object({
  billable: z.literal(false),
});

export const CreateTicketResponseSchema = z.object({
  ticket_id: TicketIdSchema,
  claim_token_hint: z.literal(CLAIM_TOKEN_HINT),
  expires_at: Iso8601Schema,
  meter: CreateMeterSchema,
});

export const ClaimTicketResponseSchema = z.object({
  ticket_id: TicketIdSchema,
  claim_status: ClaimStatusSchema,
  claim_id: z.string().regex(/^clm_/),
  owner_id: z.string().min(1),
  exactly_once: z.literal(true),
  meter: ClaimMeterSchema,
});

export const ResumeTicketResponseSchema = z.object({
  ticket_id: TicketIdSchema,
  state: z.literal("resumed"),
  answer: JsonObjectSchema,
  meter: ResumeMeterSchema,
});

export const WaitCreateToolInputSchema = CreateTicketBodySchema;

export const WaitClaimToolInputSchema = ClaimTicketBodySchema.extend({
  ticket_id: TicketIdSchema,
});

export const WaitResumeToolInputSchema = ResumeTicketBodySchema.extend({
  ticket_id: TicketIdSchema,
});

export type Purpose = z.infer<typeof PurposeSchema>;
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type CreateTicketBody = z.infer<typeof CreateTicketBodySchema>;
export type ClaimTicketBody = z.infer<typeof ClaimTicketBodySchema>;
export type ResumeTicketBody = z.infer<typeof ResumeTicketBodySchema>;
export type CreateMeter = z.infer<typeof CreateMeterSchema>;
export type ClaimMeter = z.infer<typeof ClaimMeterSchema>;
export type ResumeMeter = z.infer<typeof ResumeMeterSchema>;
export type CreateTicketResponse = z.infer<typeof CreateTicketResponseSchema>;
export type ClaimTicketResponse = z.infer<typeof ClaimTicketResponseSchema>;
export type ResumeTicketResponse = z.infer<typeof ResumeTicketResponseSchema>;
export type WaitClaimToolInput = z.infer<typeof WaitClaimToolInputSchema>;
export type WaitResumeToolInput = z.infer<typeof WaitResumeToolInputSchema>;
