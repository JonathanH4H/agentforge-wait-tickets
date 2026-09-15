export const WAIT_CREATE_TOOL = "wait_create";
export const WAIT_CLAIM_TOOL = "wait_claim";
export const WAIT_RESUME_TOOL = "wait_resume";

export const CLAIM_TOKEN_HINT = "present_on_claim_only" as const;

/** Default list price when filled later. Stub keeps usdc null / price_pending. */
export const LIST_PRICE_USDC = 0.001;
export const DEFAULT_TTL_S = 86_400;
