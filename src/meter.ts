import { newId } from "./ids.js";
import type { ClaimMeter, ClaimStatus, CreateMeter } from "./schemas.js";

export function createCreateMeter(): CreateMeter {
  return {
    sku: "wait_ticket_create",
    usdc: null,
    price_pending: true,
    meter_ref: newId("mtr"),
    billable: true,
    unit: "wait_ticket_create",
    outcome: "created",
  };
}

export function createClaimMeter(
  outcome: ClaimStatus,
  opts: { billable: boolean; meterRef?: string },
): ClaimMeter {
  return {
    sku: "wait_ticket_claim",
    usdc: null,
    price_pending: true,
    meter_ref: opts.meterRef ?? newId("mtr"),
    billable: opts.billable,
    unit: "wait_ticket_claim",
    outcome,
  };
}
